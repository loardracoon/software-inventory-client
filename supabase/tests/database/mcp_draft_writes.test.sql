-- Phase 11 M5: a JWT with mcp_token may change the policy draft only with mcp_scope = policy_draft, never
-- publishes, discards, deletes rules, sets the default class or fills risk_accepted_by; audit rows say via mcp.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select set_config('app.audit_purge', 'on', true);
truncate public.tenants, public.audit_log cascade;
delete from public.profiles;

select plan(22);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'operator@example.com');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000000a';
update public.profiles set role = 'operator' where id = '00000000-0000-0000-0000-00000000000b';
insert into public.tenants (id, sophos_tenant_id, name, id_type)
values ('10000000-0000-0000-0000-000000000001', 'sophos-1', 'Acme', 'tenant');

create function pg_temp.as_user(uid text, token text default null, scope text default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    (jsonb_build_object('sub', uid, 'role', 'authenticated')
      || case when token is null then '{}'::jsonb else jsonb_build_object('mcp_token', token, 'mcp_scope', scope) end)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function pg_temp.rule(name text, accepted text default null) returns jsonb language sql as $$
  select jsonb_build_object('name', name, 'class', 'tolerated_app', 'kinds', '["program"]'::jsonb, 'owner', 'IT',
    'business_purpose', 'Old archives', 'mitigating_controls', 'No admin rights', 'risk_accepted_by', accepted,
    'review_by', (current_date + 20)::text,
    'conditions', '[{"field": "name", "operator": "equals", "value": "7-Zip"}]'::jsonb);
$$;

-- A person publishes a tolerated rule with an acceptance.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select set_config('t.lineage', public.policy_save_rule('10000000-0000-0000-0000-000000000001', pg_temp.rule('7-Zip', 'CISO'))::text, true);
select lives_ok($$ select public.policy_publish('10000000-0000-0000-0000-000000000001') $$, 'a person publishes the rule');
select is((select data ->> 'via' from public.audit_log where action = 'policy rule added'), null, 'console changes are not marked');

-- A read token is refused even for an admin.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000ee', 'read');
select throws_ok($$ select public.policy_save_rule('10000000-0000-0000-0000-000000000001', pg_temp.rule('VPN')) $$,
  '42501', null, 'a read token cannot create the draft or a rule');
select is((select count(*)::int from public.policies where status = 'draft'), 0, 'no draft was left behind');

-- A policy_draft token adds a rule: the draft is created from the published policy, acceptance copied.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000dd', 'policy_draft');
select lives_ok($$ select public.policy_save_rule('10000000-0000-0000-0000-000000000001', pg_temp.rule('VPN')) $$,
  'a policy_draft token adds a rule to a new draft');
select is((select r.risk_accepted_by from public.policy_rules r join public.policies p on p.id = r.policy_id
           where p.status = 'draft' and r.lineage_id = current_setting('t.lineage')::uuid), 'CISO',
  'the draft copy keeps the acceptance a person gave');
select is((select data ->> 'via' from public.audit_log where action = 'policy rule added' and data ->> 'name' = 'VPN'), 'mcp',
  'the audit row says via mcp');
select is((select data ->> 'mcp_token_id' from public.audit_log where action = 'policy rule added' and data ->> 'name' = 'VPN'),
  'c0000000-0000-0000-0000-0000000000dd', 'the audit row names the token');

select throws_ok($$ select public.policy_save_rule('10000000-0000-0000-0000-000000000001', pg_temp.rule('Self-accepted', 'Claude')) $$,
  '42501', 'Only a person can fill risk_accepted_by.', 'a new rule cannot carry an acceptance');
select throws_ok($$ select public.policy_save_rule('10000000-0000-0000-0000-000000000001',
    pg_temp.rule('7-Zip', 'Claude') || jsonb_build_object('lineage_id', current_setting('t.lineage'))) $$,
  '42501', 'Only a person can fill risk_accepted_by.', 'an existing acceptance cannot be changed');
select lives_ok($$ select public.policy_save_rule('10000000-0000-0000-0000-000000000001',
    pg_temp.rule('7-Zip renamed', 'CISO') || jsonb_build_object('lineage_id', current_setting('t.lineage'))) $$,
  'an existing acceptance can be kept');
select lives_ok($$ select public.policy_save_rule('10000000-0000-0000-0000-000000000001',
    pg_temp.rule('7-Zip renamed') || jsonb_build_object('lineage_id', current_setting('t.lineage'))) $$,
  'an existing acceptance can be cleared');
select lives_ok($$ select public.policy_move_rule('10000000-0000-0000-0000-000000000001', current_setting('t.lineage')::uuid, 2) $$,
  'a rule can be moved');
select lives_ok($$ select public.policy_set_rule_enabled('10000000-0000-0000-0000-000000000001', current_setting('t.lineage')::uuid, false) $$,
  'a rule can be disabled');

select throws_ok($$ select public.policy_delete_rule('10000000-0000-0000-0000-000000000001', current_setting('t.lineage')::uuid) $$,
  '42501', null, 'a rule cannot be deleted');
select throws_ok($$ select public.policy_set_default_class('10000000-0000-0000-0000-000000000001', 'sanctioned_app') $$,
  '42501', null, 'the default class cannot be changed');
-- A person completes the draft (fixture, as the owner), so only the assistant limit can refuse the publish.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
reset role;
update public.policy_rules r set risk_accepted_by = 'CISO' from public.policies p where p.id = r.policy_id and p.status = 'draft';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000dd', 'policy_draft');
select throws_ok($$ select public.policy_publish('10000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'the draft cannot be published');
select throws_ok($$ select public.policy_discard_draft('10000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'the draft cannot be discarded');

-- The console's draft bar: admins see who changed the draft and how; others see nothing.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.policy_draft_activity('10000000-0000-0000-0000-000000000001') where via = 'mcp'), 5,
  'the draft activity lists the five assistant changes');
select is((select user_email from public.policy_draft_activity('10000000-0000-0000-0000-000000000001') limit 1), 'admin@example.com',
  'with the user who owns the token');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.policy_draft_activity('10000000-0000-0000-0000-000000000001')), 0,
  'an operator sees no draft activity');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select is((select first_bad_id from public.verify_audit_log()), null, 'the audit chain covers the via fields');

select * from finish();
rollback;
