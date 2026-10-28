-- Phase 9: application policy. RLS and RPC access per role, the draft and publish life cycle,
-- reordering, validation, stored results, class changes, alerts and the read models.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
-- Start from an empty app inside this transaction so data from local use cannot leak into the
-- assertions; the final rollback restores everything.
truncate public.tenants, public.software_titles, public.sophos_connection, public.audit_log,
  public.dictionary_cache, public.hub_submissions, public.alerts cascade;
delete from public.profiles;
delete from public.maintenance_state;

select plan(45);

-- Fixtures ----------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'operator@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer@example.com');
insert into public.tenants (id, sophos_tenant_id, name, id_type) values
  ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'partner'),
  ('10000000-0000-0000-0000-00000000000b', 'sophos-b', 'Tenant B', 'partner');
insert into public.tenant_members (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000a', 'operator'),
  ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000a', 'viewer');
insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'ep-w1', 'W1', 'windows'),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'ep-w2', 'W2', 'windows'),
  ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'ep-w3', 'W3', 'windows');
insert into public.software_titles (id, kind, source, match_key, canonical_name, vendor) values
  ('30000000-0000-0000-0000-000000000001', 'program', 'programs', 'acrobat|adobe', 'Adobe Acrobat', 'Adobe'),
  ('30000000-0000-0000-0000-000000000002', 'program', 'programs', '7-zip|igor pavlov', '7-Zip', 'Igor Pavlov');
insert into public.installations (tenant_id, computer_id, title_id, domain, query_name, scope_key, version, row_hash, valid_from) values
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000001', 'programs', 'inv.programs', '', '25.001', 'h1', now()),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-000000000001', 'programs', 'inv.programs', '', '23.008', 'h2', now()),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000002', 'programs', 'inv.programs', '', '24.09', 'h3', now()),
  ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-000000000002', 'programs', 'inv.programs', '', '24.09', 'h4', now());
update public.alert_settings set enabled = true where id = 1;

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- A rule as the editor sends it.
create function pg_temp.rule(name text, class text, conds jsonb, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('name', name, 'class', class, 'match', 'all', 'kinds', jsonb_build_array('program'), 'enabled', true,
    'conditions', conds) || extra;
$$;

-- Who may write -----------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select throws_ok($$insert into public.policies (tenant_id, version) values ('10000000-0000-0000-0000-00000000000a', 1)$$, '42501', null,
  'viewer cannot insert a policy directly');
select throws_ok($$select public.policy_save_rule('10000000-0000-0000-0000-00000000000a',
  pg_temp.rule('x', 'core_system', '[{"field":"vendor","operator":"equals","value":"x"}]'))$$, '42501', null,
  'viewer cannot save a rule');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select throws_ok($$select public.policy_ensure_draft('10000000-0000-0000-0000-00000000000a')$$, '42501', null, 'operator cannot create a draft');
select throws_ok($$select public.policy_publish('10000000-0000-0000-0000-00000000000a')$$, '42501', null, 'operator cannot publish');
select throws_ok($$update public.policy_rules set enabled = false$$, '42501', null, 'operator cannot update rules directly');
reset role;

-- Draft life cycle (admin) ------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select set_config('t.r1', public.policy_save_rule('10000000-0000-0000-0000-00000000000a',
  pg_temp.rule('Old Acrobat', 'unsanctioned_app', '[{"field":"vendor","operator":"contains","value":"adobe"},{"field":"version","operator":"lt","value":"24"}]',
    '{"alert_on_new": true}'))::text, true);
select set_config('t.r2', public.policy_save_rule('10000000-0000-0000-0000-00000000000a',
  pg_temp.rule('Adobe', 'sanctioned_app', '[{"field":"vendor","operator":"equals","value":"Adobe"}]'))::text, true);
select set_config('t.r3', public.policy_save_rule('10000000-0000-0000-0000-00000000000a',
  pg_temp.rule('Archivers', 'tolerated_app', '[{"field":"name","operator":"regex","value":"zip|rar"}]'))::text, true);

select is((select count(*)::int from public.policies where tenant_id = '10000000-0000-0000-0000-00000000000a'), 1, 'saving rules created one draft');
select is(public.policy_ensure_draft('10000000-0000-0000-0000-00000000000a'),
  (select id from public.policies where status = 'draft' and tenant_id = '10000000-0000-0000-0000-00000000000a'), 'ensure_draft returns the same draft');
select results_eq($$select name from public.policy_rules order by position$$, $$values ('Old Acrobat'), ('Adobe'), ('Archivers')$$,
  'new rules go to the end');

select is(public.policy_move_rule('10000000-0000-0000-0000-00000000000a', current_setting('t.r3')::uuid, 1), 1, 'move returns the new position');
select results_eq($$select name, position from public.policy_rules order by position$$,
  $$values ('Archivers', 1), ('Old Acrobat', 2), ('Adobe', 3)$$, 'moving to the top shifts the others down');
select is(public.policy_move_rule('10000000-0000-0000-0000-00000000000a', current_setting('t.r3')::uuid, 99), 3, 'a position past the end means last');
select results_eq($$select name from public.policy_rules order by position$$, $$values ('Old Acrobat'), ('Adobe'), ('Archivers')$$,
  'moving down shifts the others up');

select lives_ok($$select public.policy_save_rule('10000000-0000-0000-0000-00000000000a',
  pg_temp.rule('Temporary', 'core_system', '[{"field":"name","operator":"equals","value":"x"}]', '{"position": 2}'))$$,
  'insert a rule at position 2');
select results_eq($$select name from public.policy_rules order by position$$, $$values ('Old Acrobat'), ('Temporary'), ('Adobe'), ('Archivers')$$,
  'insert above shifts the rules below');
select lives_ok($$select public.policy_delete_rule('10000000-0000-0000-0000-00000000000a',
  (select lineage_id from public.policy_rules where name = 'Temporary'))$$, 'delete a draft rule');
select results_eq($$select position from public.policy_rules order by position$$, $$values (1), (2), (3)$$, 'positions stay contiguous after a delete');

select throws_ok($$select public.policy_save_rule('10000000-0000-0000-0000-00000000000a',
  pg_temp.rule('Bad', 'core_system', '[{"field":"category","operator":"contains","value":"x"}]'))$$, '23514', null,
  'an operator that does not fit the field is refused');
select throws_ok($$select public.policy_save_rule('10000000-0000-0000-0000-00000000000a',
  pg_temp.rule('Bad', 'core_system', '[{"field":"version","operator":"between","value":"1"}]'))$$, '23514', null,
  'between needs two values');
select throws_ok($$select public.policy_save_rule('10000000-0000-0000-0000-00000000000a', pg_temp.rule('Bad', 'core_system', '[]'))$$, '22023', null,
  'a rule needs a condition');

-- Publish -----------------------------------------------------------------------------------------
select throws_like($$select public.policy_publish('10000000-0000-0000-0000-00000000000a')$$, '%rule 3 (Archivers): a tolerated rule needs%',
  'a tolerated rule without its documentation blocks the publish');
select lives_ok($$select public.policy_save_rule('10000000-0000-0000-0000-00000000000a', pg_temp.rule('Archivers', 'tolerated_app',
  '[{"field":"name","operator":"regex","value":"zip|rar"}]',
  jsonb_build_object('lineage_id', current_setting('t.r3'), 'owner', 'IT', 'business_purpose', 'Archives', 'mitigating_controls', 'AV scan',
    'risk_accepted_by', 'CISO', 'review_by', current_date + 10)))$$, 'complete the tolerated rule');
select lives_ok($$select public.policy_publish('10000000-0000-0000-0000-00000000000a')$$, 'publish version 1');
select results_eq($$select version, status::text from public.policies where tenant_id = '10000000-0000-0000-0000-00000000000a'$$,
  $$values (1, 'published')$$, 'the draft became the published version');

select lives_ok($$select public.policy_set_rule_enabled('10000000-0000-0000-0000-00000000000a', current_setting('t.r2')::uuid, false)$$,
  'disabling a rule opens version 2');
select results_eq($$select p.version, count(r.*)::int, count(c.*)::int from public.policies p join public.policy_rules r on r.policy_id = p.id
  left join public.policy_conditions c on c.rule_id = r.id where p.tenant_id = '10000000-0000-0000-0000-00000000000a' group by p.version order by p.version$$,
  $$values (1, 4, 4), (2, 4, 4)$$, 'the draft copies every rule and condition');
select is((select count(distinct lineage_id)::int from public.policy_rules), 3, 'copied rules keep their lineage');
select lives_ok($$select public.policy_discard_draft('10000000-0000-0000-0000-00000000000a')$$, 'discard the draft');
select is((select enabled from public.policy_rules where lineage_id = current_setting('t.r2')::uuid), true, 'the published rule is unchanged');
select results_eq($$select action from public.audit_log where action like 'policy%' order by id$$,
  $$values ('policy rule added'), ('policy rule added'), ('policy rule added'), ('policy rule moved'), ('policy rule moved'),
    ('policy rule added'), ('policy rule deleted'), ('policy rule changed'), ('policy published'), ('policy rule disabled'),
    ('policy draft discarded')$$, 'every change is audited');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select is((public.policy_get('10000000-0000-0000-0000-00000000000a') -> 'published' ->> 'version')::int, 1, 'viewer reads the published policy');
select is(public.policy_get('10000000-0000-0000-0000-00000000000b'), null, 'viewer of tenant A cannot read tenant B');
select throws_ok($$select * from public.policy_eval_inputs('10000000-0000-0000-0000-00000000000a')$$, '42501', null,
  'viewer cannot call the server-side inputs');
reset role;

-- Results (service role) --------------------------------------------------------------------------
set local role service_role;
select is((select count(*)::int from public.policy_eval_inputs('10000000-0000-0000-0000-00000000000a')), 3,
  'three current (title, version) pairs need a class');
select is((select full_run from public.policy_due_tenants()), true, 'a new publish needs a full run');
select set_config('t.pol', (select id::text from public.policies where status = 'published'), true);
select set_config('t.rule1', (select id::text from public.policy_rules where lineage_id = current_setting('t.r1')::uuid), true);
select set_config('t.rule2', (select id::text from public.policy_rules where lineage_id = current_setting('t.r2')::uuid), true);
select set_config('t.rule3', (select id::text from public.policy_rules where lineage_id = current_setting('t.r3')::uuid), true);
select is(public.policy_store_results('10000000-0000-0000-0000-00000000000a', current_setting('t.pol')::uuid, jsonb_build_array(
    jsonb_build_object('title_id', '30000000-0000-0000-0000-000000000001', 'version', '25.001', 'class', 'sanctioned_app', 'rule_id', current_setting('t.rule2')),
    jsonb_build_object('title_id', '30000000-0000-0000-0000-000000000001', 'version', '23.008', 'class', 'unsanctioned_app', 'rule_id', current_setting('t.rule1')),
    jsonb_build_object('title_id', '30000000-0000-0000-0000-000000000002', 'version', '24.09', 'class', 'tolerated_app', 'rule_id', current_setting('t.rule3'))),
  true), '{"stored": 3, "changed": 0, "alerts": 1}'::jsonb, 'first results: no class changes, one alert for the new unsanctioned pair');
select is((select count(*)::int from public.policy_eval_inputs('10000000-0000-0000-0000-00000000000a')), 0, 'nothing new left to evaluate');
select is(public.policy_store_results('10000000-0000-0000-0000-00000000000a', current_setting('t.pol')::uuid, jsonb_build_array(
    jsonb_build_object('title_id', '30000000-0000-0000-0000-000000000001', 'version', '23.008', 'class', 'unsanctioned_app', 'rule_id', current_setting('t.rule1')),
    jsonb_build_object('title_id', '30000000-0000-0000-0000-000000000002', 'version', '24.09', 'class', 'unsanctioned_app', 'rule_id', null)),
  true), '{"stored": 2, "changed": 1, "alerts": 0}'::jsonb, 'a class change is recorded once; no repeated alert');
select throws_ok($$select public.policy_store_results('10000000-0000-0000-0000-00000000000b', current_setting('t.pol')::uuid, '[]', false)$$,
  '40001', null, 'results for a policy that is not published are refused');
select public.policy_evaluation_finished(current_setting('t.pol')::uuid);
select is((select full_run from public.policy_due_tenants()), false, 'after a full run only new pairs are due');
reset role;

-- Read models -------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select results_eq($$select t.canonical_name, p.class::text, p.mixed_versions from public.title_policy p
  join public.software_titles t on t.id = p.title_id order by t.canonical_name$$,
  $$values ('7-Zip', 'unsanctioned_app', false), ('Adobe Acrobat', 'unsanctioned_app', true)$$,
  'title_policy shows the most restrictive class and mixed versions');
select results_eq($$select canonical_name, policy_class::text, policy_rule_name, mixed_versions
  from public.search_titles(p_policy => array['unsanctioned_app']::public.policy_class[], p_sort => 'canonical_name', p_desc => false)$$,
  $$values ('7-Zip', 'unsanctioned_app', null::text, false), ('Adobe Acrobat', 'unsanctioned_app', 'Old Acrobat', true)$$,
  'search_titles filters by class and names the deciding rule');
select is((select count(*)::int from public.search_titles(p_policy => array['sanctioned_app']::public.policy_class[])), 0,
  'a title counts under its most restrictive class only');
select results_eq($$select version, policy_class::text from public.v_installation_details where canonical_name = 'Adobe Acrobat' order by version$$,
  $$values ('23.008', 'unsanctioned_app'), ('25.001', 'sanctioned_app')$$, 'each installation shows the class of its version');
select results_eq($$select canonical_name, version, from_class::text, to_class::text from public.v_policy_class_changes$$,
  $$values ('7-Zip', '24.09', 'tolerated_app', 'unsanctioned_app')$$, 'class changes are readable');
select results_eq($$select (o ->> 'unsanctioned_installations')::int, (o ->> 'unsanctioned_computers')::int, (o ->> 'default_titles')::int,
    jsonb_array_length(o -> 'exceptions')
  from public.policy_overview('10000000-0000-0000-0000-00000000000a') o$$,
  $$values (2, 2, 1, 1)$$, 'overview: unsanctioned footprint, default titles and the exception due soon');
reset role;

select finish();
rollback;
