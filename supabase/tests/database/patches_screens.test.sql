-- Stage 3: patch state on the screens (v_computer_list), in overview_stats and in the evidence package.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select set_config('app.audit_purge', 'on', true);
truncate public.tenants, public.software_titles, public.audit_log, public.dictionary_cache, public.vuln_cache cascade;
delete from public.profiles;

select plan(10);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'admin@example.com');
insert into public.tenants (id, sophos_tenant_id, name, id_type) values ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'partner');
insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform, scope_tags) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'ep-1', 'W1', 'windows', '{pci}'),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'ep-2', 'W2', 'windows', '{}'),
  ('20000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', 'ep-3', 'W3', 'windows', '{}'),
  ('20000000-0000-0000-0000-0000000000a4', '10000000-0000-0000-0000-00000000000a', 'ep-4', 'W4', 'windows', '{}');

create function pg_temp.patch(p_computer text, p_uid text, p_kb text, p_at text, p_to timestamptz default null) returns void language sql as $$
  insert into public.hardware_versions (tenant_id, computer_id, domain, item_key, attrs, row_hash, valid_from, valid_to)
  values ('10000000-0000-0000-0000-00000000000a', ('20000000-0000-0000-0000-0000000000' || p_computer)::uuid, 'patches', p_uid,
    jsonb_build_object('kb', p_kb, 'title', 'Update ' || p_kb, 'installed_at', p_at, 'installed_by', 'SYSTEM'), md5(p_uid || p_at), now() - interval '200 days', p_to);
$$;
create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- W1: patched 10 days ago (and an older one); W2: last patch 100 days ago; W3: no patch data; W4: a value that is not a date.
select pg_temp.patch('a1', 'u1', 'KB1', to_char(current_date - 10, 'YYYY-MM-DD') || 'T08:00:00Z');
select pg_temp.patch('a1', 'u2', 'KB2', to_char(current_date - 40, 'YYYY-MM-DD') || 'T08:00:00Z');
select pg_temp.patch('a2', 'u3', 'KB3', to_char(current_date - 100, 'YYYY-MM-DD') || 'T08:00:00Z');
select pg_temp.patch('a4', 'u4', 'KB4', 'yesterday');
-- A patch that a later snapshot removed is not current and not in a report for today.
select pg_temp.patch('a1', 'u5', 'KB5', to_char(current_date - 5, 'YYYY-MM-DD') || 'T08:00:00Z', now() - interval '1 day');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');

-- The screens ------------------------------------------------------------------------------------------------------
select results_eq($$select hostname, last_patch_at, patch_status from public.v_computer_list order by hostname$$,
  $$values ('W1', current_date - 10, 'current'), ('W2', current_date - 100, 'stale'), ('W3', null::date, 'unknown'), ('W4', null::date, 'unknown')$$,
  'view: last patch of the open rows and its status (default 60 days)');
reset role;
update public.scan_settings set patch_stale_days = 120 where tenant_id = '10000000-0000-0000-0000-00000000000a';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select is((select patch_status from public.v_computer_list where hostname = 'W2'), 'current', 'view: the tenant stale days decide');
reset role;
update public.scan_settings set patch_stale_days = 60 where tenant_id = '10000000-0000-0000-0000-00000000000a';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select is((select (public.overview_stats() ->> 'patch_tracked_computers')::int), 2, 'overview: computers with a dated patch (a value that is not a date does not count)');
select is((select (public.overview_stats() ->> 'patch_stale_computers')::int), 1, 'overview: computers without a recent patch');
select is((select (public.overview_stats('10000000-0000-0000-0000-00000000000a') ->> 'patch_stale_computers')::int), 1, 'overview: by tenant');

-- The evidence package ---------------------------------------------------------------------------------------------
select results_eq($$select x ->> 'hostname', x ->> 'patch_status' from jsonb_array_elements(public.audit_report_data('10000000-0000-0000-0000-00000000000a', now()) -> 'computers') x order by 1$$,
  $$values ('W1', 'current'), ('W2', 'stale'), ('W3', 'unknown'), ('W4', 'unknown')$$, 'evidence: computers carry the patch status');
select is((select x ->> 'last_patch_at' from jsonb_array_elements(public.audit_report_data('10000000-0000-0000-0000-00000000000a', now()) -> 'computers') x where x ->> 'hostname' = 'W1'),
  to_char(current_date - 10, 'YYYY-MM-DD'), 'evidence: and the last patch date');
select results_eq($$select x ->> 'hostname', x ->> 'kb', x ->> 'installed_by' from jsonb_array_elements(public.audit_report_data('10000000-0000-0000-0000-00000000000a', now()) -> 'patches') x order by 1, 2$$,
  $$values ('W1', 'KB1', 'SYSTEM'), ('W1', 'KB2', 'SYSTEM'), ('W2', 'KB3', 'SYSTEM'), ('W4', 'KB4', 'SYSTEM')$$, 'evidence: one row per current patch');
select is((select count(*)::int from jsonb_array_elements(public.audit_report_data('10000000-0000-0000-0000-00000000000a', now()) -> 'patches') x where x ->> 'kb' = 'KB5'),
  0, 'evidence: a removed patch is not listed as of now');
select is((select count(*)::int from jsonb_array_elements(public.audit_report_data('10000000-0000-0000-0000-00000000000a', now(), 'pci') -> 'patches') x), 2, 'evidence: a scope tag narrows the patches');
reset role;

select * from finish();
rollback;
