-- Phase 8: alert settings and detection, the API budget panel, raw_results retention, the RLS checks the
-- spec names (a viewer cannot read raw_results or another tenant's rows) and the v2 program queries.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
-- Start from an empty app inside this transaction so data from local use cannot leak into the
-- assertions; the final rollback restores everything.
truncate public.tenants, public.software_titles, public.sophos_connection, public.audit_log,
  public.dictionary_cache, public.hub_submissions, public.collector_logs, public.alerts cascade;
delete from public.profiles;
delete from vault.secrets where name in ('sophos_client_secret', 'alert_webhook_url', 'alert_resend_key', 'collector_url');
update public.alert_settings set enabled = true, webhook_secret_id = null, webhook_hint = null, resend_secret_id = null,
  email_from = null, email_to = '{}', coverage_threshold = 90, stale_minutes = 30;

select plan(33);

-- Fixtures ----------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'operator@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer@example.com');
insert into public.tenants (id, sophos_tenant_id, name, id_type) values
  ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'partner'),
  ('10000000-0000-0000-0000-00000000000b', 'sophos-b', 'Tenant B', 'partner');
insert into public.tenant_members (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000a', 'operator'),
  ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000a', 'viewer');
insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'ep-a1', 'A1', 'windows'),
  ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'ep-b1', 'B1', 'windows');
insert into public.scan_cycles (id, tenant_id, opened_at, closes_at, closed_at, status, coverage_pct) values
  ('60000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', now() - interval '8 days', now() - interval '1 day', now() - interval '1 day', 'closed', 85),
  ('60000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', now() - interval '8 days', now() - interval '1 day', now() - interval '1 day', 'complete', 95),
  ('60000000-0000-0000-0000-0000000000a0', '10000000-0000-0000-0000-00000000000a', now() - interval '20 days', now() - interval '13 days', now() - interval '13 days', 'closed', 50);
insert into public.collector_logs (step, tenant_id, level, message, data, created_at) values
  ('collector', '10000000-0000-0000-0000-00000000000a', 'error', 'Query error on ep-a1: no such table: chocolatey_packages', '{"step": "query_error"}', now() - interval '50 minutes'),
  ('collector', '10000000-0000-0000-0000-00000000000a', 'error', 'Query error on ep-a1: timeout', '{"step": "query_error"}', now() - interval '50 minutes');

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- Alert settings ----------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select throws_ok($$select public.set_alert_settings(p_webhook_url => 'https://hooks.example.com/x')$$, '42501', null, 'operator cannot change alerts');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select throws_ok($$select public.set_alert_settings(p_email_to => array['not-an-address'])$$, '22023', null, 'recipients are validated');
select lives_ok($$select public.set_alert_settings(
  p_webhook_url => 'https://hooks.example.com/services/T0/B0/token-123456', p_resend_key => 're_key_abcdef123456',
  p_email_from => 'alerts@example.com', p_email_to => array['Ops@Example.com', 'ops@example.com', 'sec@example.com'])$$, 'admin sets the channels');
select results_eq('select webhook_configured, webhook_hint, email_configured, email_to from public.get_alert_status()',
  $$values (true, 'https://hooks.example.com/••••', true, '{ops@example.com,sec@example.com}'::text[])$$,
  'status shows the host only and normalised recipients');
select is((select position('token-123456' in s::text) + position('re_key' in s::text) from public.get_alert_status() s), 0,
  'status never returns the webhook token or the key');
reset role;
select is((select webhook_url from public.get_alert_secrets()), 'https://hooks.example.com/services/T0/B0/token-123456', 'service role reads the webhook');
select ok(not has_function_privilege('authenticated', 'public.get_alert_secrets()', 'execute')
  and not has_function_privilege('authenticated', 'public.detect_alerts()', 'execute')
  and not has_function_privilege('authenticated', 'public.purge_raw_results(integer)', 'execute'), 'users cannot run the server-side functions');
select is((select count(*)::int from public.audit_log where action = 'set alert_settings' and (data::text like '%token-123456%' or data::text like '%re_key%')), 0,
  'audited without secrets');

-- Detection ---------------------------------------------------------------------------------------
select is(public.detect_alerts(), 2, 'one low-coverage cycle and one day of query errors');
select is(public.detect_alerts(), 0, 'running again adds nothing');
select results_eq($$select kind, title, data ->> 'errors' from public.alerts order by kind$$,
  $$values ('coverage_low', 'Coverage 85.00% in Tenant A', null), ('query_error', '2 query error(s) in Tenant A', '2')$$,
  'coverage below 90% (not 95%, not older than 7 days) and errors grouped per day');

insert into public.collector_logs (step, level, message, created_at) values ('collector', 'debug', 'step lease', now() - interval '40 minutes');
select is(public.detect_alerts(), 0, 'a quiet collector is not reported while it is switched off');
select vault.create_secret('http://kong:8000/functions/v1/collector', 'collector_url');
select is(public.detect_alerts(), 1, 'switched on and silent for 40 minutes: collector_stale');
select is(public.detect_alerts(), 0, 'one alert per stop');
insert into public.collector_logs (step, level, message) values ('collector', 'debug', 'step lease');
select is(public.detect_alerts(), 0, 'a fresh tick clears the condition');

update public.alert_settings set enabled = false;
insert into public.scan_cycles (tenant_id, opened_at, closes_at, closed_at, status, coverage_pct)
values ('10000000-0000-0000-0000-00000000000b', now() - interval '2 days', now() - interval '1 hour', now() - interval '1 hour', 'closed', 10);
select is(public.detect_alerts(), 0, 'nothing is recorded while alerts are off');
update public.alert_settings set enabled = true;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.alerts), 0, 'viewers cannot read alerts');
reset role;

-- API budget --------------------------------------------------------------------------------------
insert into public.api_budget (tenant_id, minute, runs) values
  ('10000000-0000-0000-0000-00000000000a', date_trunc('minute', now()), 3),
  ('10000000-0000-0000-0000-00000000000a', date_trunc('day', now(), 'UTC'), 700),
  ('10000000-0000-0000-0000-00000000000b', date_trunc('minute', now()), 9);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select results_eq($$select runs_this_minute, runs_per_minute, runs_today, daily_run_limit, normal_left, reserve_left, active_runs, max_active_runs
  from public.budget_overview('10000000-0000-0000-0000-00000000000a')$$,
  $$values (3, 10, 703, 1000, 97, 200, 0, 4)$$, 'budget: minute, day, normal and reserve left, active runs');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select results_eq('select tenant_name from public.budget_overview()', $$values ('Tenant A')$$, 'viewer sees only its tenants'' budget');

-- RLS named by the spec ---------------------------------------------------------------------------
select is((select count(*)::int from public.raw_results), 0, 'viewer cannot read raw_results');
select results_eq('select hostname from public.v_computer_list', $$values ('A1')$$, 'viewer cannot read another tenant''s computers');
reset role;

-- Retention ---------------------------------------------------------------------------------------
insert into public.query_runs (id, tenant_id, provider, domain, platform, query_id, query_version, endpoint_ids, status)
select ('50000000-0000-0000-0000-00000000000' || n)::uuid, '10000000-0000-0000-0000-00000000000a', 'live_endpoint_search', 'programs', 'windows',
  (select id from public.query_catalog where platform = 'windows' and name = 'inv.programs' and version = 1), 1, '{ep-a1}', 'finished'
from generate_series(1, 3) n;
insert into public.raw_results (id, tenant_id, run_id, computer_id, rows, row_count, received_at, ingested_at) values
  ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a1', '[]', 0, now() - interval '100 days', now() - interval '100 days'),
  ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-0000000000a1', '[]', 0, now() - interval '100 days', null),
  ('70000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000a1', '[]', 0, now() - interval '10 days', now() - interval '10 days');
insert into public.snapshots (id, tenant_id, computer_id, domain, query_name, query_version, collected_at, row_count, content_hash, raw_result_id) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'programs', 'inv.programs', 1,
   now() - interval '100 days', 0, 'h', '70000000-0000-0000-0000-000000000001');
select is(public.purge_raw_results(90), 1, 'retention deletes only ingested raw results older than 90 days');
select results_eq('select id::text from public.raw_results order by id',
  $$values ('70000000-0000-0000-0000-000000000002'), ('70000000-0000-0000-0000-000000000003')$$, 'pending and recent ones stay');
select ok((select raw_result_id is null from public.snapshots where id = '40000000-0000-0000-0000-000000000001'), 'the snapshot stays, unlinked');

-- Program queries v2 ------------------------------------------------------------------------------
select is((select count(*)::int from public.query_catalog where domain = 'programs' and version = 2 and enabled), 4,
  'v2 of every program query (Windows, macOS, deb, rpm)');

-- A query version published mid-cycle: the open cycle keeps its versions, new computers get the current one.
insert into public.scan_cycles (id, tenant_id, opened_at, closes_at)
values ('60000000-0000-0000-0000-0000000000bb', '10000000-0000-0000-0000-00000000000b', now() - interval '1 hour', now() + interval '6 days');
select public.insert_cycle_tasks('60000000-0000-0000-0000-0000000000bb');
update public.scan_tasks set query_id = (select id from public.query_catalog where platform = 'windows' and name = 'inv.programs' and version = 1)
where cycle_id = '60000000-0000-0000-0000-0000000000bb'
  and query_id = (select id from public.query_catalog where platform = 'windows' and name = 'inv.programs' and version = 2);
select is(public.add_new_computer_tasks('60000000-0000-0000-0000-0000000000bb'), 0, 'existing computers get no task for another version');
select is((select count(*)::int from public.scan_tasks t join public.query_catalog q on q.id = t.query_id
  where t.cycle_id = '60000000-0000-0000-0000-0000000000bb' and q.name = 'inv.programs'), 1, 'one inv.programs task, the version the cycle opened with');
insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform) values
  ('20000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-00000000000b', 'ep-b2', 'B2', 'windows');
select ok(public.add_new_computer_tasks('60000000-0000-0000-0000-0000000000bb') > 0, 'a new computer gets its tasks');
select is((select q.version from public.scan_tasks t join public.query_catalog q on q.id = t.query_id
  where t.computer_id = '20000000-0000-0000-0000-0000000000b2' and q.name = 'inv.programs'), 2, 'with the current query version');

-- Offline computers: deferred without spending an attempt; no_response retries later the same day.
update public.scan_tasks set status = 'dispatched', claimed_at = now() where computer_id = '20000000-0000-0000-0000-0000000000b1';
select is(public.defer_offline_tasks(
    array(select id from public.scan_tasks where computer_id = '20000000-0000-0000-0000-0000000000b1'),
    now() + interval '1 hour', 'Offline at 14:05; next check 15:05 (America/Sao_Paulo)'),
  (select count(*)::int from public.scan_tasks where computer_id = '20000000-0000-0000-0000-0000000000b1'), 'every claimed offline task is deferred');
select results_eq($$select distinct status::text, attempts, next_attempt_at, claimed_at, last_error from public.scan_tasks
  where computer_id = '20000000-0000-0000-0000-0000000000b1'$$,
  $$values ('retry_scheduled', 0, now() + interval '1 hour', null::timestamptz, 'Offline at 14:05; next check 15:05 (America/Sao_Paulo)')$$,
  'deferred to the next check, not counted as an attempt');
update public.scan_tasks set status = 'no_response', attempts = case when domain = 'programs' then 2 else 0 end
where computer_id = '20000000-0000-0000-0000-0000000000b2';
select is(public.schedule_retries('10000000-0000-0000-0000-00000000000b', now() + interval '1 hour', now() + interval '1 day'),
  (select count(*)::int from public.scan_tasks where computer_id = '20000000-0000-0000-0000-0000000000b2'), 'no_response tasks are rescheduled');
select results_eq($$select domain::text, attempts, next_attempt_at from public.scan_tasks
  where computer_id = '20000000-0000-0000-0000-0000000000b2' and domain in ('programs', 'hardware') order by domain$$,
  $$values ('hardware', 1, now() + interval '1 hour'), ('programs', 3, now() + interval '1 day')$$,
  'later the same day, but the next daily window from the 3rd attempt');

select * from finish();
rollback;
