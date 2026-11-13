-- Scans › Recent runs drawer: run_detail(run) — status per computer, size and a preview of the raw rows.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select set_config('app.audit_purge', 'on', true);
truncate public.tenants, public.software_titles, public.sophos_connection, public.audit_log cascade;
delete from public.profiles;

select plan(10);

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
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'ep-w2', 'W2', 'windows');
insert into public.scan_cycles (id, tenant_id, opened_at, closes_at) values
  ('60000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', now() - interval '1 day', now() + interval '6 days');
insert into public.query_runs (id, tenant_id, provider, domain, platform, query_id, query_version, endpoint_ids, status, error) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'live_endpoint_search', 'programs', 'windows',
   (select id from public.query_catalog where platform = 'windows' and name = 'inv.programs' and version = 1), 1, '{ep-w1,ep-w2}', 'finished', null);
insert into public.scan_tasks (tenant_id, cycle_id, computer_id, domain, query_id, status, attempts, next_attempt_at, last_run_id, last_error) values
  ('10000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'programs',
   (select id from public.query_catalog where platform = 'windows' and name = 'inv.programs' and version = 1), 'collected', 1, now(), '50000000-0000-0000-0000-000000000001', null),
  ('10000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', 'programs',
   (select id from public.query_catalog where platform = 'windows' and name = 'inv.programs' and version = 1), 'no_response', 1, now(), '50000000-0000-0000-0000-000000000001',
   'The computer did not answer before the run timed out.');
insert into public.raw_results (tenant_id, run_id, computer_id, rows, row_count, query_id, ingest_error) values
  ('10000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a1',
   (select jsonb_agg(jsonb_build_object('name', 'App ' || n, 'version', '1.' || n, 'install_location', 'C:\Users\alice\App' || n)) from generate_series(1, 25) n),
   25, (select id from public.query_catalog where platform = 'windows' and name = 'inv.programs' and version = 1), 'bad row 7');

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.d() returns jsonb language sql as $$ select public.run_detail('50000000-0000-0000-0000-000000000001') $$;
create function pg_temp.c(host text) returns jsonb language sql as $$
  select e from jsonb_array_elements(pg_temp.d() -> 'computers') e where e ->> 'hostname' = host $$;

-- Operator of tenant A
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select results_eq($$select pg_temp.d() #>> '{run,status}', pg_temp.d() #>> '{run,query_name}', (pg_temp.d() ->> 'preview_allowed')::boolean,
    jsonb_array_length(pg_temp.d() -> 'computers')$$,
  $$values ('finished', 'inv.programs', true, 2)$$, 'operator: run summary, preview allowed, one entry per computer of the run');
select results_eq($$select pg_temp.c('W1') ->> 'task_status', (pg_temp.c('W1') ->> 'row_count')::int, jsonb_array_length(pg_temp.c('W1') -> 'rows'),
    pg_temp.c('W1') ->> 'ingest_error'$$,
  $$values ('collected', 25, 20, 'bad row 7')$$, 'collected computer: 25 rows, a preview of the first 20, the ingest error');
select ok((pg_temp.c('W1') ->> 'bytes')::int > 1000, 'collected computer: size in bytes of the stored rows');
select is(pg_temp.c('W1') #>> '{rows,0,name}', 'App 1', 'preview keeps the order of the response');
select results_eq($$select pg_temp.c('W2') ->> 'task_status', pg_temp.c('W2') ->> 'last_error', pg_temp.c('W2') -> 'row_count', pg_temp.c('W2') -> 'rows'$$,
  $$values ('no_response', 'The computer did not answer before the run timed out.', 'null'::jsonb, 'null'::jsonb)$$,
  'computer that did not answer: status and message, no rows');
reset role;

-- Viewer of tenant A: sizes yes, raw rows no (they hold user names and paths)
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select results_eq($$select (pg_temp.d() ->> 'preview_allowed')::boolean, (pg_temp.c('W1') ->> 'row_count')::int, pg_temp.c('W1') -> 'rows'$$,
  $$values (false, 25, 'null'::jsonb)$$, 'viewer: counts and sizes, no preview');
reset role;

-- Operator of another tenant
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select is(pg_temp.d(), null, 'another tenant: nothing');
reset role;

select is(public.run_detail('59999999-0000-0000-0000-000000000000'), null, 'unknown run: nothing');
set local role anon;
select throws_ok($$select public.run_detail('50000000-0000-0000-0000-000000000001')$$, '42501', null, 'anon cannot call it');
reset role;
select is((select has_function_privilege('authenticated', 'public.run_detail(uuid)', 'execute')), true, 'signed-in users can call it');

select * from finish();
rollback;
