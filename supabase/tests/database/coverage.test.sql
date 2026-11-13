-- Coverage evidence: inventory_source, inventoried_at, coverage_status per computer; overview coverage counts.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
truncate public.tenants, public.software_titles, public.sophos_connection, public.audit_log cascade;
delete from public.profiles;

select plan(8);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000b', 'operator@example.com');
insert into public.tenants (id, sophos_tenant_id, name, id_type) values
  ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'partner');
insert into public.tenant_members (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000a', 'operator');
insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform, retired_at) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'ep-1', 'C1', 'windows', null),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'ep-2', 'C2', 'windows', null),
  ('20000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', 'ep-3', 'C3', 'windows', null),
  ('20000000-0000-0000-0000-0000000000a4', '10000000-0000-0000-0000-00000000000a', 'ep-4', 'C4', 'windows', null),
  ('20000000-0000-0000-0000-0000000000a5', '10000000-0000-0000-0000-00000000000a', 'ep-5', 'C5', 'windows', now());
insert into public.software_titles (id, kind, source, match_key, canonical_name) values
  ('30000000-0000-0000-0000-000000000001', 'program', 'programs', '7-zip|igor pavlov', '7-Zip');
insert into public.snapshots (tenant_id, computer_id, domain, query_name, query_version, collected_at, row_count, content_hash, applied_at) values
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'programs', 'inv.programs', 1, now() - interval '2 days', 1, 'h', now()),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', 'programs', 'dl.programs', 1, now() - interval '3 days', 1, 'h', now()),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a4', 'programs', 'inv.programs', 1, now() - interval '30 days', 1, 'h', now()),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a5', 'programs', 'inv.programs', 1, now() - interval '1 day', 1, 'h', now());
insert into public.installations (tenant_id, computer_id, title_id, domain, query_name, scope_key, username, version, row_hash, valid_from) values
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-000000000001', 'programs', 'dl.programs', '', null, '1', 'h', now() - interval '3 days');

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000000b', 'role', 'authenticated')::text, true);
set local role authenticated;

select results_eq($$select hostname, inventory_source, coverage_status from public.v_computer_list order by hostname$$,
  $$values ('C1', 'live_endpoint_search', 'current'), ('C2', 'data_lake', 'current'), ('C3', 'none', 'never'),
    ('C4', 'live_endpoint_search', 'stale'), ('C5', 'live_endpoint_search', 'current')$$,
  'source and coverage status per computer');
select ok((select inventoried_at from public.v_computer_list where hostname = 'C3') is null, 'never inventoried: no date');
select ok((select inventoried_at from public.v_computer_list where hostname = 'C2') > now() - interval '3 days 1 minute', 'inventoried_at takes any source');
select results_eq($$select (s->>'coverage_never')::int, (s->>'coverage_stale')::int, (s->>'coverage_current')::int
    from public.overview_stats('10000000-0000-0000-0000-00000000000a') s$$,
  $$values (1, 1, 2)$$, 'overview counts skip retired computers');
reset role;

update public.scan_settings set stale_after_days = 40;
set local role authenticated;
select is((select coverage_status from public.v_computer_list where hostname = 'C4'), 'current', 'stale_after_days = 40: 30 days old is current');
reset role;
select is((select stale_after_days from public.scan_settings), 40, 'stale_after_days is stored');
select throws_ok($$update public.scan_settings set stale_after_days = 0$$, '23514', null, 'stale_after_days = 0 is refused');
select is((select column_default from information_schema.columns where table_name = 'scan_settings' and column_name = 'stale_after_days'), '30', 'default 30');

select * from finish();
rollback;
