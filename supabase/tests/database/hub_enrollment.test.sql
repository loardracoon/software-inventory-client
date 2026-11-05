-- Phase 10c: access request to the Sophizo Hub. The key lives in the Vault from the start, browsers never read it,
-- final states delete it, approval moves the same secret into the Hub connection, a Hub connected by hand wins,
-- and a Hub URL typed by hand must use https:// (plain http only for local or in-cluster hosts).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
truncate public.tenants, public.audit_log cascade;
delete from public.profiles;
delete from vault.secrets where name = 'hub_client_key' or name like 'hub_enrollment_key_%';
update public.hub_connection set url = null, key_secret_id = null, key_hint = null, configured_at = null, last_seq = 0, last_error = null, failures = 0, next_attempt_at = null;
update public.hub_enrollment set status = 'none', key_secret_id = null, key_hint = null, hub_url = null;

select plan(18);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer@example.com');
update public.profiles set role = 'viewer' where id = '00000000-0000-0000-0000-00000000000c';

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.start(k text) returns void language sql as $$
  select public.hub_enrollment_start(jsonb_build_object('key', k, 'hub_url', 'https://mcs.sophizo.com.br', 'user_id', '00000000-0000-0000-0000-00000000000a',
    'name', 'ACME inventory', 'organization', 'ACME', 'contact_email', 'it@acme.example', 'reason', null, 'consent_version', '2026-11-04'));
$$;
create function pg_temp.key_in_vault() returns text language sql as $$
  select s.decrypted_secret from public.hub_enrollment e join vault.decrypted_secrets s on s.id = e.key_secret_id
$$;

-- Start --------------------------------------------------------------------------------------------------------
select throws_ok($$select pg_temp.start('not-a-key')$$, '22023', null, 'only a well-formed client key is stored');
select lives_ok($$select pg_temp.start('hubk_' || repeat('ab', 32))$$, 'a request starts');
select is(pg_temp.key_in_vault(), 'hubk_' || repeat('ab', 32), 'the key is in the Vault');
select results_eq($$select status, key_hint, consent_version, consented_by from public.hub_enrollment$$,
  $$values ('requesting', '••••abab', '2026-11-04', '00000000-0000-0000-0000-00000000000a'::uuid)$$, 'the consent is recorded with who and which text');
select throws_ok($$select pg_temp.start('hubk_' || repeat('cd', 32))$$, '22023', null, 'one open request at a time');

-- Read access --------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select results_eq($$select status, contact_email from public.get_hub_enrollment()$$, $$values ('requesting', 'it@acme.example')$$, 'admins read the request');
select is((select position(repeat('ab', 32) in g::text) from public.get_hub_enrollment() g), 0, 'the status never returns the key');
select throws_ok($$select public.hub_enrollment_key()$$, '42501', null, 'browsers cannot read the key');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.get_hub_enrollment()), 0, 'viewers read nothing');
reset role;

-- Approval moves the same secret ----------------------------------------------------------------------------------
select public.hub_enrollment_update('pending', null, null, now() + interval '5 minutes');
create temp table secret as select key_secret_id as id from public.hub_enrollment;
select public.hub_enrollment_activate();
select results_eq($$select url, key_secret_id = (select id from secret), key_hint from public.hub_connection$$,
  $$values ('https://mcs.sophizo.com.br', true, '••••abab')$$, 'the connection uses the same Vault secret');
select results_eq($$select status, key_secret_id is null from public.hub_enrollment$$, $$values ('approved', true)$$, 'the request is done');
select is((select count(*)::int from vault.secrets where name like 'hub_enrollment_key_%'), 1, 'the key was not copied');

-- A connected Hub blocks a new request; a manual connection wins over a late approval ------------------------------
select throws_ok($$select pg_temp.start('hubk_' || repeat('ef', 32))$$, '22023', null, 'no request while a Hub is connected');
update public.hub_connection set url = null, key_secret_id = null, key_hint = null;
select public.hub_enrollment_update('none', null, null, null);
select pg_temp.start('hubk_' || repeat('12', 32));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.set_hub_connection('https://hub.example.com', 'hubkey-manual-0123456789');
reset role;
create temp table late as select key_secret_id as id from public.hub_enrollment;
select public.hub_enrollment_activate();
select results_eq($$select url, key_hint from public.hub_connection$$, $$values ('https://hub.example.com', '••••6789')$$, 'the manual connection stays');
select is((select count(*)::int from vault.secrets where id = (select id from late)), 0, 'the late key is discarded');

-- Final states delete the key ---------------------------------------------------------------------------------------
update public.hub_connection set url = null, key_secret_id = null, key_hint = null;
select public.hub_enrollment_update('none', null, null, null);
select pg_temp.start('hubk_' || repeat('34', 32));
select public.hub_enrollment_update('rejected', 'Unknown organization', null, null);
select results_eq($$select status, note, key_secret_id is null from public.hub_enrollment$$, $$values ('rejected', 'Unknown organization', true)$$,
  'a rejection keeps the note and deletes the key');

-- Hub URL ------------------------------------------------------------------------------------------------------------
delete from vault.secrets where name = 'hub_client_key';
update public.hub_connection set url = null, key_secret_id = null, key_hint = null;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select throws_ok($$select public.set_hub_connection('http://hub.example.com', 'hubkey-0123456789abcdef')$$, '22023', null, 'plain http to a public host is refused');
select lives_ok($$select public.set_hub_connection('http://kong.dictionary-hub.svc.cluster.local:8000', 'hubkey-0123456789abcdef')$$, 'http inside the cluster is allowed');
reset role;

select * from finish();
rollback;
