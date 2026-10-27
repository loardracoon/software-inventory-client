-- Phase 3: query catalog seed, capability status and probe access.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
-- Start from an empty app inside this transaction so data from local use cannot leak into the
-- assertions; the final rollback restores everything.
truncate public.tenants, public.software_titles, public.sophos_connection, public.audit_log,
  public.dictionary_cache, public.hub_submissions cascade;
delete from public.profiles;
delete from vault.secrets where name = 'sophos_client_secret';

select plan(16);

-- Seed ------------------------------------------------------------------------------------------
select results_eq(
  'select platform::text, count(*)::int from public.query_catalog where version = 1 group by 1 order by 1',
  $$values ('linux', 7), ('macos', 6), ('windows', 6)$$,
  'version 1 has 6 Windows, 6 macOS and 7 Linux queries');
select is((select count(*) from public.query_catalog where cardinality(required_tables) = 0), 0::bigint,
  'every query lists its required tables');
select is((select count(*) from public.query_catalog where sql ~ '^\s|\s$'), 0::bigint, 'SQL is trimmed');
select ok((select sql from public.query_catalog where platform = 'windows' and name = 'inv.packages') like '%chocolatey_packages%',
  'Windows packages read Chocolatey');
select is((select required_tables from public.query_catalog where platform = 'macos' and name = 'inv.packages'),
  '{homebrew_packages,npm_packages,python_packages}'::text[], 'macOS packages need Homebrew, npm and pip');
select is((select count(*) from public.query_catalog where platform = 'linux' and domain = 'programs' and version = 1), 2::bigint,
  'Linux programs are split into deb and rpm');

-- Status ----------------------------------------------------------------------------------------
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer@example.com');
insert into public.tenants (id, sophos_tenant_id, name, id_type) values
  ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'partner'),
  ('10000000-0000-0000-0000-00000000000b', 'sophos-b', 'Tenant B', 'partner');
insert into public.tenant_members (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000a', 'viewer');
insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform, last_seen_at) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'ep-a', 'WIN-A', 'windows', now()),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'ep-b', 'WIN-B', 'windows', now());
-- Tenant A's Windows agent lacks vscode_extensions and chocolatey_packages; tenant B is not probed.
insert into public.platform_capabilities (tenant_id, platform, osquery_tables) values
  ('10000000-0000-0000-0000-00000000000a', 'windows',
   '{system_info,os_version,platform_info,logical_drives,programs,users,chrome_extensions,firefox_addons,npm_packages,python_packages,osquery_registry}');

select is(
  public.missing_tables('10000000-0000-0000-0000-00000000000a',
    (select id from public.query_catalog where platform = 'windows' and name = 'inv.packages')),
  '{chocolatey_packages}'::text[], 'missing_tables lists what the platform lacks');
select is(
  public.missing_tables('10000000-0000-0000-0000-00000000000a',
    (select id from public.query_catalog where platform = 'windows' and name = 'inv.programs' and version = 1)),
  '{}'::text[], 'a runnable query has nothing missing');
select is(
  public.missing_tables('10000000-0000-0000-0000-00000000000b',
    (select id from public.query_catalog where platform = 'windows' and name = 'inv.programs' and version = 1)),
  null::text[], 'an unprobed platform returns null');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$select name, tenants_ok, tenants_missing, tenants_not_probed, missing_tables
    from public.query_catalog_status() where platform = 'windows' order by name$$,
  $$values
    ('inv.disks', 1, 0, 1, '{}'::text[]),
    ('inv.extensions', 1, 0, 1, '{}'::text[]),
    ('inv.hardware', 1, 0, 1, '{}'::text[]),
    ('inv.ide_extensions', 0, 1, 1, '{vscode_extensions}'::text[]),
    ('inv.packages', 0, 1, 1, '{chocolatey_packages}'::text[]),
    ('inv.programs', 1, 0, 1, '{}'::text[])$$,
  'admin sees the status across both tenants');
select is(
  (select sum(tenants_ok + tenants_missing + tenants_not_probed)::int from public.query_catalog_status() where platform <> 'windows'),
  0, 'platforms without computers are not counted');
select results_eq(
  $$select tenants_ok, tenants_not_probed from public.query_catalog_status('10000000-0000-0000-0000-00000000000b')
    where platform = 'windows' and name = 'inv.programs'$$,
  $$values (0, 1)$$, 'status can be filtered to one tenant');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$select tenants_ok, tenants_missing, tenants_not_probed from public.query_catalog_status()
    where platform = 'windows' and name = 'inv.packages'$$,
  $$values (0, 1, 0)$$, 'viewer only counts its own tenant');
select throws_ok($$select public.record_api_run('10000000-0000-0000-0000-00000000000a')$$, '42501', null,
  'browser users cannot spend the API budget');
select throws_ok($$insert into public.query_catalog (domain, platform, version, name, sql) values ('programs', 'windows', 2, 'x', 'select 1')$$,
  '42501', null, 'the catalog changes only by migration');
reset role;

select public.record_api_run('10000000-0000-0000-0000-00000000000a');
select public.record_api_run('10000000-0000-0000-0000-00000000000a', 2);
select is((select runs from public.api_budget where tenant_id = '10000000-0000-0000-0000-00000000000a'), 3,
  'record_api_run adds up runs in the current minute');

select * from finish();
rollback;
