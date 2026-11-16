-- Phase 11 M1: MCP settings, personal tokens and audit. Tokens are stored only as sha256, come back once,
-- policy_draft is for admins, only the service role resolves a token, and only admins read the audit.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select set_config('app.audit_purge', 'on', true);
truncate public.tenants, public.audit_log cascade;
truncate public.mcp_audit;
delete from public.mcp_tokens;
delete from public.profiles;
update public.mcp_settings set enabled = false, show_usernames = false;

select plan(26);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer@example.com');
update public.profiles set role = 'viewer' where id = '00000000-0000-0000-0000-00000000000c';

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end $$;
create temp table created (who text, id uuid, token text, expires_at timestamptz);
grant all on created to authenticated, service_role;

-- Settings ---------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select is((select enabled from public.get_mcp_settings()), false, 'MCP starts off');
select is((select show_usernames from public.get_mcp_settings()), false, 'usernames start masked');
select throws_ok($$ select public.set_mcp_settings(true, true) $$, '42501', null, 'a viewer cannot change the settings');

-- Tokens -----------------------------------------------------------------------------------------------
insert into created select 'viewer', id, token, expires_at from public.mcp_token_create('laptop', 'read', 30);
select matches((select token from created where who = 'viewer'), '^eimcp_[A-Za-z0-9_-]{43}$', 'the token has the documented format');
select throws_ok($$ select * from public.mcp_token_create('x', 'policy_draft', 30) $$, '42501', null, 'a viewer cannot create a policy_draft token');
select throws_ok($$ select * from public.mcp_token_create('x', 'read', 91) $$, '22023', null, 'a token lasts at most 90 days');
select throws_ok($$ select * from public.mcp_token_create('  ', 'read', 30) $$, '22023', null, 'a token needs a name');
select throws_ok($$ select count(*) from public.mcp_tokens $$, '42501', null, 'browsers cannot read the token table');
select throws_ok($$ select * from public.mcp_token_resolve('\x00'::bytea) $$, '42501', null, 'browsers cannot resolve tokens');
select is((select count(*)::int from public.mcp_token_list()), 1, 'a viewer lists only their own token');
select is((select count(*)::int from public.mcp_audit), 0, 'a viewer reads no MCP audit');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into created select 'admin', id, token, expires_at from public.mcp_token_create('desktop', 'policy_draft', 7);
select is((select count(*)::int from public.mcp_token_list()), 2, 'an admin lists every token');
select is((select token_hint from public.mcp_token_list() where name = 'desktop'), right((select token from created where who = 'admin'), 4), 'the list shows only the last 4 characters');
select throws_ok($$ select public.mcp_token_revoke('00000000-0000-0000-0000-0000000000ff') $$, 'P0002', null, 'an unknown token cannot be revoked');

-- Resolve (service role) -------------------------------------------------------------------------------
select pg_temp.as_service();
select is((select scope::text from public.mcp_token_resolve(extensions.digest((select token from created where who = 'admin'), 'sha256'))), 'policy_draft', 'the service role resolves a token to its scope');
select is((select enabled from public.mcp_token_resolve(extensions.digest((select token from created where who = 'admin'), 'sha256'))), false, 'and says MCP is off');
select ok((select last_used_at is not null from public.mcp_tokens where id = (select id from created where who = 'admin')), 'resolving stamps last_used_at');
select is((select count(*)::int from public.mcp_token_resolve(extensions.digest('eimcp_wrong', 'sha256'))), 0, 'an unknown token resolves to nothing');
select is((select count(*)::int from public.mcp_tokens where token_hash = convert_to((select token from created where who = 'admin'), 'UTF8')), 0, 'the token itself is never stored');
update public.mcp_tokens set expires_at = now() - interval '1 hour', created_at = now() - interval '1 day' where id = (select id from created where who = 'viewer');
select is((select count(*)::int from public.mcp_token_resolve(extensions.digest((select token from created where who = 'viewer'), 'sha256'))), 0, 'an expired token resolves to nothing');
insert into public.mcp_audit (user_id, method, tool, outcome) values ('00000000-0000-0000-0000-00000000000a', 'tools/call', 'get_overview', 'ok');

-- Admin actions ----------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ select public.set_mcp_settings(true, false) $$, 'an admin turns MCP on');
select is((select count(*)::int from public.mcp_audit), 1, 'an admin reads the MCP audit');
select lives_ok($$ select public.mcp_token_revoke((select id from created where who = 'admin')) $$, 'an admin revokes a token');

select pg_temp.as_service();
select is((select count(*)::int from public.mcp_token_resolve(extensions.digest((select token from created where who = 'admin'), 'sha256'))), 0, 'a revoked token resolves to nothing');

reset role;
select is(
  (select array_agg(action order by id) from public.audit_log where target in ('mcp_tokens', 'mcp_settings')),
  array['create mcp_token', 'create mcp_token', 'set mcp_settings', 'revoke mcp_token'],
  'token creation, settings and revocation are audited'
);
select is((select count(*)::int from public.audit_log where data::text like '%' || (select token from created where who = 'admin') || '%'), 0, 'the audit never holds a token');

select * from finish();
rollback;
