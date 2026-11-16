-- Phase 11 M2: a JWT with mcp_mask = true makes my_tenant_roles() report 'viewer', so every view masks users
-- for admins and operators too; without the claim nothing changes.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select set_config('app.audit_purge', 'on', true);
truncate public.tenants, public.audit_log cascade;
delete from public.profiles;

select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'operator@example.com');
update public.profiles set role = 'operator' where id = '00000000-0000-0000-0000-00000000000b';
insert into public.tenants (id, sophos_tenant_id, name, id_type)
values ('10000000-0000-0000-0000-000000000001', 'sophos-1', 'Acme', 'tenant');
insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform, associated_user)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'ep-1', 'LAB-PC01', 'windows', 'ACME\maria');

create function pg_temp.as_user(uid text, mask boolean) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    (json_build_object('sub', uid, 'role', 'authenticated')::jsonb || case when mask then '{"mcp_mask": true}'::jsonb else '{}'::jsonb end)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', false);
select is(public.mcp_masked(), false, 'a console session is not masked');
select is((select role::text from public.my_tenant_roles()), 'admin', 'an admin keeps the admin role');
select is((select associated_user from public.v_computers), 'ACME\maria', 'an admin sees the user');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', true);
select is(public.mcp_masked(), true, 'an MCP read JWT is masked');
select is((select role::text from public.my_tenant_roles()), 'viewer', 'masked: the admin reads as viewer');
select is((select count(*)::int from public.my_tenant_roles()), 1, 'masked: the same tenants stay visible');
select is((select associated_user from public.v_computers), null, 'masked: the user is hidden from the admin');
select is((select user_masked from public.v_computers), true, 'masked: the row says so');
select is((select hostname from public.v_computer_list), 'LAB-PC01', 'masked: computers are still listed');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b', true);
select is((select associated_user from public.v_computers), null, 'masked: the user is hidden from an operator');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b', false);
select is((select associated_user from public.v_computers), 'ACME\maria', 'an operator console session still sees the user');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', true);
select is((select count(*)::int from public.computers), 0, 'masked: the base table returns no rows (admins and operators only)');

select * from finish();
rollback;
