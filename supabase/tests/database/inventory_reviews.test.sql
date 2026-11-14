-- Inventory reviews: attestation against a recent package, append-only, status and the overdue alert.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select set_config('app.audit_purge', 'on', true);
truncate public.tenants, public.audit_log cascade;
delete from public.profiles;

select plan(20);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'first@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'operator@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer@example.com'),
  ('00000000-0000-0000-0000-00000000000e', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000000f', 'admin-b@example.com');
insert into public.tenants (id, sophos_tenant_id, name, id_type, created_at) values
  ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'partner', now() - interval '100 days'),
  ('10000000-0000-0000-0000-00000000000b', 'sophos-b', 'Tenant B', 'partner', now());
insert into public.tenant_members (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-00000000000e', '10000000-0000-0000-0000-00000000000a', 'admin'),
  ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000a', 'operator'),
  ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000a', 'viewer'),
  ('00000000-0000-0000-0000-00000000000f', '10000000-0000-0000-0000-00000000000b', 'admin');
insert into public.audit_reports (id, tenant_id, as_of, manifest, manifest_sha256, archive, users_masked, generated_at) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', now(), '{}', 'h', '\x00', false, now() - interval '1 day'),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a', now(), '{}', 'h', '\x00', false, now() - interval '8 days'),
  ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-00000000000b', now(), '{}', 'h', '\x00', false, now());
update public.alert_settings set enabled = true;

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.stmt() returns text language sql as $$ select 'I reviewed the inventory in the attached package.' $$;

-- No review yet: due = tenant created + 90 days, so it is overdue (100 days old).
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select results_eq($$select last_reviewed_at is null, due_at::date = (now() - interval '10 days')::date, overdue from public.inventory_review_status('10000000-0000-0000-0000-00000000000a')$$,
  $$values (true, true, true)$$, 'viewer sees the status: never reviewed, due created + 90 days, overdue');
select is((select count(*)::int from public.inventory_review_status('10000000-0000-0000-0000-00000000000b')), 0, 'no status for a tenant the user is not in');
select throws_ok($$select public.record_inventory_review('50000000-0000-0000-0000-000000000001', 'accurate', pg_temp.stmt())$$, '42501', null, 'viewer cannot record');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select throws_ok($$select public.record_inventory_review('50000000-0000-0000-0000-000000000001', 'accurate', pg_temp.stmt())$$, '42501', null, 'operator cannot record');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select throws_ok($$select public.record_inventory_review('50000000-0000-0000-0000-000000000003', 'accurate', pg_temp.stmt())$$, '42501', null, 'package of another tenant');
select throws_ok($$select public.record_inventory_review('50000000-0000-0000-0000-000000000002', 'accurate', pg_temp.stmt())$$, '22023',
  'Generate a new evidence package first (the last one is older than 7 days)', 'package older than 7 days');
select throws_ok($$select public.record_inventory_review('50000000-0000-0000-0000-000000000001', 'accurate', 'too short')$$, '23514', null, 'statement needs 20 characters');
select throws_ok($$select public.record_inventory_review('50000000-0000-0000-0000-000000000001', 'maybe', pg_temp.stmt())$$, '23514', null, 'outcome is checked');

reset role;
-- The alert for the never-reviewed tenant, once.
select is(public.detect_alerts(), 1, 'review_overdue raised for tenant A');
select is(public.detect_alerts(), 0, 'not raised twice in the same period');
select is((select body from public.alerts where kind = 'review_overdue'), 'Inventory review overdue since ' || to_char(now() - interval '10 days', 'YYYY-MM-DD')
  || '. Generate an evidence package and record the review on the Reports page.', 'alert message names the due date');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
create temp table rid as select public.record_inventory_review('50000000-0000-0000-0000-000000000001', 'accurate_with_changes', pg_temp.stmt(), 'note') as id;
grant select on rid to authenticated;
select ok((select id from rid) is not null, 'admin records a review against a 1-day-old package');
select is((select count(*)::int from public.inventory_reviews where reviewer_email = 'admin@example.com' and outcome = 'accurate_with_changes' and notes = 'note'), 1, 'review stored with the reviewer email');
select results_eq($$select last_reviewer, overdue, due_at::date = (now() + interval '90 days')::date from public.inventory_review_status('10000000-0000-0000-0000-00000000000a')$$,
  $$values ('admin@example.com', false, true)$$, 'after a review: not overdue, due in 90 days');
select throws_ok($$update public.inventory_reviews set notes = 'x'$$, '42501', null, 'update is blocked');
select throws_ok($$delete from public.inventory_reviews$$, '42501', null, 'delete is blocked');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.inventory_reviews where tenant_id = '10000000-0000-0000-0000-00000000000a'), 1, 'a viewer of tenant A reads the review');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
select is((select count(*)::int from public.inventory_reviews where tenant_id = '10000000-0000-0000-0000-00000000000a'), 0, 'a member of tenant B reads no review of tenant A');

reset role;
select is((select count(*)::int from public.audit_log where action = 'inventory_review' and user_id = '00000000-0000-0000-0000-00000000000e'), 1, 'audit row written');
select is(public.detect_alerts(), 0, 'no new alert after the review');

select * from finish();
rollback;
