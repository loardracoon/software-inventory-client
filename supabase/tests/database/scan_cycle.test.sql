-- Phase 4: cycle engine (open, claim, dispatch, results, retries, close), Scan now and the lease.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
-- Start from an empty app inside this transaction so data from local use cannot leak into the
-- assertions; the final rollback restores everything.
truncate public.tenants, public.software_titles, public.sophos_connection, public.audit_log,
  public.dictionary_cache, public.hub_submissions cascade;
delete from public.profiles;
delete from vault.secrets where name = 'sophos_client_secret';
delete from public.collector_lease;
delete from vault.secrets where name in ('collector_url', 'collector_secret');

select plan(33);

-- Fixtures ----------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer@example.com');
insert into public.tenants (id, sophos_tenant_id, name, id_type) values
  ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'tenant');
insert into public.tenant_members (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000a', 'viewer');
insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform, retired_at) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'ep-w1', 'W1', 'windows', null),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'ep-w2', 'W2', 'windows', null),
  ('20000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', 'ep-m1', 'M1', 'macos', null),
  ('20000000-0000-0000-0000-0000000000a4', '10000000-0000-0000-0000-00000000000a', 'ep-l1', 'L1', 'linux', null),
  ('20000000-0000-0000-0000-0000000000a5', '10000000-0000-0000-0000-00000000000a', 'ep-r1', 'R1', 'windows', now());
-- Windows lacks vscode_extensions; macOS has everything; Linux is not probed yet.
insert into public.platform_capabilities (tenant_id, platform, osquery_tables)
select '10000000-0000-0000-0000-00000000000a', p.platform,
       array(select distinct unnest(required_tables) from public.query_catalog q where q.platform = p.platform
             except select 'vscode_extensions' where p.platform = 'windows')
from (values ('windows'::public.platform), ('macos'::public.platform)) p (platform);

create temp table ids as
select (select id from public.query_catalog where platform = 'windows' and name = 'inv.programs' order by version desc limit 1) as win_programs,
       (select id from public.query_catalog where platform = 'windows' and name = 'inv.hardware') as win_hardware,
       (select id from public.query_catalog where platform = 'windows' and name = 'inv.disks') as win_disks,
       (select id from public.query_catalog where platform = 'linux' and name = 'inv.programs.deb' order by version desc limit 1) as lin_deb;
grant select on ids to authenticated;

-- Open ------------------------------------------------------------------------------------------
create temp table cycle as
select public.open_cycle('10000000-0000-0000-0000-00000000000a', now() - interval '1 day', now() + interval '6 days') as id;
select isnt((select id from cycle), null, 'open_cycle opens the period');
select is(public.open_cycle('10000000-0000-0000-0000-00000000000a', now() - interval '1 day', now() + interval '6 days'),
  null, 'the same period never opens twice');
select results_eq(
  'select status::text, count(*)::int from public.scan_tasks group by 1 order by 1',
  $$values ('pending', 23), ('skipped', 2)$$,
  'one task per active computer and query (retired excluded); missing tables are skipped');
select alike((select last_error from public.scan_tasks where status = 'skipped' limit 1), '%vscode_extensions%',
  'skipped tasks say which tables are missing');
select is((select count(*)::int from public.due_task_groups('10000000-0000-0000-0000-00000000000a') where platform = 'linux'), 0,
  'unprobed Linux queries are not due');

-- Claim and dispatch ------------------------------------------------------------------------------
create temp table claimed as
select * from public.claim_dispatch_batch('10000000-0000-0000-0000-00000000000a', (select win_programs from ids), 1);
insert into claimed select * from public.claim_dispatch_batch('10000000-0000-0000-0000-00000000000a', (select win_programs from ids), 5);
select is((select count(*)::int from claimed), 2, 'claims respect the limit and never return a claimed task twice');
select is_empty($$select * from public.claim_dispatch_batch('10000000-0000-0000-0000-00000000000a', (select win_programs from ids), 5)$$,
  'nothing left to claim');
select is_empty($$select * from public.claim_dispatch_batch('10000000-0000-0000-0000-00000000000a', (select lin_deb from ids), 5)$$,
  'unprobed queries cannot be claimed');

create temp table run1 as
select public.record_dispatch(array(select task_id from claimed), '10000000-0000-0000-0000-00000000000a',
  (select win_programs from ids), 'live_endpoint_search', 'sophos-run-1', array(select sophos_endpoint_id from claimed), false) as id;
select is((select count(*)::int from public.scan_tasks where last_run_id = (select id from run1) and status = 'dispatched'), 2,
  'dispatched tasks point at their run');

select is(public.store_endpoint_result((select id from run1), 'ep-w1', '[{"name":"7-Zip"},{"name":"Git"}]'), true, 'stores rows');
select is(public.store_endpoint_result((select id from run1), 'ep-w1', '[{"name":"7-Zip"}]'), false, 'storing again is a no-op');
select results_eq(
  $$select t.status::text, r.row_count, r.ingested_at is null, c.last_collected_at is not null
    from public.raw_results r join public.scan_tasks t on t.id = r.scan_task_id join public.computers c on c.id = r.computer_id$$,
  $$values ('collected', 2, true, true)$$, 'the task is collected and the rows wait for Phase 5');

select public.set_task_outcome((select id from run1), 'ep-w2', 'error', 'no such table: programs');
select is((select status::text from public.scan_tasks where last_run_id = (select id from run1) and computer_id = '20000000-0000-0000-0000-0000000000a2'),
  'error', 'a query error ends the task without retry');

-- Run ends: silent computers get no_response, then a retry ----------------------------------------
create temp table claimed2 as
select * from public.claim_dispatch_batch('10000000-0000-0000-0000-00000000000a', (select win_hardware from ids), 10);
create temp table run2 as
select public.record_dispatch(array(select task_id from claimed2), '10000000-0000-0000-0000-00000000000a',
  (select win_hardware from ids), 'live_endpoint_search', 'sophos-run-2', array(select sophos_endpoint_id from claimed2), false) as id;
select public.store_endpoint_result((select id from run2), 'ep-w1', '[{"hostname":"W1"}]');
select is(public.finish_run((select id from run2), 'finished', true, 'grace time'), 1, 'finish_run marks the silent computer');
select is(public.schedule_retries('10000000-0000-0000-0000-00000000000a', now() - interval '1 minute'), 1, 'no_response is scheduled for retry');
select results_eq(
  $$select status::text, attempts from public.scan_tasks where last_run_id = (select id from run2) and computer_id = '20000000-0000-0000-0000-0000000000a2'$$,
  $$values ('retry_scheduled', 1)$$, 'a retry counts an attempt');

select is_empty($$select * from public.claim_dispatch_batch('10000000-0000-0000-0000-00000000000a', (select win_disks from ids), 5, true)$$,
  'the reserve is not for normal tasks');
create temp table claimed3 as
select * from public.claim_dispatch_batch('10000000-0000-0000-0000-00000000000a', (select win_hardware from ids), 5, true);
select is((select count(*)::int from claimed3), 1, 'retries may use the reserve');
select public.release_tasks(array(select task_id from claimed3), 'Live Endpoint Search error: timeout');
select results_eq(
  $$select status::text, last_error, next_attempt_at > now() from public.scan_tasks where id = (select task_id from claimed3)$$,
  $$values ('retry_scheduled', 'Live Endpoint Search error: timeout', true)$$, 'a failed start returns the task to the queue');

-- Budget ----------------------------------------------------------------------------------------
insert into public.query_runs (tenant_id, provider, domain, platform, query_version, status, started_at)
values ('10000000-0000-0000-0000-00000000000a', 'live_endpoint_search', 'programs', 'windows', 1, 'running', now() - interval '20 minutes');
select results_eq('select runs_this_minute, runs_today, active_runs from public.budget_snapshot(''10000000-0000-0000-0000-00000000000a'')',
  $$values (2, 2, 1)$$, 'budget counts runs; expired "running" runs are not active');

-- Probe results and completion --------------------------------------------------------------------
insert into public.platform_capabilities (tenant_id, platform, osquery_tables)
select '10000000-0000-0000-0000-00000000000a', 'linux',
       array(select distinct unnest(required_tables) from public.query_catalog where platform = 'linux' except select 'vscode_extensions');
select is(public.refresh_skipped_tasks('10000000-0000-0000-0000-00000000000a'), 1, 'a probe skips what cannot run');
select is(public.complete_cycles('10000000-0000-0000-0000-00000000000a'), 0, 'a cycle with work left stays open');

-- Scan now ----------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.scan_now('20000000-0000-0000-0000-0000000000a3')$$, '42501', null, 'viewers cannot scan');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select is(public.scan_now('20000000-0000-0000-0000-0000000000a3'), 6, 'Scan now makes every query of the computer a priority');
select throws_ok($$select public.claim_dispatch_batch('10000000-0000-0000-0000-00000000000a', (select win_disks from ids), 1)$$,
  '42501', null, 'the browser cannot claim tasks');
reset role;
select is((select count(*)::int from public.scan_tasks where computer_id = '20000000-0000-0000-0000-0000000000a3' and priority), 6,
  'priority tasks are marked');
select is((select action from public.audit_log where target = 'computers:20000000-0000-0000-0000-0000000000a3'), 'scan now',
  'Scan now is audited');

-- Next period closes the previous cycle -----------------------------------------------------------
select isnt(public.open_cycle('10000000-0000-0000-0000-00000000000a', now() + interval '1 hour', now() + interval '8 days'), null,
  'a new period opens a new cycle');
select results_eq(
  $$select status::text, coverage_pct from public.scan_cycles where id = (select id from cycle)$$,
  $$values ('closed', 9.09::numeric)$$, 'coverage = collected / (tasks - skipped)');
select is((select count(*)::int from public.scan_tasks where cycle_id = (select id from cycle) and status = 'missed'), 19,
  'unfinished tasks become missed; nothing is removed');

-- Lease and cron ----------------------------------------------------------------------------------
select ok(public.acquire_collector_lease('tick-a', 180) and not public.acquire_collector_lease('tick-b', 180),
  'one tick holds the lease');
select public.release_collector_lease('tick-a');
select ok(public.acquire_collector_lease('tick-b', 180), 'the lease is free after release');
select is(public.invoke_collector(), null, 'the cron tick does nothing until Vault has the URL and secret');

select * from finish();
rollback;
