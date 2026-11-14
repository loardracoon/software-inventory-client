-- Evidence packages: point-in-time report data, package storage, access rules and audit logging.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select set_config('app.audit_purge', 'on', true);
truncate public.tenants, public.software_titles, public.sophos_connection, public.audit_log cascade;
delete from public.profiles;

select plan(27);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'first@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'operator@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'other@example.com');
insert into public.tenants (id, sophos_tenant_id, name, id_type) values
  ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'partner'),
  ('10000000-0000-0000-0000-00000000000b', 'sophos-b', 'Tenant B', 'partner');
insert into public.tenant_members (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000a', 'operator'),
  ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000a', 'viewer'),
  ('00000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-00000000000b', 'operator');
-- C1 in scope pci; C2 retired after the as-of date; C3 retired before it; C4 created after it; C5 stale.
insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform, associated_user, owner, criticality, scope_tags, created_at, retired_at) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'ep-1', 'C1', 'windows', 'alice', 'Ana Silva', 'high', '{pci}', now() - interval '30 days', null),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'ep-2', 'C2', 'windows', 'bob', null, null, '{}', now() - interval '30 days', now() - interval '5 days'),
  ('20000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', 'ep-3', 'C3', 'windows', null, null, null, '{}', now() - interval '30 days', now() - interval '20 days'),
  ('20000000-0000-0000-0000-0000000000a4', '10000000-0000-0000-0000-00000000000a', 'ep-4', 'C4', 'windows', null, null, null, '{}', now() - interval '2 days', null),
  ('20000000-0000-0000-0000-0000000000a5', '10000000-0000-0000-0000-00000000000a', 'ep-5', 'C5', 'macos', null, null, null, '{}', now() - interval '30 days', null);
insert into public.software_titles (id, kind, source, match_key, canonical_name, vendor) values
  ('30000000-0000-0000-0000-000000000001', 'program', 'programs', '7-zip|igor pavlov', '7-Zip', 'Igor Pavlov'),
  ('30000000-0000-0000-0000-000000000002', 'program', 'programs', 'old tool|acme', 'Old Tool', 'Acme'),
  ('30000000-0000-0000-0000-000000000003', 'program', 'programs', 'new tool|acme', 'New Tool', 'Acme');
insert into public.software_titles (id, kind, source, match_key, canonical_name) values ('30000000-0000-0000-0000-000000000004', 'program', 'programs', 'mac tool|acme', 'Mac Tool');
insert into public.snapshots (tenant_id, computer_id, domain, query_name, query_version, collected_at, row_count, content_hash, applied_at) values
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'programs', 'inv.programs', 1, now() - interval '2 days', 1, 'h', now()),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a5', 'programs', 'inv.programs', 1, now() - interval '31 days', 1, 'h', now());
insert into public.installations (tenant_id, computer_id, title_id, domain, query_name, scope_key, version, row_hash, valid_from, valid_to) values
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000001', 'programs', 'inv.programs', '', '1', 'h', now() - interval '20 days', null),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-000000000001', 'programs', 'inv.programs', '', '1', 'h', now() - interval '20 days', null),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000002', 'programs', 'inv.programs', '', '1', 'h', now() - interval '20 days', now() - interval '15 days'),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000003', 'programs', 'inv.programs', '', '1', 'h', now() - interval '5 days', null);
insert into public.installations (tenant_id, computer_id, title_id, domain, query_name, scope_key, version, row_hash, valid_from) values
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a5', '30000000-0000-0000-0000-000000000004', 'programs', 'inv.programs', '', '1', 'h', now() - interval '20 days');
insert into public.vuln_cache (product_key, vuln_id, severity, cvss_score, kev_added, kev_due, epss) values
  ('7-zip', 'CVE-2024-0001', 'HIGH', 8.1, current_date - 30, current_date + 5, 0.5),
  ('7-zip', 'CVE-2024-0002', 'LOW', 2.0, null, null, null),
  ('old-tool', 'CVE-2024-0003', 'LOW', 2.0, null, null, null),
  ('new-tool', 'CVE-2024-0004', 'LOW', 2.0, null, null, null);
insert into public.title_version_vulns (tenant_id, title_id, version, product_key, vuln_id, uncertain, fixed_in, run_id) values
  ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001', '1', '7-zip', 'CVE-2024-0001', false, '2', gen_random_uuid()),
  ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001', '1', '7-zip', 'CVE-2024-0002', true, null, gen_random_uuid()),
  ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000002', '1', 'old-tool', 'CVE-2024-0003', false, null, gen_random_uuid()),
  ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000003', '1', 'new-tool', 'CVE-2024-0004', false, null, gen_random_uuid());
insert into public.vuln_cache (product_key, vuln_id, severity) values ('mac-tool', 'CVE-2024-0005', 'LOW');
insert into public.title_version_vulns (tenant_id, title_id, version, product_key, vuln_id, platforms, run_id) values
  ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000004', '1', 'mac-tool', 'CVE-2024-0005', '{windows}', gen_random_uuid());
insert into public.policies (id, tenant_id, version, status, published_at) values
  ('40000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 1, 'published', now());
insert into public.policy_rules (policy_id, position, name, class, kinds, owner, review_by) values
  ('40000000-0000-0000-0000-00000000000a', 1, 'Tolerated tools', 'tolerated_app', '{program}', 'Ana Silva', current_date + 10),
  ('40000000-0000-0000-0000-00000000000a', 2, 'Core', 'core_system', '{program}', null, null);
insert into public.title_version_policy (tenant_id, title_id, version, policy_version, class) values
  ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001', '1', 1, 'tolerated_app');

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.rep(scope text default null) returns jsonb language sql as $$
  select public.audit_report_data('10000000-0000-0000-0000-00000000000a', now() - interval '10 days', scope) $$;
create function pg_temp.cov(k text) returns int language sql as $$ select (pg_temp.rep() -> 'coverage' ->> k)::int $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select results_eq($$select e ->> 'hostname' from jsonb_array_elements(pg_temp.rep() -> 'computers') e order by 1$$,
  $$values ('C1'), ('C2'), ('C5')$$, 'point in time: computers retired before or created after the as-of date are left out');
select is(pg_temp.rep() -> 'computers' -> 0 ->> 'associated_user', 'alice', 'operator sees associated_user');
select is((pg_temp.rep() ->> 'users_masked')::boolean, false, 'operator: users_masked = false');
select results_eq($$select e ->> 'hostname' from jsonb_array_elements(pg_temp.rep('pci') -> 'computers') e$$,
  $$values ('C1')$$, 'scope filter');
select results_eq($$select e ->> 'canonical_name' || ' ' || (e ->> 'hostname') from jsonb_array_elements(pg_temp.rep() -> 'software') e order by 1$$,
  $$values ('7-Zip C1'), ('7-Zip C2'), ('Mac Tool C5')$$, 'point in time: installations valid at the as-of date (ended before and started after are left out)');
select is((select e ->> 'policy_class' from jsonb_array_elements(pg_temp.rep() -> 'software') e where e ->> 'hostname' = 'C1' and e ->> 'canonical_name' = '7-Zip'),
  'tolerated_app', 'software has the current policy class');
select results_eq($$select pg_temp.cov('total'), pg_temp.cov('current'), pg_temp.cov('stale'), pg_temp.cov('never')$$,
  $$values (3, 1, 1, 1)$$, 'coverage counts');
select results_eq($$select e ->> 'vuln_id' || ' ' || (e ->> 'computers') || ' ' || (e ->> 'kev') from jsonb_array_elements(pg_temp.rep() -> 'vulnerabilities') e order by 1$$,
  $$values ('CVE-2024-0001 2 true')$$, 'vulnerabilities: certain matches of titles present at the date (not ended or new ones), with computer count');
select results_eq($$select e ->> 'name' from jsonb_array_elements(pg_temp.rep() -> 'exceptions') e$$,
  $$values ('Tolerated tools')$$, 'exceptions come from the published policy');
select is((select count(*)::int from jsonb_array_elements(pg_temp.rep() -> 'vulnerabilities') e where e ->> 'vuln_id' = 'CVE-2024-0005'), 0, 'a Windows-only vulnerability does not match a title installed only on macOS');
select is(pg_temp.rep() -> 'policy' ->> 'version', '1', 'policy version');
select is(jsonb_array_length(pg_temp.rep() -> 'policy' -> 'rules'), 2, 'policy rules in the export format');
select matches(pg_temp.rep() ->> 'scope_statement', '^Computers managed by Sophos Central', 'scope statement default');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select throws_ok($$select pg_temp.rep()$$, '42501', null, 'viewer cannot get report data');
select throws_ok($$select public.record_audit_report('10000000-0000-0000-0000-00000000000a', now(), null, '{}', 'x', '\x00', false)$$,
  '42501', null, 'authenticated cannot record a report');
reset role;

set local role service_role;
select lives_ok($$select public.record_audit_report('10000000-0000-0000-0000-00000000000a', now(), 'pci', '{"a":1}', 'abc', '\x504b', false)$$,
  'service_role records a report');
reset role;
select is((select count(*)::int from public.audit_log where action = 'audit_report' and data ->> 'manifest_sha256' = 'abc'
  and data ->> 'id' = (select id::text from public.audit_reports)), 1, 'the report is in the audit log');
select throws_ok($$update public.audit_reports set scope_tag = 'x'$$, '42501', null, 'update is blocked');
select throws_ok($$delete from public.audit_reports$$, '42501', null, 'delete is blocked');
select throws_ok($$insert into public.audit_reports (tenant_id, as_of, manifest, manifest_sha256, archive, users_masked)
  values ('10000000-0000-0000-0000-00000000000a', now(), '{}', 'x', decode(repeat('00', 26214401), 'hex'), false)$$,
  '23514', null, 'archive over 25 MB is refused');

create function pg_temp.rid() returns uuid language sql security definer as $$ select id from public.audit_reports $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select is(public.get_audit_report_archive(pg_temp.rid()), null, 'viewer gets no archive');
select is((select count(*)::int from public.v_audit_reports), 1, 'viewer lists the package metadata');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select is(public.get_audit_report_archive(pg_temp.rid()), '\x504b'::bytea, 'operator gets the archive');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select is(public.get_audit_report_archive(pg_temp.rid()), null, 'another tenant gets null');

reset role;
select public.record_audit_report('10000000-0000-0000-0000-00000000000a', now(), null, '{}', 'def', '\x00'::bytea, false, '00000000-0000-0000-0000-00000000000b');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select lives_ok($$select public.remove_user('00000000-0000-0000-0000-00000000000b')$$, 'a user who generated a package can be removed');
reset role;
select is((select generated_by from public.audit_reports where manifest_sha256 = 'def'), '00000000-0000-0000-0000-00000000000b'::uuid, 'the report keeps generated_by');
select is((select count(*)::int from public.audit_reports), 2, 'the report still exists');
select * from finish();
rollback;
