-- Computer context: owner, department, criticality, scope tags (set_computer_context, import_computer_context).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select set_config('app.audit_purge', 'on', true);
truncate public.tenants, public.software_titles, public.sophos_connection, public.audit_log cascade;
delete from public.profiles;

select plan(21);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000b', 'operator@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'other@example.com');
insert into public.tenants (id, sophos_tenant_id, name, id_type) values
  ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'partner'),
  ('10000000-0000-0000-0000-00000000000b', 'sophos-b', 'Tenant B', 'partner');
insert into public.tenant_members (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000a', 'operator'),
  ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000a', 'viewer'),
  ('00000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-00000000000b', 'operator');
insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'ep-w1', 'W1', 'windows'),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'ep-w2', 'W2', 'windows'),
  ('20000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', 'ep-w3', 'W3', 'windows'),
  ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'ep-b1', 'B1', 'windows');

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- Operator of tenant A
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select is(public.set_computer_context('{20000000-0000-0000-0000-0000000000a1,20000000-0000-0000-0000-0000000000a2}',
  'Alice Example', 'Finance', 'high', '{pci,iso 27001}'), 2, 'operator sets the context of 2 computers');
select results_eq($$select hostname, owner, department, criticality, scope_tags from public.v_computer_list where hostname like 'W%' order by hostname$$,
  $$values ('W1', 'Alice Example', 'Finance', 'high', '{pci,"iso 27001"}'::text[]),
           ('W2', 'Alice Example', 'Finance', 'high', '{pci,"iso 27001"}'::text[]),
           ('W3', null, null, null, '{}'::text[])$$, 'values are stored and visible in v_computer_list');
select set_config('role', 'postgres', true);
select is((select count(*)::int from public.audit_log where action = 'computer_context'), 1, 'one audit row per call');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.set_computer_context('{20000000-0000-0000-0000-0000000000a2}', '', null, null, '{}');
select results_eq($$select owner, department, scope_tags from public.v_computer_list where hostname = 'W2'$$,
  $$values (null, 'Finance', '{}'::text[])$$, 'empty value clears, null leaves unchanged');
select throws_ok($$select public.set_computer_context('{20000000-0000-0000-0000-0000000000a1}', null, null, 'urgent', null)$$, '23514', null, 'bad criticality');
select throws_ok($$select public.set_computer_context('{20000000-0000-0000-0000-0000000000a1}', null, null, null, '{"p c i!"}')$$, '22023', null, 'bad tag');

-- Sync keeps the context
select set_config('role', 'postgres', true);
select public.apply_computer_sync('10000000-0000-0000-0000-00000000000a',
  '[{"sophos_endpoint_id":"ep-w1","hostname":"W1-renamed","platform":"windows","endpoint_type":"computer"}]'::jsonb);
select results_eq($$select hostname, owner, criticality, scope_tags from public.computers where sophos_endpoint_id = 'ep-w1'$$,
  $$values ('W1-renamed', 'Alice Example', 'high', '{pci,"iso 27001"}'::text[])$$, 'sync keeps context');

-- Import
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
create function pg_temp.imp() returns jsonb language sql as $$
  select public.import_computer_context('10000000-0000-0000-0000-00000000000a', '[
    {"endpoint_id":"ep-w3","owner":"Bob Example","scope_tags":"pci;cde"},
    {"hostname":"w2","department":"IT","criticality":"low"},
    {"hostname":"NOPE","owner":"x"},
    {"endpoint_id":"ep-w1","owner":"Mallory","criticality":"urgent"}]'::jsonb) $$;
create temp table imp as select pg_temp.imp() as r;
grant select on imp to authenticated;
select is((select r -> 'applied' from imp), '2'::jsonb, 'import applies the 2 good rows');
select is((select jsonb_agg(e -> 'row' order by e ->> 'row') from imp, jsonb_array_elements(r -> 'errors') e), '[3, 4]'::jsonb, 'import reports the bad rows by number');
select results_eq($$select hostname, owner, department, criticality, scope_tags from public.v_computer_list where hostname in ('W2', 'W3') order by hostname$$,
  $$values ('W2', null, 'IT', 'low', '{}'::text[]), ('W3', 'Bob Example', null, null, '{pci,cde}'::text[])$$, 'endpoint and hostname matches applied');
select is((select owner from public.v_computer_list where id = '20000000-0000-0000-0000-0000000000a1'), 'Alice Example', 'the bad rows changed nothing');
select set_config('role', 'postgres', true);
select is((select data -> 'changes' -> 0 ->> 'computer_id' || ':' || (data -> 'changes' -> 0 ->> 'owner') || ':' || (data -> 'changes' -> 1 ->> 'criticality') || ':' || jsonb_array_length(data -> 'changes')
  from public.audit_log where action = 'computer_context' and (data ->> 'import')::boolean), '20000000-0000-0000-0000-0000000000a3:Bob Example:low:2', 'import audit row says which computer got which values');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from regexp_split_to_table(public.export_csv('computers', '{"owner":"bob"}'), E'\r\n') l where l like '%"ep-w3"'), 1, 'export ends with the endpoint id');

select is((select count(*)::int from regexp_split_to_table(public.export_csv('computers', '{"criticality":"low","scope":""}'), E'\r\n') l where l like '%"IT","low"%'), 1, 'export has the context columns and filters on criticality');

select is(split_part(public.export_csv('computers', '{}'), chr(13), 1),
  'Hostname,Tenant,Platform,OS,OS version,User,Last seen,Last collected,Cycle status,Programs,Extensions,Packages,Attention,'
  || 'Owner,Department,Criticality,Scope tags,Coverage,Inventoried at,Inventory source,Endpoint ID', 'export header has the coverage columns');

-- Viewer and operator of another tenant
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select throws_ok($$select public.set_computer_context('{20000000-0000-0000-0000-0000000000a1}', 'x', null, null, null)$$, '42501', null, 'viewer cannot set');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select throws_ok($$select public.set_computer_context('{20000000-0000-0000-0000-0000000000a1}', 'x', null, null, null)$$, '42501', null, 'operator of another tenant cannot set');
select throws_ok($$select public.import_computer_context('10000000-0000-0000-0000-00000000000a', '[{"endpoint_id":"ep-w1","owner":"x"}]')$$,
  '42501', null, 'operator of another tenant cannot import into it');
-- (the first user, 0b, is a global admin; 0d is an operator of tenant B only)
select throws_ok($$select public.set_computer_context('{20000000-0000-0000-0000-0000000000b1,20000000-0000-0000-0000-0000000000a1}', 'Mallory', null, null, null)$$,
  '42501', null, 'a list with a computer of another tenant is refused');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select throws_ok($$select public.import_computer_context('10000000-0000-0000-0000-00000000000a', '[{"endpoint_id":"ep-w1","owner":"x"}]')$$,
  '42501', null, 'viewer cannot import');
select set_config('role', 'postgres', true);
select results_eq($$select sophos_endpoint_id, owner from public.computers where sophos_endpoint_id in ('ep-w1', 'ep-b1') order by 1$$,
  $$values ('ep-b1', null::text), ('ep-w1', 'Alice Example')$$, 'the refused calls changed nothing');

select * from finish();
rollback;
