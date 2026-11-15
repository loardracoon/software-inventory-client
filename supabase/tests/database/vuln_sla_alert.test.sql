-- Stage 3: the overdue-remediation alert (one per finding) and the deadline columns of the evidence package.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select set_config('app.audit_purge', 'on', true);
truncate public.tenants, public.software_titles, public.audit_log, public.dictionary_cache, public.vuln_cache, public.alerts cascade;
delete from public.profiles;

select plan(11);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'admin@example.com');
insert into public.tenants (id, sophos_tenant_id, name, id_type) values ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'partner');
insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'ep-1', 'PC1', 'windows');
insert into public.software_titles (id, kind, source, match_key, canonical_name, vendor) values
  ('30000000-0000-0000-0000-000000000001', 'program', 'programs', '7-zip|igor pavlov', '7-Zip', 'Igor Pavlov');
insert into public.installations (tenant_id, computer_id, title_id, domain, query_name, scope_key, version, row_hash, valid_from) values
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000001', 'programs', 'inv.programs', '', '23.01', 'h1', now());
insert into public.vuln_cache (product_key, vuln_id, severity, cvss_score) values
  ('program|igor pavlov|7-zip', 'CVE-1', 'CRITICAL', 9.8),
  ('program|igor pavlov|7-zip', 'CVE-2', 'HIGH', 7.5),
  ('program|igor pavlov|7-zip', 'CVE-3', 'MEDIUM', 5.0),
  ('program|igor pavlov|7-zip', 'CVE-4', 'LOW', 2.0);
insert into public.title_version_vulns (tenant_id, title_id, version, product_key, vuln_id, uncertain, run_id)
select '10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001', '23.01', 'program|igor pavlov|7-zip', v, false, gen_random_uuid()
from unnest(array['CVE-1', 'CVE-2', 'CVE-3', 'CVE-4']) v;
update public.alert_settings set enabled = true where id = 1;

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- CVE-1 is past its date, CVE-2 is open and in time, CVE-3 was resolved late.
update public.vuln_findings set due_at = now() - interval '2 days' where vuln_id = 'CVE-1';
update public.vuln_findings set due_at = now() - interval '5 days' where vuln_id = 'CVE-3';
delete from public.title_version_vulns where vuln_id = 'CVE-3';
-- CVE-4 has been overdue for a month (an old finding, e.g. from the first backfill): the screens show it, no alert is sent.
update public.vuln_findings set due_at = now() - interval '30 days' where vuln_id = 'CVE-4';

-- Alert ------------------------------------------------------------------------------------------------------------------
select is(public.detect_alerts(), 1, 'alert: one overdue open finding raises one alert');
select results_eq($$select kind, tenant_id from public.alerts where kind = 'sla_overdue'$$, $$values ('sla_overdue', '10000000-0000-0000-0000-00000000000a'::uuid)$$, 'alert: kind and tenant');
select ok((select body from public.alerts where kind = 'sla_overdue') like '%CVE-1%7-Zip%', 'alert: the body names the CVE and the software');
select is(public.detect_alerts(), 0, 'alert: the same finding does not alert twice');
update public.vuln_findings set due_at = now() - interval '1 day' where vuln_id = 'CVE-2';
select is(public.detect_alerts(), 1, 'alert: a finding that becomes overdue later raises its own alert');
select is((select count(*)::int from public.alerts where kind = 'sla_overdue'), 2, 'alert: resolved and in-time findings raised none');
select is((select count(*)::int from public.alerts where kind = 'sla_overdue' and body like '%CVE-4%'), 0, 'alert: a finding overdue for more than 7 days raises none (no flood after a backfill)');

-- Evidence ---------------------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select results_eq($$select x ->> 'vuln_id', x ->> 'status' from jsonb_array_elements(public.audit_report_data('10000000-0000-0000-0000-00000000000a', now()) -> 'vulnerabilities') x order by 1$$,
  $$values ('CVE-1', 'overdue'), ('CVE-2', 'overdue'), ('CVE-4', 'overdue')$$, 'evidence: vulnerability rows carry the finding status');
select ok((select (x ->> 'due_at') is not null from jsonb_array_elements(public.audit_report_data('10000000-0000-0000-0000-00000000000a', now()) -> 'vulnerabilities') x where x ->> 'vuln_id' = 'CVE-1'),
  'evidence: and the due date');
select is((public.audit_report_data('10000000-0000-0000-0000-00000000000a', now()) -> 'remediation') - 'oldest_open_days',
  '{"open": 0, "overdue": 3, "resolved_in_time": 0, "resolved_late": 1}'::jsonb, 'evidence: the remediation summary counts findings by status');
select ok((public.audit_report_data('10000000-0000-0000-0000-00000000000a', now()) -> 'remediation' ->> 'oldest_open_days')::int >= 0, 'evidence: the age of the oldest open finding');
reset role;

select * from finish();
rollback;
