-- Sophos Central credential: admin-only, write-only from the browser, readable by the service role.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
-- Start from an empty app inside this transaction so data from local use cannot leak into the
-- assertions; the final rollback restores everything.
truncate public.tenants, public.software_titles, public.sophos_connection, public.audit_log,
  public.dictionary_cache, public.hub_submissions cascade;
delete from public.profiles;
delete from vault.secrets where name = 'sophos_client_secret';

select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'operator@example.com');
update public.profiles set role = 'operator' where email = 'operator@example.com';

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Not configured --------------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is((select configured from public.get_sophos_connection_status()), false, 'starts not configured');
reset role;

-- Non-admin -------------------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$select public.set_sophos_credential('11111111-2222-3333-4444-555566667777', 'first-secret-value-0123456789')$$,
  '42501', null, 'operator cannot set the credential');
select throws_ok('select public.clear_sophos_credential()', '42501', null, 'operator cannot remove the credential');
reset role;

-- Admin sets it ---------------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$select public.set_sophos_credential('short', 'first-secret-value-0123456789')$$,
  '22023', null, 'rejects an invalid client ID');
select throws_ok(
  $$select public.set_sophos_credential('11111111-2222-3333-4444-555566667777', 'tiny')$$,
  '22023', null, 'rejects an invalid secret');
select lives_ok(
  $$select public.set_sophos_credential(' 11111111-2222-3333-4444-555566667777 ', 'first-secret-value-0123456789')$$,
  'admin sets the credential');
select results_eq(
  'select configured, client_id_hint, configured_by_email from public.get_sophos_connection_status()',
  $$values (true, '••••7777', 'admin@example.com')$$,
  'admin sees a masked client ID and who set it');
select throws_ok('select * from public.get_sophos_credential()', '42501', null, 'authenticated users cannot read the secret');
select throws_ok('select * from public.sophos_connection', '42501', null, 'authenticated users cannot read the table');
select lives_ok(
  $$select public.set_sophos_credential('11111111-2222-3333-4444-555566667777', 'second-secret-value-0123456789')$$,
  'admin replaces the credential');
reset role;

-- Analyst sees status only ----------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select results_eq(
  'select configured, client_id_hint, configured_by_email from public.get_sophos_connection_status()',
  $$values (true, null::text, null::text)$$,
  'operator only learns that a credential is set');
reset role;

-- Service role reads it -------------------------------------------------------------------------
set local role service_role;
select results_eq(
  'select client_id, client_secret from public.get_sophos_credential()',
  $$values ('11111111-2222-3333-4444-555566667777', 'second-secret-value-0123456789')$$,
  'service role reads the trimmed client ID and the latest secret');
reset role;

select is((select count(*) from vault.secrets where name = 'sophos_client_secret'), 1::bigint,
  'replacing reuses one Vault secret');
select is(
  (select count(*) from public.audit_log where data::text like '%secret-value%' or data::text like '%11111111-2222%'),
  0::bigint, 'the audit log never holds the secret or the full client ID');

-- Removal ---------------------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok('select public.clear_sophos_credential()', 'admin removes the credential');
reset role;
select is((select count(*) from vault.secrets where name = 'sophos_client_secret'), 0::bigint,
  'removing deletes the Vault secret');

select * from finish();
rollback;
