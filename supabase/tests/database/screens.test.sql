-- Phase 6: read models for the screens (tenant filter, masking, search filters, KPIs).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
-- Start from an empty app inside this transaction so data from local use cannot leak into the
-- assertions; the final rollback restores everything.
truncate public.tenants, public.software_titles, public.sophos_connection, public.audit_log,
  public.dictionary_cache, public.hub_submissions cascade;
delete from public.profiles;
delete from vault.secrets where name = 'sophos_client_secret';

select plan(27);

-- Fixtures ----------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'analyst@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer@example.com');
insert into public.tenants (id, sophos_tenant_id, name, id_type) values
  ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'partner'),
  ('10000000-0000-0000-0000-00000000000b', 'sophos-b', 'Tenant B', 'partner');
insert into public.tenant_members (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000a', 'analyst'),
  ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000a', 'viewer');
insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform, associated_user) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'ep-w1', 'W1', 'windows', 'CORP\alice'),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'ep-m1', 'M1', 'macos', 'bob'),
  ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'ep-w2', 'W2', 'windows', 'carol');
insert into public.software_titles (id, kind, source, match_key, canonical_name) values
  ('30000000-0000-0000-0000-000000000001', 'extension', 'chrome', 'inomeogfingihgjfjlpeplalcfajhgai', 'Chrome Remote Desktop'),
  ('30000000-0000-0000-0000-000000000002', 'program', 'programs', '7-zip|igor pavlov', '7-Zip'),
  ('30000000-0000-0000-0000-000000000003', 'package', 'npm', 'typescript', 'typescript');
insert into public.dictionary_cache (kind, source, match_key, canonical_name, category_slug, attention_level, confidence, method) values
  ('extension', 'chrome', 'inomeogfingihgjfjlpeplalcfajhgai', 'Chrome Remote Desktop', 'remote-access/remote-desktop-and-support', 'review', 0.97, 'jev_auto');
insert into public.snapshots (id, tenant_id, computer_id, domain, query_name, query_version, collected_at, row_count, content_hash) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'programs', 'inv.programs', 1, now(), 1, 'h'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1', 'extensions', 'inv.extensions', 1, now(), 1, 'h');
insert into public.installations (tenant_id, computer_id, title_id, domain, query_name, scope_key, username, version, row_hash, valid_from, valid_to) values
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000001', 'extensions', 'inv.extensions', 'alice|Default', 'alice', '124.0', 'h1', now() - interval '20 days', null),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000002', 'programs', 'inv.programs', '', null, '23.01', 'h2', now() - interval '20 days', null),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-000000000002', 'programs', 'inv.programs', '', null, '22.0', 'h3', now() - interval '20 days', null),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000003', 'packages', 'inv.packages', '/npm/ts', null, '5.4.5', 'h4', '2026-10-01', '2026-10-10'),
  ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-000000000001', 'extensions', 'inv.extensions', 'carol|Default', 'carol', '124.0', 'h5', now() - interval '20 days', null);
insert into public.change_events (tenant_id, computer_id, title_id, domain, change, from_version, to_version, snapshot_id, detected_at) values
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000002', 'programs', 'updated', '22.0', '23.01', '40000000-0000-0000-0000-000000000001', now() - interval '1 day'),
  ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-000000000001', 'extensions', 'added', null, '124.0', '40000000-0000-0000-0000-000000000002', now() - interval '2 days');
insert into public.scan_cycles (id, tenant_id, opened_at, closes_at) values
  ('60000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', now() - interval '1 day', now() + interval '6 days');
insert into public.query_runs (id, tenant_id, provider, domain, platform, query_id, query_version, endpoint_ids, status) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'live_endpoint_search', 'programs', 'windows',
   (select id from public.query_catalog where platform = 'windows' and name = 'inv.programs' and version = 1), 1, '{ep-w1}', 'finished');
insert into public.scan_tasks (tenant_id, cycle_id, computer_id, domain, query_id, status, attempts, next_attempt_at, last_run_id) values
  ('10000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'programs',
   (select id from public.query_catalog where platform = 'windows' and name = 'inv.programs' and version = 1), 'collected', 0, now(), '50000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'hardware',
   (select id from public.query_catalog where platform = 'windows' and name = 'inv.hardware'), 'collected', 0, now(), null),
  ('10000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', 'programs',
   (select id from public.query_catalog where platform = 'macos' and name = 'inv.programs' and version = 1), 'retry_scheduled', 1, '2026-12-01 14:00Z', null);
insert into public.raw_results (tenant_id, run_id, computer_id, rows, row_count) values
  ('10000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a1', '[]', 0);

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- Viewer of tenant A ------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select results_eq('select hostname, associated_user, user_masked from public.v_computer_list order by hostname',
  $$values ('M1', null::text, true), ('W1', null::text, true)$$, 'viewer: own tenant only, users masked');
select results_eq(
  $$select cycle_status, programs, extensions, attention_level1_slugs from public.v_computer_list where hostname = 'W1'$$,
  $$values ('collected', 1::bigint, 1::bigint, '{remote-access}'::text[])$$, 'computer list: status, counts and attention categories');
select results_eq($$select cycle_status, next_attempt_at from public.v_computer_list where hostname = 'M1'$$,
  $$values ('retry_scheduled', '2026-12-01 14:00Z'::timestamptz)$$, 'computer list: retry status and next attempt');
select results_eq($$select username, level2_name, hostname from public.v_installation_details where kind = 'extension'$$,
  $$values (null::text, 'Remote desktop and support', 'W1')$$, 'installation details: classified, username masked');
select is((select count(*)::int from public.v_change_log), 1, 'viewer: change log of its tenant only');
select results_eq('select hostname, query_name, attempts from public.v_retry_queue', $$values ('M1', 'inv.programs', 1)$$, 'retry queue');
select results_eq('select endpoints, collected from public.v_recent_runs', $$values (1, 1::bigint)$$, 'recent runs count what came back');
select is((select count(*)::int from public.computer_cycle_tasks('20000000-0000-0000-0000-0000000000a1')), 2, 'computer tasks in the open cycle');
select is((select count(*)::int from public.search_titles(p_user := 'alice')), 2, 'viewer: the user filter is ignored');
select results_eq('select level2_name, computers from public.needs_attention()', $$values ('Remote desktop and support', 1::bigint)$$,
  'needs attention counts the viewer''s computers only');
reset role;

-- Analyst of tenant A -----------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select is((select associated_user from public.v_computer_list where hostname = 'W1'), 'CORP\alice', 'analyst sees users');
select results_eq($$select canonical_name from public.search_titles(p_user := 'ali')$$, $$values ('Chrome Remote Desktop')$$,
  'analyst: search by user');
reset role;

-- Global admin ------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select results_eq('select canonical_name, computers, total_count from public.search_titles() order by 1',
  $$values ('7-Zip', 2::bigint, 2::bigint), ('Chrome Remote Desktop', 2::bigint, 2::bigint)$$, 'search: open titles across tenants');
select results_eq($$select canonical_name from public.search_titles(p_kind := 'extension')$$, $$values ('Chrome Remote Desktop')$$, 'filter by kind');
select results_eq($$select canonical_name from public.search_titles(p_category := 'remote-access')$$, $$values ('Chrome Remote Desktop')$$, 'filter by level-1 category');
select results_eq($$select canonical_name from public.search_titles(p_attention := '{review}')$$, $$values ('Chrome Remote Desktop')$$, 'filter by attention');
select results_eq($$select canonical_name, computers from public.search_titles(p_platform := 'macos')$$, $$values ('7-Zip', 1::bigint)$$, 'filter by platform');
select results_eq($$select canonical_name, computers from public.search_titles(p_version_below := '23')$$, $$values ('7-Zip', 1::bigint)$$, 'filter by version below');
select results_eq($$select canonical_name from public.search_titles(p_as_of := '2026-10-05') where kind = 'package'$$, $$values ('typescript')$$, 'installed on a past date');
select results_eq($$select canonical_name from public.search_titles(p_query := 'zip')$$, $$values ('7-Zip')$$, 'search text');
select results_eq($$select canonical_name, computers from public.search_titles(p_tenant_id := '10000000-0000-0000-0000-00000000000b')$$,
  $$values ('Chrome Remote Desktop', 1::bigint)$$, 'one tenant');
select is((select count(*)::int from public.search_titles(p_limit := 1, p_offset := 1)), 1, 'paged on the server');
select results_eq(
  $$select (s->>'computers')::int, (s->>'titles')::int, (s->>'extension_installs')::int, (s->>'changes_7d')::int, (s->>'updated_7d')::int
    from public.overview_stats('10000000-0000-0000-0000-00000000000a') s$$,
  $$values (2, 2, 1, 1, 1)$$, 'overview KPIs');
select results_eq('select count(*)::int, sum(added)::int, sum(updated)::int from public.weekly_changes()', $$values (12, 1, 1)$$,
  '12 weeks of changes, empty weeks included');
select results_eq('select tasks, collected, retrying, computers, computers_collected from public.cycle_overview()',
  $$values (3::bigint, 2::bigint, 1::bigint, 2::bigint, 1::bigint)$$, 'cycle overview');
select results_eq('select version, computers from public.title_versions(''30000000-0000-0000-0000-000000000002'')',
  $$values ('23.01', 1::bigint), ('22.0', 1::bigint)$$, 'version distribution, newest first');
reset role;

set local role anon;
select throws_ok('select * from public.v_computer_list', '42501', null, 'anon cannot read the screens');
reset role;

select * from finish();
rollback;
