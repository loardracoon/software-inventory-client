-- Stage 3: end of life on the screens — the Software list (status, filter), the title versions, the computer list and
-- the overview counts.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select set_config('app.audit_purge', 'on', true);
truncate public.tenants, public.software_titles, public.audit_log, public.dictionary_cache, public.eol_cache cascade;
delete from public.profiles;

select plan(13);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'admin@example.com');
insert into public.tenants (id, sophos_tenant_id, name, id_type) values ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'partner');
insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform, os_name, os_build) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'ep-1', 'PC1', 'windows', 'Windows 11 Pro', '26100'),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'ep-2', 'PC2', 'windows', 'Windows 11 Pro', '99999');
insert into public.software_titles (id, kind, source, match_key, canonical_name, vendor) values
  ('30000000-0000-0000-0000-000000000001', 'program', 'programs', '7-zip|igor pavlov', '7-Zip', 'Igor Pavlov'),
  ('30000000-0000-0000-0000-000000000002', 'program', 'programs', 'other|acme', 'Other', 'Acme');
insert into public.installations (tenant_id, computer_id, title_id, domain, query_name, scope_key, version, row_hash, valid_from) values
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000001', 'programs', 'inv.programs', '', '23.01', 'h1', now()),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-000000000001', 'programs', 'inv.programs', '', '26.05', 'h2', now()),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000002', 'programs', 'inv.programs', '', '1.0', 'h3', now());
select public.eol_replace('10000000-0000-0000-0000-00000000000a',
  '[{"title_id":"30000000-0000-0000-0000-000000000001","version":"23.01","product_key":"k","release":"23","eol_from":"2024-06-01","status":"eol"},
    {"title_id":"30000000-0000-0000-0000-000000000001","version":"26.05","product_key":"k","release":"26","eol_from":null,"status":"supported"}]',
  '[{"computer_id":"20000000-0000-0000-0000-0000000000a1","release":"11-24h2-w","eol_from":"2026-12-01","status":"ending_soon"}]');

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');

-- Software list ---------------------------------------------------------------------------------------------
select results_eq($$select canonical_name, support_status, eol_from from public.search_titles() order by canonical_name$$,
  $$values ('7-Zip', 'eol', '2024-06-01'::date), ('Other', null::text, null::date)$$,
  'software: the worst status of the installed versions and the earliest end date; no match = no status');
select results_eq($$select canonical_name from public.search_titles(p_support := 'eol')$$, $$values ('7-Zip')$$, 'software: filter eol');
select is((select count(*)::int from public.search_titles(p_support := 'ending_soon')), 0, 'software: filter ending_soon finds none here');
select is((select count(*)::int from public.search_titles(p_support := '')), 2, 'software: an empty filter lists everything');

-- Title page --------------------------------------------------------------------------------------------------
select results_eq($$select version, support_status, release from public.title_versions('30000000-0000-0000-0000-000000000001') order by version$$,
  $$values ('23.01', 'eol', '23'), ('26.05', 'supported', '26')$$, 'title: each installed version with its support status and release');
select is((select support_status from public.title_versions('30000000-0000-0000-0000-000000000002')), null, 'title: a version with no release has no status');

-- Computers -----------------------------------------------------------------------------------------------------
select results_eq($$select hostname, os_eol_release, os_eol_status from public.v_computer_list order by hostname$$,
  $$values ('PC1', '11-24h2-w', 'ending_soon'), ('PC2', null::text, null::text)$$, 'computers: the OS release and status; an unknown build has none');
select is((select os_eol_from from public.v_computer_list where hostname = 'PC1'), '2026-12-01'::date, 'computers: the OS end date');

-- Overview ------------------------------------------------------------------------------------------------------
select is((select (public.overview_stats() ->> 'eol_titles')::int), 1, 'overview: software titles with an end-of-life version');
select is((select (public.overview_stats() ->> 'ending_soon_titles')::int), 0, 'overview: none ending soon');
select results_eq($$select (public.overview_stats() ->> 'eol_computers')::int, (public.overview_stats() ->> 'ending_soon_computers')::int$$,
  $$values (0, 1)$$, 'overview: computers whose OS is end of life or ending soon');

-- Evidence package ------------------------------------------------------------------------------------------------
select is((select jsonb_agg(x ->> 'support_status' order by x ->> 'version') from jsonb_array_elements(public.audit_report_data('10000000-0000-0000-0000-00000000000a', now()) -> 'software') x
           where x ->> 'canonical_name' = '7-Zip'), '["eol", "supported"]'::jsonb, 'evidence: software rows carry the support status');
select is((select x ->> 'os_eol_status' from jsonb_array_elements(public.audit_report_data('10000000-0000-0000-0000-00000000000a', now()) -> 'computers') x where x ->> 'hostname' = 'PC1'),
  'ending_soon', 'evidence: computer rows carry the OS support status');
reset role;

select * from finish();
rollback;
