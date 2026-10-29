-- Phase 10b: known vulnerabilities. The Hub feed cache, the matcher RPCs (events, KEV alert, stale
-- matches), the policy fields, RLS per tenant, and the read models of the screens.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
truncate public.tenants, public.software_titles, public.audit_log, public.dictionary_cache, public.hub_submissions,
  public.alerts, public.vuln_cache cascade;
delete from public.profiles;
delete from public.maintenance_state;

select plan(46);

-- Fixtures: 7-Zip 23.01 (affected), 26.05 (fixed) and one without a version in tenant A; 7-Zip in B ----
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer@example.com');
insert into public.tenants (id, sophos_tenant_id, name, id_type) values
  ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'partner'),
  ('10000000-0000-0000-0000-00000000000b', 'sophos-b', 'Tenant B', 'partner');
insert into public.tenant_members (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000a', 'viewer');
insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'ep-1', 'PC1', 'windows'),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'ep-2', 'PC2', 'windows'),
  ('20000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', 'ep-3', 'PC3', 'windows'),
  ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'ep-4', 'PC4', 'windows');
insert into public.software_titles (id, kind, source, match_key, canonical_name, vendor) values
  ('30000000-0000-0000-0000-000000000001', 'program', 'programs', '7-zip 23.01 (x64)|igor pavlov', '7-Zip 23.01 (x64)', 'Igor Pavlov'),
  ('30000000-0000-0000-0000-000000000002', 'program', 'programs', '7-zip|igor pavlov', '7-Zip', 'Igor Pavlov');
insert into public.installations (tenant_id, computer_id, title_id, domain, query_name, scope_key, version, row_hash, valid_from) values
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000001', 'programs', 'inv.programs', '', '23.01', 'h1', now()),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-000000000002', 'programs', 'inv.programs', '', '26.05', 'h2', now()),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a3', '30000000-0000-0000-0000-000000000002', 'programs', 'inv.programs', '', null, 'h3', now()),
  ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-000000000002', 'programs', 'inv.programs', '', '23.01', 'h4', now());
update public.alert_settings set enabled = true where id = 1;

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- 1. Feed cache ---------------------------------------------------------------------------------------------
select is(public.apply_vulnerability_changes($$[
  {"product_key": "program|igor pavlov|7-zip", "vuln_id": "CVE-2025-0411", "removed": false, "severity": "HIGH", "cvss_score": 7.0,
   "kev_added": "2025-02-06", "kev_due": "2025-02-27", "epss": 0.5, "references": ["https://nvd.nist.gov/vuln/detail/CVE-2025-0411"],
   "ranges": [{"version_start": null, "start_inclusive": null, "version_end": "24.09", "end_inclusive": false, "exact_version": null, "source": "nvd"}], "seq": 4},
  {"product_key": "program|igor pavlov|7-zip", "vuln_id": "CVE-2022-29072", "removed": false, "severity": "CRITICAL", "cvss_score": 9.8, "epss": 0.02,
   "ranges": [{"exact_version": "26.05"}], "seq": 5},
  {"product_key": null, "vuln_id": "CVE-2000-0001", "removed": false, "seq": 6}
]$$::jsonb, 6), '{"removed": 0, "skipped": 1, "upserted": 2}'::jsonb, 'a feed page is upserted; an item without a product is skipped');
select is((select vuln_last_seq from public.hub_connection where id = 1), 6::bigint, 'the vulnerability sequence moves on');
select ok(exists (select 1 from public.maintenance_state where key = 'vulns_changed'), 'a change marks vulns_changed');
select is((select refs from public.vuln_cache where vuln_id = 'CVE-2025-0411'), array['https://nvd.nist.gov/vuln/detail/CVE-2025-0411'], 'references are kept');
select results_eq('select tenant_id from public.vuln_due_tenants()',
  $$values ('10000000-0000-0000-0000-00000000000a'::uuid), ('10000000-0000-0000-0000-00000000000b'::uuid)$$, 'never matched tenants are due');

-- 2. Matcher RPCs -------------------------------------------------------------------------------------------
select results_eq($$select title_id::text, version, product_key from public.vuln_eval_inputs('10000000-0000-0000-0000-00000000000a')$$,
  $$values ('30000000-0000-0000-0000-000000000001', '23.01', 'program|igor pavlov|7-zip'),
           ('30000000-0000-0000-0000-000000000002', '', 'program|igor pavlov|7-zip'),
           ('30000000-0000-0000-0000-000000000002', '26.05', 'program|igor pavlov|7-zip')$$,
  'the inputs are the installed pairs of products with CVEs, both spellings');
select is((select count(*)::int from public.vuln_product_ranges(array['program|igor pavlov|7-zip'])), 2, 'the ranges of a product');

-- What vuln-match.ts gives for these pairs.
select is(public.vuln_store_matches('10000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001', $$[
  {"title_id": "30000000-0000-0000-0000-000000000001", "version": "23.01", "product_key": "program|igor pavlov|7-zip", "vuln_id": "CVE-2025-0411", "uncertain": false, "fixed_in": "24.09"},
  {"title_id": "30000000-0000-0000-0000-000000000002", "version": "", "product_key": "program|igor pavlov|7-zip", "vuln_id": "CVE-2025-0411", "uncertain": true, "fixed_in": "24.09"},
  {"title_id": "30000000-0000-0000-0000-000000000002", "version": "26.05", "product_key": "program|igor pavlov|7-zip", "vuln_id": "CVE-2022-29072", "uncertain": false, "fixed_in": null},
  {"title_id": "30000000-0000-0000-0000-000000000002", "version": "26.05", "product_key": "program|igor pavlov|7-zip", "vuln_id": "CVE-9999-0001", "uncertain": false, "fixed_in": null}
]$$), '{"new": 2, "alerts": 1, "stored": 3}'::jsonb, 'matches are stored; a CVE not in the cache is ignored; certain ones are new; one KEV alert');
select results_eq($$select kind, title from public.alerts$$,
  $$values ('vuln_kev', 'Known exploited vulnerability in Tenant A: CVE-2025-0411')$$, 'the KEV alert names the tenant and the CVE');
select ok((select body like '%7-Zip 23.01 (x64) 23.01%Fixed in 24.09.%' from public.alerts), 'the alert names the affected title, version and fix');
select is((select count(*)::int from public.vuln_match_events), 2, 'two events for Changes (the uncertain match has none)');

-- The next full run: the same matches are not new, nothing is alerted again, the stale match goes.
select is(public.vuln_store_matches('10000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002', $$[
  {"title_id": "30000000-0000-0000-0000-000000000001", "version": "23.01", "product_key": "program|igor pavlov|7-zip", "vuln_id": "CVE-2025-0411", "uncertain": false, "fixed_in": "24.09"},
  {"title_id": "30000000-0000-0000-0000-000000000002", "version": "", "product_key": "program|igor pavlov|7-zip", "vuln_id": "CVE-2025-0411", "uncertain": true, "fixed_in": "24.09"}
]$$), '{"new": 0, "alerts": 0, "stored": 2}'::jsonb, 'a second run creates no new events or alerts');
select is(public.vuln_finish_eval('10000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002', false),
  '{"changed": true, "removed": 1}'::jsonb, 'finishing removes the match the run did not store');
select ok((select changed_at is not null from public.vuln_eval_state where tenant_id = '10000000-0000-0000-0000-00000000000a'), 'the tenant is marked changed');
select results_eq('select tenant_id from public.vuln_due_tenants()', $$values ('10000000-0000-0000-0000-00000000000b'::uuid)$$,
  'a finished tenant is no longer due');

-- 3. Policy fields --------------------------------------------------------------------------------------------
select is((select max_cvss from public.title_version_vuln_inputs('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001', '23.01')),
  7.0, 'the highest CVSS of a version');
select results_eq($$select max_cvss, kev, max_epss from public.title_version_vuln_inputs('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000002', '')$$,
  $$values (0::numeric, false, 0::numeric)$$, 'an uncertain match does not count in the policy fields');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select lives_ok($$select public.policy_save_rule('10000000-0000-0000-0000-00000000000a', jsonb_build_object('name', 'Exploited', 'class', 'unsanctioned_app',
  'match', 'any', 'kinds', jsonb_build_array('program'), 'enabled', true, 'conditions',
  '[{"field": "kev", "operator": "equals", "value": "true"}, {"field": "cvss", "operator": "gte", "value": "9"}, {"field": "epss", "operator": "between", "value": "0.1", "value2": "1"}]'::jsonb))$$,
  'a rule with kev, cvss and epss conditions saves');
select throws_ok($$select public.policy_save_rule('10000000-0000-0000-0000-00000000000a', jsonb_build_object('name', 'Bad', 'class', 'unsanctioned_app',
  'match', 'all', 'kinds', jsonb_build_array('program'), 'enabled', true, 'conditions', '[{"field": "cvss", "operator": "contains", "value": "9"}]'::jsonb))$$,
  '23514', null, 'a text operator on cvss is refused');
select results_eq($$select version, max_cvss, kev from public.policy_preview_inputs('10000000-0000-0000-0000-00000000000a')
  where title_id = '30000000-0000-0000-0000-000000000001'$$, $$values ('23.01', 7.0::numeric, true)$$, 'the editor preview reads the vulnerability fields');
select lives_ok($$select public.policy_publish('10000000-0000-0000-0000-00000000000a')$$, 'publish');
reset role;
select is((select count(*)::int from public.policy_eval_inputs('10000000-0000-0000-0000-00000000000a', false) where kev), 1, 'the evaluator reads kev per version');
update public.policies set evaluated_at = now() - interval '1 minute' where tenant_id = '10000000-0000-0000-0000-00000000000a' and status = 'published';
update public.vuln_eval_state set changed_at = now() where tenant_id = '10000000-0000-0000-0000-00000000000a';
select is((select full_run from public.policy_due_tenants() where tenant_id = '10000000-0000-0000-0000-00000000000a'), true,
  'changed vulnerability matches make the policy evaluate the tenant fully');

-- 4. Screens and RLS --------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select results_eq($$select vulns::int, vulns_kev::int, vulns_high::int, vulns_medium::int, vulns_low::int, vulns_possible::int, max_cvss
  from public.search_titles(p_query := '7-zip', p_vuln := 'kev')$$,
  $$values (1, 1, 1, 0, 0, 0, 7.0::numeric)$$, 'Software: one product row with its CVE counts by severity; a CVE certain on one version is not "may apply"');
select is((select vuln_top from public.search_titles(p_query := '7-zip')),
  '[{"id": "CVE-2025-0411", "kev": true, "score": 7.0, "severity": "HIGH", "uncertain": false}]'::jsonb, 'Software: the top CVEs for the tooltip');
select results_eq($$select hostname, vulns - 'top', jsonb_array_length(vulns -> 'top') from public.v_computer_list order by hostname$$,
  $$values ('PC1', '{"critical": 0, "high": 1, "medium": 0, "low": 0, "kev": 1, "possible": 0}'::jsonb, 1),
           ('PC2', '{"critical": 0, "high": 0, "medium": 0, "low": 0, "kev": 0, "possible": 0}'::jsonb, 0),
           ('PC3', '{"critical": 0, "high": 0, "medium": 0, "low": 0, "kev": 0, "possible": 1}'::jsonb, 1)$$,
  'Computers: CVE counts per computer for the attention icons');
select is((select vulns -> 'top' -> 0 ->> 'title' from public.v_computer_list where hostname = 'PC1'), '7-Zip 23.01 (x64)', 'the computer tooltip names the title');
select is((select count(*)::int from public.search_titles(p_vuln := 'critical')), 0, 'the critical filter leaves out products without a critical CVE');
select results_eq($$select vuln_id, versions, fixed_in, uncertain, computers::int from public.title_vulns('30000000-0000-0000-0000-000000000002')$$,
  $$values ('CVE-2025-0411', array['', '23.01'], '24.09', false, 2)$$, 'the title page lists the CVE of every spelling with the affected versions');
select results_eq($$select hostname, vulns::int, vulns_kev::int, vulns_possible::int from public.v_installation_details order by hostname$$,
  $$values ('PC1', 1, 1, 0), ('PC2', 0, 0, 0), ('PC3', 0, 0, 1)$$, 'installations carry their counts (viewer sees tenant A only)');
select is(public.vuln_overview() - 'synced_at' - 'evaluated_at',
  '{"kev": 1, "high": 1, "vulns": 1, "cached": 2, "titles": 1, "critical": 0, "possible": 0, "possible_titles": 0, "kev_computers": 1, "kev_installations": 1}'::jsonb, 'the Overview card');
select is((select count(*)::int from public.v_vuln_events), 2, 'Changes lists the new CVE events');
reset role;

-- 4b. A CVE with no affected version in its data (NVD "-") only may apply: counted apart, own filter.
select is(public.apply_vulnerability_changes('[{"product_key": "program|igor pavlov|7-zip", "vuln_id": "CVE-2020-0001", "removed": false,
  "severity": "HIGH", "cvss_score": 7.8, "ranges": [{"version_start": null, "version_end": null, "exact_version": null}], "seq": 8}]', 8) ->> 'upserted', '1',
  'a CVE without bounds is cached');
select is(public.vuln_store_matches('10000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002',
  '[{"title_id": "30000000-0000-0000-0000-000000000002", "version": "26.05", "product_key": "program|igor pavlov|7-zip", "vuln_id": "CVE-2020-0001", "uncertain": true}]') ->> 'new', '0',
  'an uncertain match makes no event');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select results_eq($$select (public.vuln_overview() ->> 'possible')::int, (public.vuln_overview() ->> 'possible_titles')::int, (public.vuln_overview() ->> 'high')::int$$,
  $$values (1, 1, 1)$$, 'the Overview counts it as may apply, not as high');
select results_eq($$select canonical_name, vulns_possible::int from public.search_titles(p_vuln := 'possible')$$, $$values ('7-Zip', 1)$$,
  'the Software filter "possible" lists the product');
reset role;

-- 5. A CVE removed from the feed removes its matches.
select is(public.apply_vulnerability_changes('[{"product_key": "program|igor pavlov|7-zip", "vuln_id": "CVE-2025-0411", "removed": true, "seq": 7}]', 7) ->> 'removed', '1',
  'a removed item leaves the cache');
select is((select count(*)::int from public.title_version_vulns where vuln_id = 'CVE-2025-0411'), 0, 'and its matches go with it');

-- 6. Operating systems --------------------------------------------------------------------------------------------
select results_eq($q$select version, platforms from public.vuln_eval_inputs('10000000-0000-0000-0000-00000000000a') where title_id = '30000000-0000-0000-0000-000000000001'$q$,
  $q$values ('23.01', array['windows'])$q$, 'the matcher gets the OS of the computers of each pair');
select public.apply_vulnerability_changes('[{"product_key": "program|igor pavlov|7-zip", "vuln_id": "CVE-2030-0002", "severity": "HIGH", "cvss_score": 8.0,
  "ranges": [{"version_end": "24.0", "platforms": ["macos"]}], "seq": 9}]', 9);
select is(public.vuln_store_matches('10000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000003',
  '[{"title_id": "30000000-0000-0000-0000-000000000001", "version": "23.01", "product_key": "program|igor pavlov|7-zip", "vuln_id": "CVE-2030-0002", "uncertain": false, "platforms": ["macos"]}]') ->> 'stored', '1',
  'a match keeps its OS');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select results_eq($q$select platforms, computers::int from public.title_vulns('30000000-0000-0000-0000-000000000001') where vuln_id = 'CVE-2030-0002'$q$,
  $q$values (array['macos'], 0)$q$, 'the title page shows the OS and counts only computers with it');
select is((select vulns::int from public.v_installation_details where hostname = 'PC1'), 0, 'a Windows installation does not count a macOS-only match');
select is((select (vulns ->> 'high')::int from public.v_computer_list where hostname = 'PC1'), 0, 'nor does the Windows computer');
reset role;

-- 7. OS of the shared titles ----------------------------------------------------------------------------------
insert into public.hub_submissions (kind, source, match_key, name, sent_at) values ('program', 'programs', '7-zip|igor pavlov', '7-Zip', now());
select results_eq($q$select name, platforms from public.hub_submissions_due()$q$, $q$values ('7-Zip', array['windows'])$q$,
  'a title sent before goes again with the OS families where it is installed');
select is(public.hub_submissions_sent((select jsonb_agg(jsonb_build_object('id', id, 'platforms', platforms)) from public.hub_submissions_due())), 1, 'marked as sent');
select is((select count(*)::int from public.hub_submissions_due()), 0, 'and not due again until it appears on another OS');

select * from finish();
rollback;
