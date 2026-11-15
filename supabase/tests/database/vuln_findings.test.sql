-- Stage 3: remediation deadlines. A finding opens when a certain match appears and closes when it goes (or becomes
-- uncertain); its due date follows the severity (tenant SLA settings) and the CISA KEV date; a returning match is a new finding.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select set_config('app.audit_purge', 'on', true);
truncate public.tenants, public.software_titles, public.audit_log, public.dictionary_cache, public.vuln_cache cascade;
delete from public.profiles;

select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'other@example.com');
insert into public.tenants (id, sophos_tenant_id, name, id_type) values
  ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'partner'),
  ('10000000-0000-0000-0000-00000000000b', 'sophos-b', 'Tenant B', 'partner');
insert into public.tenant_members (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000a', 'viewer'),
  ('00000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-00000000000b', 'viewer');
insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'ep-1', 'PC1', 'windows'),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'ep-2', 'PC2', 'windows');
insert into public.software_titles (id, kind, source, match_key, canonical_name, vendor) values
  ('30000000-0000-0000-0000-000000000001', 'program', 'programs', '7-zip|igor pavlov', '7-Zip', 'Igor Pavlov');
insert into public.installations (tenant_id, computer_id, title_id, domain, query_name, scope_key, version, row_hash, valid_from) values
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000001', 'programs', 'inv.programs', '', '23.01', 'h1', now()),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-000000000001', 'programs', 'inv.programs', '', '23.01', 'h2', now());
insert into public.vuln_cache (product_key, vuln_id, severity, cvss_score) values
  ('program|igor pavlov|7-zip', 'CVE-1', 'CRITICAL', 9.8),
  ('program|igor pavlov|7-zip', 'CVE-2', 'HIGH', 7.5),
  ('program|igor pavlov|7-zip', 'CVE-3', 'MEDIUM', 5.0),
  ('program|igor pavlov|7-zip', 'CVE-4', 'LOW', 2.0),
  ('program|igor pavlov|7-zip', 'CVE-5', null, null);

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.match(v text, uncertain boolean default false) returns void language sql as $$
  insert into public.title_version_vulns (tenant_id, title_id, version, product_key, vuln_id, uncertain, run_id)
  values ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001', '23.01', 'program|igor pavlov|7-zip', v, uncertain, gen_random_uuid());
$$;
create function pg_temp.due(v text) returns timestamptz language sql as $$
  select due_at from public.vuln_findings where vuln_id = v and resolved_at is null $$;

-- Opening and due dates -------------------------------------------------------------------------------------------
select pg_temp.match('CVE-1'); select pg_temp.match('CVE-2'); select pg_temp.match('CVE-3'); select pg_temp.match('CVE-4'); select pg_temp.match('CVE-5');
select is((select count(*)::int from public.vuln_findings where resolved_at is null), 5, 'open: one finding per certain match');
select is(pg_temp.due('CVE-1'), now() + interval '15 days', 'due: critical 15 days');
select is(pg_temp.due('CVE-2'), now() + interval '30 days', 'due: high 30 days');
select is(pg_temp.due('CVE-3'), now() + interval '90 days', 'due: medium 90 days');
select is(pg_temp.due('CVE-4'), now() + interval '180 days', 'due: low 180 days');
select is(pg_temp.due('CVE-5'), now() + interval '180 days', 'due: no severity counts as low');
select is((select severity from public.vuln_findings where vuln_id = 'CVE-1'), 'CRITICAL', 'the finding keeps the severity');

-- The tenant's own deadlines ------------------------------------------------------------------------------------------
update public.scan_settings set sla_critical_days = 7 where tenant_id = '10000000-0000-0000-0000-00000000000a';
select is(pg_temp.due('CVE-1'), now() + interval '7 days', 'settings: a changed deadline moves the open findings of the tenant');
select throws_ok($$update public.scan_settings set sla_high_days = 0 where tenant_id = '10000000-0000-0000-0000-00000000000a'$$, '23514', null, 'settings: a deadline is 1 to 365 days');

-- KEV tightens the due date --------------------------------------------------------------------------------------------
update public.vuln_cache set kev_added = current_date, kev_due = current_date + 2 where vuln_id = 'CVE-2';
select is(pg_temp.due('CVE-2'), ((current_date + 2)::timestamp + interval '23 hours 59 minutes 59 seconds') at time zone 'UTC', 'kev: the CISA date wins when it is earlier');
update public.vuln_cache set kev_due = current_date + 365 where vuln_id = 'CVE-2';
select is(pg_temp.due('CVE-2'), now() + interval '30 days', 'kev: a later CISA date does not loosen the deadline');

-- Closing -----------------------------------------------------------------------------------------------------------------
delete from public.title_version_vulns where vuln_id = 'CVE-3';
select is((select resolved_at is not null from public.vuln_findings where vuln_id = 'CVE-3'), true, 'close: a match that goes away resolves its finding');
update public.title_version_vulns set uncertain = true where vuln_id = 'CVE-4';
select is((select resolved_at is not null from public.vuln_findings where vuln_id = 'CVE-4'), true, 'close: a match that becomes uncertain resolves it');
update public.title_version_vulns set uncertain = false where vuln_id = 'CVE-4';
select is((select count(*)::int from public.vuln_findings where vuln_id = 'CVE-4'), 2, 'reopen: a certain match again is a new finding, the old one stays');
select pg_temp.match('CVE-3');
select is((select count(*)::int from public.vuln_findings where vuln_id = 'CVE-3' and resolved_at is null), 1, 'reopen: a match that comes back opens a new finding');
-- Uncertain matches have no deadline ------------------------------------------------------------------------------------
insert into public.vuln_cache (product_key, vuln_id, severity, cvss_score) values ('program|igor pavlov|7-zip', 'CVE-6', 'HIGH', 7.0);
select pg_temp.match('CVE-6', true);
select is((select count(*)::int from public.vuln_findings where vuln_id = 'CVE-6'), 0, 'uncertain: a "may apply" match opens no finding');

-- The console view --------------------------------------------------------------------------------------------------------
update public.vuln_findings set due_at = now() - interval '1 day' where vuln_id = 'CVE-1' and resolved_at is null;
update public.vuln_findings set due_at = now() - interval '1 day' where vuln_id = 'CVE-4' and resolved_at is not null;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select is((select status from public.v_vuln_findings where vuln_id = 'CVE-1'), 'overdue', 'view: an open finding past its date is overdue');
select is((select status from public.v_vuln_findings where vuln_id = 'CVE-3' and resolved_at is not null), 'resolved_in_time', 'view: resolved before the date');
select is((select status from public.v_vuln_findings where vuln_id = 'CVE-4' and resolved_at is not null), 'resolved_late', 'view: resolved after the date');
select is((select computers from public.v_vuln_findings where vuln_id = 'CVE-1'), 2::bigint, 'view: the computers where the version is installed now');
reset role;

-- Access ----------------------------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.v_vuln_findings where resolved_at is null), 5, 'rls: a member reads the findings of its tenant');
select throws_ok($$insert into public.vuln_findings (tenant_id, title_id, version, product_key, vuln_id, first_seen_at, due_at)
  values ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001', '1', 'k', 'X', now(), now())$$, '42501', null, 'rls: no one writes findings directly');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select is((select count(*)::int from public.v_vuln_findings), 0, 'rls: a member of another tenant reads none');
reset role;

-- Backfill ----------------------------------------------------------------------------------------------------------------------
truncate public.vuln_findings;
select is(public.vuln_findings_backfill(), 5, 'backfill: one open finding per certain match already stored');

select * from finish();
rollback;
