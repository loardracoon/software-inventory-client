-- Audit log: hash chain, append-only, 400-day purge with anchor, verify and export (PCI 10.5.1, NIST AU-9/AU-11).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select set_config('app.audit_purge', 'on', true);
truncate public.audit_log, public.audit_anchor;
select set_config('app.audit_purge', 'off', true);
delete from public.profiles;

select plan(21);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'viewer@example.com');
update public.profiles set role = 'viewer' where email = 'viewer@example.com';

-- Rows 500 days old go first: the purge removes the oldest contiguous prefix.
insert into public.audit_log (action, target, created_at) select 'old', 'o' || g, now() - interval '500 days' + g * interval '1 minute' from generate_series(1, 3) g;
insert into public.audit_log (user_id, action, target, data)
  select '00000000-0000-0000-0000-0000000000a1', 'test', 't' || g, jsonb_build_object('n', g) from generate_series(1, 5) g;

select is((select count(distinct coalesce(prev_hash, ''))::int from public.audit_log), 8, 'every row has its own prev_hash');
select is((select count(*)::int from (select prev_hash, lag(row_hash) over (order by id) as p from public.audit_log) s where prev_hash is distinct from p), 0, 'each prev_hash is the previous row_hash (first one has the empty anchor)');

select throws_ok($$update public.audit_log set action = 'x'$$, '42501', null, 'update is blocked');
select throws_ok($$delete from public.audit_log$$, '42501', null, 'delete is blocked');

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select results_eq($$select checked, first_bad_id from public.verify_audit_log()$$, $$values (8::bigint, null::bigint)$$, 'verify: chain intact');
select is((select count(*)::int from public.export_audit_log(now() - interval '1 day', now() + interval '1 day')), 5, 'export returns the rows of the range');
select set_config('role', 'postgres', true);

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$select * from public.verify_audit_log()$$, '42501', null, 'non-admin cannot verify');
select throws_ok($$select * from public.export_audit_log(null, null)$$, '42501', null, 'non-admin cannot export');
select set_config('role', 'postgres', true);

select throws_ok($$truncate public.audit_log$$, '42501', null, 'truncate is blocked');

-- Removing a user who has audit rows keeps the row, its user id and the chain
insert into public.audit_log (user_id, action, target) values ('00000000-0000-0000-0000-0000000000a2', 'viewer acted', 'x');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.remove_user('00000000-0000-0000-0000-0000000000a2')$$, 'admin removes a user who has audit rows');
select results_eq($$select first_bad_id from public.verify_audit_log()$$, $$values (null::bigint)$$, 'chain intact after the user is removed');
select set_config('role', 'postgres', true);
select is((select user_id::text from public.audit_log where action = 'viewer acted'), '00000000-0000-0000-0000-0000000000a2', 'the row keeps the actor id');

-- Purge
select is(public.purge_audit_log(400), 3, 'purge deletes the rows older than 400 days');
select ok((select last_purged_id is not null and last_purged_hash is not null from public.audit_anchor), 'the anchor records the last purged row');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select results_eq($$select first_bad_id from public.verify_audit_log()$$, $$values (null::bigint)$$, 'verify after purge: chain intact from the anchor');
select set_config('role', 'postgres', true);
select ok(not has_table_privilege('service_role', 'public.audit_anchor', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'), 'service_role has no privilege on audit_anchor');
select throws_ok($$set local role service_role; update public.audit_anchor set last_purged_hash = 'x'$$, '42501', null, 'service_role cannot change the anchor directly');
select lives_ok($$set local role service_role; select public.purge_audit_log(400)$$, 'service_role still purges through the function');
select set_config('role', 'postgres', true);

-- Tamper
select set_config('app.audit_purge', 'on', true);
update public.audit_log set data = '{"n": 99}' where target = 't3';
select set_config('app.audit_purge', 'off', true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select results_eq($$select first_bad_id from public.verify_audit_log()$$, $$select id from public.audit_log where target = 't3'$$, 'verify reports the tampered row');
select set_config('role', 'postgres', true);

select is((select count(*)::int from cron.job where jobname = 'audit-log-retention' and schedule = '15 4 * * *'), 1, 'retention job is scheduled');
select throws_ok($$set local role authenticated; select public.purge_audit_log(1)$$, '42501', null, 'authenticated cannot purge');

select * from finish();
rollback;
