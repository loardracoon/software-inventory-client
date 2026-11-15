-- Stage 3: end-of-life cache from the Hub feed, the inputs of the local matching, the stored results, RLS and grants.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select set_config('app.audit_purge', 'on', true);
truncate public.tenants, public.software_titles, public.audit_log, public.dictionary_cache, public.eol_cache cascade;
delete from public.profiles;

select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'outsider@example.com');
insert into public.tenants (id, sophos_tenant_id, name, id_type) values
  ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'partner'),
  ('10000000-0000-0000-0000-00000000000b', 'sophos-b', 'Tenant B', 'partner');
insert into public.tenant_members (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000a', 'viewer'),
  ('00000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-00000000000b', 'viewer');
insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform, os_name, os_version, os_build) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'ep-1', 'PC1', 'windows', 'Windows 11 Pro', '10.0', '26100'),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'ep-2', 'MAC1', 'macos', 'macOS', '15.1', null),
  ('20000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', 'ep-3', 'PC3', 'windows', 'Windows 11 Pro', '10.0', '99999'),
  ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'ep-4', 'PCB', 'windows', 'Windows 10 Pro', '10.0', '19045');
insert into public.software_titles (id, kind, source, match_key, canonical_name, vendor) values
  ('30000000-0000-0000-0000-000000000002', 'program', 'programs', '7-zip|igor pavlov', '7-Zip', 'Igor Pavlov'),
  ('30000000-0000-0000-0000-000000000003', 'program', 'programs', 'noeol|acme', 'No EOL Tool', 'Acme');
insert into public.installations (tenant_id, computer_id, title_id, domain, query_name, scope_key, version, row_hash, valid_from) values
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000002', 'programs', 'inv.programs', '', '23.01', 'h1', now()),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-000000000002', 'programs', 'inv.programs', '', '26.05', 'h2', now()),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a3', '30000000-0000-0000-0000-000000000002', 'programs', 'inv.programs', '', null, 'h3', now()),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000003', 'programs', 'inv.programs', '', '1.0', 'h4', now()),
  ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-000000000002', 'programs', 'inv.programs', '', '23.01', 'h5', now());

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- 1. Feed cache ---------------------------------------------------------------------------------------------
select is(public.apply_eol_changes($$[
  {"product_key": "program|igor pavlov|7-zip", "slug": "7-zip", "seq": 4, "releases": [
    {"name": "23", "label": "23", "is_eol": true, "eol_from": "2024-06-01", "latest_name": "23.01"},
    {"name": "26", "label": "26", "is_eol": false, "eol_from": "2028-01-01", "latest_name": "26.05"}]},
  {"product_key": "os:windows", "slug": "windows", "seq": 7, "releases": [{"name": "11-24h2-w", "label": "11 24H2 (W)", "is_eol": false, "eol_from": "2026-10-13", "latest_name": "10.0.26100"}]},
  {"product_key": "", "slug": "x", "releases": []}
  ]$$, 7), '{"upserted": 2, "skipped": 1}'::jsonb, 'cache: stores the items with a key and counts the skipped');
select is((select eol_last_seq from public.hub_connection where id = 1), 7::bigint, 'cache: the sequence moves to the page''s next_since');
select is((select jsonb_array_length(releases) from public.eol_cache where product_key = 'program|igor pavlov|7-zip'), 2, 'cache: releases kept as a list');
select is(public.apply_eol_changes($$[{"product_key": "program|igor pavlov|7-zip", "slug": "7-zip", "seq": 9, "releases": [{"name": "26", "label": "26", "is_eol": false, "eol_from": "2028-06-01", "latest_name": "26.05"}]}]$$, 9),
  '{"upserted": 1, "skipped": 0}'::jsonb, 'cache: a newer item replaces the releases of its product');
select is((select jsonb_array_length(releases) from public.eol_cache where product_key = 'program|igor pavlov|7-zip'), 1, 'cache: the replaced list is the new one');

-- 2. Inputs of the matching ---------------------------------------------------------------------------------
select results_eq($$select version, product_key from public.eol_inputs('10000000-0000-0000-0000-00000000000a') order by version$$,
  $$values ('', 'program|igor pavlov|7-zip'), ('23.01', 'program|igor pavlov|7-zip'), ('26.05', 'program|igor pavlov|7-zip')$$,
  'inputs: the current (title, version) pairs of products that have a cache entry; titles without one are left out');
select is((select count(*)::int from public.eol_inputs('10000000-0000-0000-0000-00000000000a', null, null, 2)), 2, 'inputs: paged by limit');
select results_eq($$select platform::text, os_build from public.eol_os_inputs('10000000-0000-0000-0000-00000000000a') order by os_build nulls first$$,
  $$values ('macos', null), ('windows', '26100'), ('windows', '99999')$$, 'os inputs: the OS facts of the tenant''s computers');

select results_eq($$select product_key from public.eol_cache_get(array['os:windows', 'program|igor pavlov|7-zip', 'nope']) order by 1$$,
  $$values ('os:windows'), ('program|igor pavlov|7-zip')$$, 'cache read: the releases of the asked keys; unknown keys are left out');

-- 3. Results ------------------------------------------------------------------------------------------------
select is(public.eol_replace('10000000-0000-0000-0000-00000000000a',
  $$[{"title_id": "30000000-0000-0000-0000-000000000002", "version": "23.01", "product_key": "program|igor pavlov|7-zip", "release": "23", "eol_from": "2024-06-01", "status": "eol"}]$$,
  $$[{"computer_id": "20000000-0000-0000-0000-0000000000a1", "release": "11-24h2-w", "eol_from": "2026-10-13", "status": "eol"}]$$),
  '{"titles": 1, "computers": 1}'::jsonb, 'replace: stores the matches of the tenant');
select results_eq($$select os_eol_release, os_eol_status from public.computers where id = '20000000-0000-0000-0000-0000000000a1'$$, $$values ('11-24h2-w', 'eol')$$, 'replace: the OS result is on the computer');
select is((select os_eol_status from public.computers where id = '20000000-0000-0000-0000-0000000000a3'), null, 'replace: a computer with no match has no status (unknown)');
select is(public.eol_replace('10000000-0000-0000-0000-00000000000a', '[]', '[]'), '{"titles": 0, "computers": 0}'::jsonb, 'replace: a full run replaces the earlier one');
select is((select os_eol_status from public.computers where id = '20000000-0000-0000-0000-0000000000a1'), null, 'replace: an OS that no longer matches loses its status');
select public.eol_replace('10000000-0000-0000-0000-00000000000a',
  $$[{"title_id": "30000000-0000-0000-0000-000000000002", "version": "23.01", "product_key": "program|igor pavlov|7-zip", "release": "23", "eol_from": "2024-06-01", "status": "eol"}]$$, '[]');

-- 4. Which tenants are due ---------------------------------------------------------------------------------
select is((select array_agg(tenant_id::text order by tenant_id::text) from public.eol_due_tenants()), array['10000000-0000-0000-0000-00000000000b']::text[],
  'due: the tenant not matched yet; the one just matched waits');
update public.eol_eval_state set evaluated_at = now() - interval '2 days';
select is((select count(*)::int from public.eol_due_tenants()), 2, 'due: a match from an earlier day is renewed (support dates move with the calendar)');

-- 5. Access -------------------------------------------------------------------------------------------------
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.title_version_eol), 1, 'rls: a member reads the results of its tenant');
select throws_ok($$select public.apply_eol_changes('[]', 1)$$, '42501', null, 'grants: users cannot write the cache');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select is((select count(*)::int from public.title_version_eol), 0, 'rls: a member of another tenant reads nothing of this one');
reset role;

select * from finish();
rollback;
