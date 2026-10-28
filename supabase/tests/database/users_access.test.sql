-- Users and access: roles, access rules, the sign-up gate and the admin RPCs. Run with `npm run test:db`.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
truncate public.tenants, public.audit_log, public.access_rules cascade;
delete from public.profiles;

select plan(25);

-- Rules first, then accounts: the first account is admin; the others take their rule's role.
insert into public.access_rules (kind, value, role) values
  ('email', 'ops@example.com', 'operator'),
  ('domain', 'sophos.com', 'viewer');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'ops@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'ana@sophos.com'),
  ('00000000-0000-0000-0000-00000000000d', 'script@other.org');

insert into public.tenants (id, sophos_tenant_id, name, id_type) values
  ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'tenant');
insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform, associated_user) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'ep-a', 'host-a', 'windows', 'alice');

select is((select role::text from public.profiles where email = 'admin@example.com'), 'admin', 'the first account is admin');
select is((select role::text from public.profiles where email = 'ops@example.com'), 'operator', 'an email rule sets the role');
select is((select role::text from public.profiles where email = 'ana@sophos.com'), 'viewer', 'a domain rule sets the role');
select is((select role::text from public.profiles where email = 'script@other.org'), 'viewer', 'an account made by a database role without a rule is viewer');

select is(public.access_role_for('OPS@Example.com'), 'operator'::public.app_role, 'email rules win and ignore case');
select is(public.access_role_for('joe@sophos.com'), 'viewer'::public.app_role, 'domain rules match the email domain');
select is(public.access_role_for('joe@eu.sophos.com'), null::public.app_role, 'a subdomain needs its own rule');
select is(public.access_role_for('joe@gmail.com'), null::public.app_role, 'no rule, no access');
select throws_ok($$insert into public.access_rules (kind, value, role) values ('domain', 'evil.com', 'admin')$$,
  '23514', null, 'a domain never grants admin');
select throws_ok($$insert into public.access_rules (kind, value, role) values ('domain', 'Sophos.COM', 'viewer')$$,
  '23514', null, 'rule values are stored lower case');

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Tenant visibility: without tenant_members rows, the profile role applies to every tenant.
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is((select count(*) from public.tenants), 1::bigint, 'a viewer without memberships sees every tenant');
select is((select associated_user from public.v_computer_list limit 1), null, 'the viewer does not see usernames');
select throws_ok($$select public.scan_now('20000000-0000-0000-0000-00000000000a')$$, '42501', null, 'a viewer cannot scan');
select is(public.can_scan(), false, 'can_scan is false for a viewer');
select throws_ok($$select * from public.list_users()$$, '42501', null, 'a viewer cannot list users');
select throws_ok($$select public.add_access_rule('domain', 'x.com', 'viewer')$$, '42501', null, 'a viewer cannot add rules');
reset role;

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(public.can_scan(), true, 'can_scan is true for an operator');
select is(public.can_contribute(), true, 'operators export and request reclassification');
select throws_ok($$select public.set_user_role('00000000-0000-0000-0000-00000000000c', 'admin')$$, '42501', null, 'an operator cannot change roles');
reset role;

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is((select count(*) from public.list_users()), 4::bigint, 'the admin lists every user');
select lives_ok($$select public.add_access_rule('domain', '@Partner.COM', 'operator')$$, 'the admin adds a domain (normalized)');
select lives_ok($$select public.set_user_role('00000000-0000-0000-0000-00000000000b', 'viewer')$$, 'the admin changes a role');
select throws_ok($$select public.set_user_role('00000000-0000-0000-0000-00000000000a', 'viewer')$$, '22023', null, 'the last admin keeps the role');
select lives_ok($$select public.remove_user('00000000-0000-0000-0000-00000000000b')$$, 'the admin removes a user');
reset role;

select bag_eq(
  $$select action from public.audit_log where user_id = '00000000-0000-0000-0000-00000000000a'
    and action in ('add access rule', 'set user role', 'remove user')$$,
  $$values ('add access rule'), ('set user role'), ('remove user')$$,
  'rule, role and removal changes are audited');

select * from finish();
rollback;
