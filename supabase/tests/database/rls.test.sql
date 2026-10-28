-- RLS and masking: who reads what. Run with `npm run test:db`.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
-- Start from an empty app inside this transaction so data from local use cannot leak into the
-- assertions; the final rollback restores everything.
truncate public.tenants, public.software_titles, public.sophos_connection, public.audit_log,
  public.dictionary_cache, public.hub_submissions cascade;
delete from public.profiles;
delete from vault.secrets where name = 'sophos_client_secret';

select plan(31);

-- Fixtures (as postgres) ------------------------------------------------------------------------
-- The first auth user becomes admin (Phase 0 bootstrap); the others start as viewer.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'operator@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'outsider@example.com');

insert into public.tenants (id, sophos_tenant_id, name, id_type) values
  ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'tenant'),
  ('10000000-0000-0000-0000-00000000000b', 'sophos-b', 'Tenant B', 'tenant');

insert into public.tenant_members (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000a', 'operator'),
  ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000a', 'viewer'),
  ('00000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-00000000000b', 'operator');

insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform, associated_user) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'ep-a', 'host-a', 'windows', 'alice'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'ep-b', 'host-b', 'macos', 'bob');

insert into public.software_titles (id, kind, source, match_key, canonical_name) values
  ('30000000-0000-0000-0000-000000000001', 'extension', 'chrome', 'inomeogfingihgjfjlpeplalcfajhgai', 'Chrome Remote Desktop');

insert into public.snapshots (id, tenant_id, computer_id, domain, query_name, query_version, collected_at, row_count, content_hash) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   'extensions', 'inv.extensions', 1, now(), 1, 'hash');

insert into public.installations (tenant_id, computer_id, title_id, domain, query_name, scope_key, username, version, path, row_hash, valid_from, first_seen_snapshot, last_seen_snapshot)
values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001',
        'extensions', 'inv.extensions', 'alice|Default', 'alice', '1.0',
        'C:' || chr(92) || 'Users' || chr(92) || 'alice' || chr(92) || 'AppData' || chr(92) || 'ext',
        'row', now(), '40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001');

insert into public.query_runs (id, tenant_id, provider, domain, platform, query_version) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'live_endpoint_search', 'extensions', 'windows', 1);
insert into public.raw_results (tenant_id, run_id, computer_id, rows, row_count) values
  ('10000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', '[]', 0);
insert into public.collector_logs (step, tenant_id, message) values ('dispatch', '10000000-0000-0000-0000-00000000000a', 'ok');
insert into public.api_budget (tenant_id, minute, runs) values ('10000000-0000-0000-0000-00000000000a', date_trunc('minute', now()), 1);

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Bootstrap and coverage ------------------------------------------------------------------------
select is((select role::text from public.profiles where email = 'admin@example.com'), 'admin', 'first user is admin');
select is((select role::text from public.profiles where email = 'viewer@example.com'), 'viewer', 'later users start as viewer');
select is(
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity),
  0::bigint, 'RLS is enabled on every table in public');

-- Anonymous ------------------------------------------------------------------------------------
set local role anon;
select throws_ok('select * from public.computers', '42501', null, 'anon cannot read computers');
select throws_ok('select * from public.v_computers', '42501', null, 'anon cannot read v_computers');
reset role;

-- Viewer of tenant A -----------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is((select count(*) from public.computers), 0::bigint, 'viewer cannot read computers directly');
select is((select count(*) from public.installations), 0::bigint, 'viewer cannot read installations directly');
select is((select count(*) from public.v_computers), 1::bigint, 'viewer sees only tenant A in v_computers');
select ok((select associated_user is null and user_masked from public.v_computers), 'viewer gets associated_user masked');
select ok(
  (select username is null and scope_key is null and path like '%Users%***%' and path not like '%alice%' from public.v_installations),
  'viewer gets username, scope and the user folder in path masked');
select is((select count(*) from public.raw_results), 0::bigint, 'viewer cannot read raw_results');
select is((select count(*) from public.collector_logs), 0::bigint, 'viewer cannot read collector_logs');
select is((select count(*) from public.api_budget), 0::bigint, 'viewer cannot read api_budget');
select is((select count(*) from public.scan_settings), 1::bigint, 'viewer reads the scan settings of tenant A');
select is_empty('update public.scan_settings set batch_size = 10 returning 1', 'viewer cannot change scan settings');
select throws_ok(
  $$insert into public.local_overrides (title_id, category_slug) values ('30000000-0000-0000-0000-000000000001', 'other/other')$$,
  '42501', null, 'viewer cannot create local overrides');
select is((select count(*) from public.audit_log), 0::bigint, 'viewer cannot read the audit log');
reset role;

-- Analyst of tenant A ----------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is((select associated_user from public.computers), 'alice', 'operator reads usernames directly');
select is((select username from public.v_installations), 'alice', 'operator reads usernames in v_installations');
select is((select count(*) from public.raw_results), 0::bigint, 'operator cannot read raw_results');
select is((select count(*) from public.tenants), 1::bigint, 'operator sees only its tenant');
reset role;

-- Analyst of tenant B only -----------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-00000000000d');
select is((select hostname from public.v_computers), 'host-b', 'outsider sees only tenant B computers');
select is((select count(*) from public.v_installations), 0::bigint, 'outsider sees no tenant A installations');
reset role;

-- Global admin -----------------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is((select count(*) from public.v_computers), 2::bigint, 'admin sees every tenant');
select is((select count(*) from public.raw_results), 1::bigint, 'admin reads raw_results');
select isnt_empty(
  $$update public.scan_settings set batch_size = 25 where tenant_id = '10000000-0000-0000-0000-00000000000a' returning 1$$,
  'admin changes scan settings');
select lives_ok(
  $$insert into public.local_overrides (title_id, category_slug) values ('30000000-0000-0000-0000-000000000001', 'remote-access/remote-desktop-and-support')$$,
  'admin creates a local override');
select lives_ok(
  $$update public.profiles set role = 'operator' where email = 'viewer@example.com'$$,
  'admin changes a role');
select bag_eq(
  $$select action from public.audit_log where user_id = '00000000-0000-0000-0000-00000000000a'$$,
  $$values ('update scan_settings'), ('insert local_overrides'), ('update profiles')$$,
  'settings, overrides and role changes are audited');
select is(
  (select count(*) from public.audit_log where action = 'insert tenant_members'),
  3::bigint, 'membership changes are audited');
select is(
  (select user_id from public.audit_log where action = 'update profiles'),
  '00000000-0000-0000-0000-00000000000a'::uuid, 'audit rows record who did it');
reset role;

select * from finish();
rollback;
