-- Phase 2: apply_computer_sync never deletes, retires after two missed syncs and reactivates.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
-- Start from an empty app inside this transaction so data from local use cannot leak into the
-- assertions; the final rollback restores everything.
truncate public.tenants, public.software_titles, public.sophos_connection, public.audit_log,
  public.dictionary_cache, public.hub_submissions cascade;
delete from public.profiles;
delete from vault.secrets where name = 'sophos_client_secret';

select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer@example.com');
insert into public.tenants (id, sophos_tenant_id, name, id_type) values
  ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'partner'),
  ('10000000-0000-0000-0000-00000000000b', 'sophos-b', 'Tenant B', 'partner');
insert into public.tenant_members (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000a', 'viewer');

create function pg_temp.sync(endpoints jsonb) returns jsonb language sql as $$
  select public.apply_computer_sync('10000000-0000-0000-0000-00000000000a', endpoints);
$$;
create function pg_temp.ep(id text, host text) returns jsonb language sql as $$
  select jsonb_build_object('sophos_endpoint_id', id, 'hostname', host, 'platform', 'windows',
    'endpoint_type', 'computer', 'os_name', 'Windows 11 Enterprise', 'associated_user', 'CORP\alice',
    'health', 'good', 'last_seen_at', '2026-10-26T12:00:00Z');
$$;

select is(pg_temp.sync(jsonb_build_array(pg_temp.ep('e1', 'PC-1'), pg_temp.ep('e2', 'PC-2'))),
  '{"seen": 2, "new": 2, "reactivated": 0, "missing": 0, "retired": 0}'::jsonb, 'first sync inserts');
select is((select last_synced_at is not null from public.tenants where sophos_tenant_id = 'sophos-a'), true,
  'the tenant records its last sync');

select is(pg_temp.sync(jsonb_build_array(pg_temp.ep('e1', 'PC-1-renamed'))),
  '{"seen": 1, "new": 0, "reactivated": 0, "missing": 1, "retired": 0}'::jsonb, 'one missed sync only counts');
select is((select hostname from public.computers where sophos_endpoint_id = 'e1'), 'PC-1-renamed', 'updates fields');
select results_eq($$select missing_syncs, retired_at is null from public.computers where sophos_endpoint_id = 'e2'$$,
  $$values (1, true)$$, 'missing once: not retired');

select is(pg_temp.sync(jsonb_build_array(pg_temp.ep('e1', 'PC-1-renamed'))),
  '{"seen": 1, "new": 0, "reactivated": 0, "missing": 1, "retired": 1}'::jsonb, 'second missed sync retires');
select results_eq($$select missing_syncs, retired_at is not null from public.computers where sophos_endpoint_id = 'e2'$$,
  $$values (2, true)$$, 'missing twice: retired, row kept');

select is(pg_temp.sync(jsonb_build_array(pg_temp.ep('e1', 'PC-1-renamed'))),
  '{"seen": 1, "new": 0, "reactivated": 0, "missing": 0, "retired": 0}'::jsonb, 'retired computers are not counted again');

select is(pg_temp.sync(jsonb_build_array(pg_temp.ep('e1', 'PC-1-renamed'), pg_temp.ep('e2', 'PC-2'))),
  '{"seen": 2, "new": 0, "reactivated": 1, "missing": 0, "retired": 0}'::jsonb, 'a returning endpoint is reactivated');
select results_eq($$select missing_syncs, retired_at is null from public.computers where sophos_endpoint_id = 'e2'$$,
  $$values (0, true)$$, 'reactivated computer is active again');

select is(pg_temp.sync('[]'::jsonb),
  '{"seen": 0, "new": 0, "reactivated": 0, "missing": 2, "retired": 0}'::jsonb, 'an empty list never deletes');
select is((select count(*) from public.computers where tenant_id = '10000000-0000-0000-0000-00000000000a'), 2::bigint,
  'rows are kept');

-- Another tenant cannot take over an endpoint ID.
select is(
  public.apply_computer_sync('10000000-0000-0000-0000-00000000000b', jsonb_build_array(pg_temp.ep('e1', 'HIJACK'))),
  '{"seen": 1, "new": 0, "reactivated": 0, "missing": 0, "retired": 0}'::jsonb, 'foreign endpoint IDs are ignored');
select is((select tenant_id from public.computers where sophos_endpoint_id = 'e1'),
  '10000000-0000-0000-0000-00000000000a'::uuid, 'endpoint stays in its tenant');

select throws_ok($$select public.apply_computer_sync('10000000-0000-0000-0000-00000000000a', 'null'::jsonb)$$,
  '22023', null, 'rejects a non-array payload');

-- Browser access.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.apply_computer_sync('10000000-0000-0000-0000-00000000000a', '[]'::jsonb)$$,
  '42501', null, 'browser users cannot run the sync function');
select results_eq('select name, active_computers, retired_computers from public.v_tenant_overview',
  $$values ('Tenant A', 2::bigint, 0::bigint)$$, 'viewer sees its tenant with counts only');
reset role;

select * from finish();
rollback;
