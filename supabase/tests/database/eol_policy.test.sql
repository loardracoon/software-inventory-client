-- Stage 3: the policy field "eol" (end of life) — rules, the server-side inputs and when a tenant's policy is due again.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select set_config('app.audit_purge', 'on', true);
truncate public.tenants, public.software_titles, public.audit_log, public.dictionary_cache, public.eol_cache, public.alerts cascade;
delete from public.profiles;
delete from public.maintenance_state;

select plan(8);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'admin@example.com');
insert into public.tenants (id, sophos_tenant_id, name, id_type) values ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'partner');
insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'ep-w1', 'W1', 'windows');
insert into public.software_titles (id, kind, source, match_key, canonical_name, vendor) values
  ('30000000-0000-0000-0000-000000000001', 'program', 'programs', '7-zip|igor pavlov', '7-Zip', 'Igor Pavlov'),
  ('30000000-0000-0000-0000-000000000002', 'program', 'programs', 'other|acme', 'Other', 'Acme');
insert into public.installations (tenant_id, computer_id, title_id, domain, query_name, scope_key, version, row_hash, valid_from) values
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000001', 'programs', 'inv.programs', '', '23.01', 'h1', now()),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000002', 'programs', 'inv.programs', '', '1.0', 'h2', now());

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.rule(name text, class text, conds jsonb) returns jsonb language sql as $$
  select jsonb_build_object('name', name, 'class', class, 'match', 'all', 'kinds', jsonb_build_array('program'), 'enabled', true, 'conditions', conds);
$$;

-- Rules -----------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select lives_ok($$select public.policy_save_rule('10000000-0000-0000-0000-00000000000a',
  pg_temp.rule('Unsupported', 'unsanctioned_app', '[{"field":"eol","operator":"equals","value":"true"}]'))$$, 'a rule on the eol field is accepted');
select throws_ok($$select public.policy_save_rule('10000000-0000-0000-0000-00000000000a',
  pg_temp.rule('Bad', 'unsanctioned_app', '[{"field":"eol","operator":"gt","value":"true"}]'))$$, '23514', null, 'eol takes is / is not only');
select public.policy_publish('10000000-0000-0000-0000-00000000000a');
reset role;

-- Inputs: eol is true for an installed version whose release is end of life --------------------------------------
select public.apply_eol_changes('[{"product_key":"program|igor pavlov|7-zip","slug":"7-zip","seq":1,"releases":[{"name":"23","label":"23","is_eol":true,"eol_from":"2024-06-01","latest_name":"23.01"}]}]', 1);
set local role service_role;
select public.eol_replace('10000000-0000-0000-0000-00000000000a',
  '[{"title_id":"30000000-0000-0000-0000-000000000001","version":"23.01","product_key":"program|igor pavlov|7-zip","release":"23","eol_from":"2024-06-01","status":"eol"}]', '[]');
select results_eq($$select name, eol from public.policy_eval_inputs('10000000-0000-0000-0000-00000000000a') order by name$$,
  $$values ('7-Zip', true), ('Other', false)$$, 'inputs: eol is true for the end-of-life version and false for the rest');
select results_eq($$select name, eol from public.policy_preview_inputs('10000000-0000-0000-0000-00000000000a') order by name$$,
  $$values ('7-Zip', true), ('Other', false)$$, 'preview inputs carry eol too');

-- When the policy is due again ----------------------------------------------------------------------------
select is((select full_run from public.policy_due_tenants()), true, 'a new publish needs a full run');
select public.policy_evaluation_finished((select id from public.policies where status = 'published'));
reset role;
update public.policies set evaluated_at = clock_timestamp() where status = 'published';
set local role service_role;
select is((select count(*)::int from public.policy_due_tenants() where full_run), 0, 'after the run nothing is due');
select public.eol_replace('10000000-0000-0000-0000-00000000000a',
  '[{"title_id":"30000000-0000-0000-0000-000000000001","version":"23.01","product_key":"program|igor pavlov|7-zip","release":"23","eol_from":"2024-06-01","status":"eol"}]', '[]');
select is((select count(*)::int from public.policy_due_tenants() where full_run), 0, 'an identical result does not make the policy due');
select public.eol_replace('10000000-0000-0000-0000-00000000000a', '[]', '[]');
select is((select count(*)::int from public.policy_due_tenants() where full_run), 1, 'a changed end-of-life result makes the policy due again');
reset role;

select * from finish();
rollback;
