-- Phase 7: Hub connection, dictionary changes, classification order, sync backoff, saved searches,
-- reclassification requests and CSV exports.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
-- Start from an empty app inside this transaction so data from local use cannot leak into the
-- assertions; the final rollback restores everything.
truncate public.tenants, public.software_titles, public.sophos_connection, public.audit_log,
  public.dictionary_cache, public.hub_submissions cascade;
delete from public.profiles;
delete from vault.secrets where name in ('sophos_client_secret', 'hub_client_key');
delete from public.saved_searches where owner_id is not null;
update public.hub_connection set url = null, key_secret_id = null, key_hint = null, configured_at = null,
  share_unknown_titles = true, last_seq = 0, synced_at = null, last_attempt_at = null, last_error = null,
  failures = 0, next_attempt_at = null;
delete from public.maintenance_state;

select plan(46);

-- Fixtures ----------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'operator@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer@example.com');
insert into public.tenants (id, sophos_tenant_id, name, id_type) values
  ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'partner'),
  ('10000000-0000-0000-0000-00000000000b', 'sophos-b', 'Tenant B', 'partner');
insert into public.tenant_members (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000a', 'operator'),
  ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000a', 'viewer');
insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform, associated_user) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'ep-w1', 'W1', 'windows', 'CORP\alice'),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'ep-m1', 'M1', 'macos', 'bob'),
  ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'ep-w2', 'W2', 'windows', 'carol');
insert into public.software_titles (id, kind, source, match_key, canonical_name) values
  ('30000000-0000-0000-0000-000000000001', 'extension', 'chrome', 'inomeogfingihgjfjlpeplalcfajhgai', 'Chrome Remote Desktop'),
  ('30000000-0000-0000-0000-000000000002', 'program', 'programs', '7-zip|igor pavlov', '7-Zip'),
  ('30000000-0000-0000-0000-000000000004', 'program', 'programs', 'evil|', '=HYPERLINK("http://x")');
insert into public.snapshots (id, tenant_id, computer_id, domain, query_name, query_version, collected_at, row_count, content_hash) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', 'programs', 'inv.programs', 1, now(), 1, 'h');
insert into public.installations (tenant_id, computer_id, title_id, domain, query_name, scope_key, username, version, row_hash, valid_from) values
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000001', 'extensions', 'inv.extensions', 'alice|Default', 'alice', '124.0', 'h1', now() - interval '20 days'),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000002', 'programs', 'inv.programs', '', null, '23.01', 'h2', now() - interval '20 days'),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-000000000004', 'programs', 'inv.programs', '', null, '1.0', 'h3', now() - interval '20 days'),
  ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-000000000002', 'programs', 'inv.programs', '', null, '22.0', 'h4', now() - interval '20 days');
insert into public.change_events (tenant_id, computer_id, title_id, domain, change, from_version, to_version, snapshot_id, detected_at) values
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000002', 'programs', 'updated', '22.0', '23.01', '40000000-0000-0000-0000-000000000001', now() - interval '1 day'),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000001', 'extensions', 'added', null, '124.0', '40000000-0000-0000-0000-000000000001', now() - interval '2 days');

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function pg_temp.lines(csv text) returns int language sql as $$
  select array_length(string_to_array(rtrim(csv, E'\r\n'), E'\r\n'), 1);
$$;

-- Hub connection ----------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select throws_ok($$select public.set_hub_connection('https://hub.example.com', 'hubkey-0123456789abcdef')$$, '42501', null,
  'operator cannot set the hub connection');
select throws_ok($$select public.set_hub_sharing(false)$$, '42501', null, 'operator cannot switch sharing');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select throws_ok($$select public.set_hub_connection('ftp://hub.example.com', 'hubkey-0123456789abcdef')$$, '22023', null,
  'hub URL must be http(s)');
select lives_ok($$select public.set_hub_connection('https://hub.example.com/', 'hubkey-0123456789abcdef')$$, 'admin sets the hub connection');
select results_eq('select configured, url, key_hint, share_unknown_titles from public.get_hub_status()',
  $$values (true, 'https://hub.example.com', '••••cdef', true)$$, 'admin sees the URL (no trailing slash) and the key hint');
select is((select position('0123456789abcdef' in s::text) from public.get_hub_status() s), 0, 'the status never returns the key');
select lives_ok($$select public.set_hub_sharing(false)$$, 'admin switches sharing off');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select results_eq('select configured, url, share_unknown_titles from public.get_hub_status()',
  $$values (true, null::text, false)$$, 'others learn only that the hub is configured');
reset role;

select is((select client_key from public.get_hub_credential()), 'hubkey-0123456789abcdef', 'the service role reads the key');
select ok(not has_function_privilege('authenticated', 'public.get_hub_credential()', 'execute'), 'users cannot read the key');
select ok(not has_function_privilege('authenticated', 'public.apply_dictionary_changes(jsonb, jsonb, bigint)', 'execute'),
  'users cannot write the dictionary');
select results_eq($$select action, data ->> 'key_hint' from public.audit_log where target = 'hub_connection' order by id$$,
  $$values ('set hub_connection', '••••cdef'), ('set hub_sharing', null)$$, 'changes audited without the key');

-- Dictionary changes ------------------------------------------------------------------------------
select results_eq($$select public.apply_dictionary_changes(
  '[{"id": "c1000000-0000-0000-0000-000000000001", "slug": "remote-access/remote-desktop-and-support", "parent_id": "c1000000-0000-0000-0000-000000000000",
     "name": "Remote desktop and support", "attention_level": "review", "revision": 1, "seq": 2},
    {"id": "c1000000-0000-0000-0000-000000000000", "slug": "remote-access", "parent_id": null, "name": "Remote access", "revision": 1, "seq": 1},
    {"id": "c1000000-0000-0000-0000-000000000002", "slug": "remote-access/new-thing", "parent_id": "c1000000-0000-0000-0000-000000000000",
     "name": "New thing", "attention_level": "not_allowed", "revision": 1, "seq": 3},
    {"id": "c1000000-0000-0000-0000-000000000003", "slug": "orphan/child", "parent_id": "c1000000-0000-0000-0000-0000000000ff",
     "name": "Orphan", "attention_level": "info", "revision": 1, "seq": 4}]',
  '[{"kind": "extension", "source": "chrome", "match_key": "inomeogfingihgjfjlpeplalcfajhgai", "canonical_name": "Chrome Remote Desktop",
     "category_id": "c1000000-0000-0000-0000-000000000001", "confidence": 0.91, "method": "jev", "revision": 1, "status": "published", "seq": 5},
    {"kind": "program", "source": "programs", "match_key": "7-zip|igor pavlov", "canonical_name": "7-Zip",
     "category_id": "c1000000-0000-0000-0000-0000000000ee", "method": "manual", "revision": 1, "status": "published", "seq": 6},
    {"kind": "program", "source": "programs", "match_key": "evil|", "canonical_name": "Evil",
     "category_id": "c1000000-0000-0000-0000-000000000001", "method": "magic", "revision": 1, "status": "published", "seq": 7}]',
  10)$$,
  $$values ('{"categories": 3, "upserted": 1, "dropped": 0, "skipped": 3}'::jsonb)$$,
  'a page: 3 categories, 1 entry, unknown parent/category/method skipped');
select is((select hub_id from public.categories_cache where slug = 'remote-access'), 'c1000000-0000-0000-0000-000000000000'::uuid,
  'seeded category matched by slug learns its hub id');
select results_eq($$select parent_slug, level, attention_level from public.categories_cache where slug = 'remote-access/new-thing'$$,
  $$values ('remote-access', 2::smallint, 'not_allowed'::public.attention_level)$$, 'a new level-2 category');
select results_eq($$select origin, level2_name, attention_level, method, confidence from public.title_classification
  where title_id = '30000000-0000-0000-0000-000000000001'$$,
  $$values ('hub', 'Remote desktop and support', 'review'::public.attention_level, 'jev', 0.910::numeric)$$,
  'the entry classifies the title with the category default attention');
select is((select last_seq from public.hub_connection), 10::bigint, 'last_seq advances');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select results_eq($$select canonical_name from public.search_titles(p_category := 'remote-access,proxy-and-tunnel')$$,
  $$values ('Chrome Remote Desktop')$$, 'search accepts several categories');
reset role;

select public.apply_dictionary_changes('[]',
  '[{"kind": "extension", "source": "chrome", "match_key": "inomeogfingihgjfjlpeplalcfajhgai", "canonical_name": "Chrome Remote Desktop",
     "category_id": "c1000000-0000-0000-0000-000000000002", "method": "manual", "revision": 0, "status": "published", "seq": 8}]', 5);
select is((select category_slug from public.dictionary_cache where match_key = 'inomeogfingihgjfjlpeplalcfajhgai'),
  'remote-access/remote-desktop-and-support', 'an older revision is ignored');
select is((select last_seq from public.hub_connection), 10::bigint, 'last_seq never goes back');

select public.apply_dictionary_changes('[]',
  '[{"kind": "extension", "source": "chrome", "match_key": "inomeogfingihgjfjlpeplalcfajhgai", "canonical_name": "Chrome Remote Desktop",
     "category_id": "c1000000-0000-0000-0000-000000000002", "method": "manual", "revision": 2, "status": "published", "seq": 11}]', 11);
select results_eq($$select origin, level2_name, attention_level, method from public.title_classification
  where title_id = '30000000-0000-0000-0000-000000000001'$$,
  $$values ('hub', 'New thing', 'not_allowed'::public.attention_level, 'manual')$$, 'a newer revision reclassifies the title');

insert into public.local_overrides (title_id, category_slug, note)
values ('30000000-0000-0000-0000-000000000001', 'remote-access/remote-desktop-and-support', 'IT approved');
select results_eq($$select origin, level2_name from public.title_classification where title_id = '30000000-0000-0000-0000-000000000001'$$,
  $$values ('local_override', 'Remote desktop and support')$$, 'a local override wins over the hub');
delete from public.local_overrides;

update public.maintenance_state set at = now() - interval '10 minutes' where key = 'dictionary_changed';
insert into public.maintenance_state (key, at) values ('title_summary_refreshed', now() - interval '6 minutes');
update public.maintenance_state set at = now() where key = 'dictionary_changed';
select ok(public.refresh_title_summary_if_due(), 'title_summary refreshes after a dictionary change');
select ok(not public.refresh_title_summary_if_due(), 'and not again within 5 minutes');

select results_eq($$select public.apply_dictionary_changes('[]',
  '[{"kind": "extension", "source": "chrome", "match_key": "inomeogfingihgjfjlpeplalcfajhgai", "status": "deprecated", "seq": 12}]', 12)
  ->> 'dropped'$$, $$values ('1')$$, 'a deprecated entry is dropped');
select is((select origin from public.title_classification where title_id = '30000000-0000-0000-0000-000000000001'), 'unclassified',
  'and its title is unclassified again');

-- Sync backoff ------------------------------------------------------------------------------------
select is(public.hub_sync_finished(false, 'Hub unreachable'), now() + interval '5 minutes', 'first failure: retry in 5 minutes');
select is(public.hub_sync_finished(false, 'Hub unreachable'), now() + interval '10 minutes', 'second failure: 10 minutes');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select results_eq('select delayed, last_error from public.get_hub_status()', $$values (true, 'Hub unreachable')$$,
  'a failing hub shows as delayed');
reset role;
select public.hub_sync_finished(false, 'x') from generate_series(1, 8);
select is(public.hub_sync_finished(false, 'x'), now() + interval '6 hours', 'backoff stops at 6 hours');
select is(public.hub_sync_finished(true), now() + interval '6 hours', 'success: next sync in 6 hours');
select results_eq('select failures, last_error, synced_at from public.hub_connection', $$values (0, null::text, now())$$,
  'success clears the failures');

-- Saved searches ----------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select lives_ok($$insert into public.saved_searches (name, params, owner_id) values ('My Git', '{"q": "git"}', auth.uid())$$,
  'operator saves a personal search');
select throws_ok($$insert into public.saved_searches (name, params, owner_id) values ('For all', '{}', null)$$, '42501', null,
  'only admins share searches');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select results_eq('select name, params from public.saved_searches order by name',
  $$values ('Remote access & tunnels', '{"category": "remote-access,proxy-and-tunnel"}'::jsonb)$$,
  'viewer sees the shared seed, not others'' searches');
delete from public.saved_searches;
reset role;
select is((select count(*)::int from public.saved_searches where owner_id is null), 1, 'viewer cannot remove a shared search');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select lives_ok($$insert into public.saved_searches (name, params, owner_id) values ('Not allowed', '{"attention": "not_allowed"}', null)$$,
  'admin shares a search');
reset role;

-- Reclassification requests -----------------------------------------------------------------------
insert into public.reclassification_requests (hub_request_id, title_id, current_category_slug, reason)
values ('REQ-0001', '30000000-0000-0000-0000-000000000002', null, 'It is an archiver');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select is((select hub_request_id from public.reclassification_requests), 'REQ-0001', 'everyone reads the requests');
select throws_ok($$insert into public.reclassification_requests (hub_request_id, title_id, reason)
  values ('REQ-9', '30000000-0000-0000-0000-000000000002', 'x')$$, '42501', null, 'only the Edge Functions write them');

-- CSV exports -------------------------------------------------------------------------------------
select throws_ok($$select public.export_csv('computers', '{}')$$, '42501', null, 'viewers cannot export');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select is(pg_temp.lines(public.export_csv('computers', '{}')), 3, 'operator: header + the 2 computers of its tenant');
select ok((select position('"W1","Tenant A","windows"' in x) = 1 + position(E'\r\n' in x) + 1 and position('"CORP\alice"' in x) > 0
  from public.export_csv('computers', '{"search": "w1"}') x), 'filters apply and the operator sees users');
select ok(public.export_csv('software', '{}') like '%"''=HYPERLINK(""http://x"")"%', 'formulas are neutralised and quotes doubled');
select is(pg_temp.lines(public.export_csv('changes', '{"change": "updated"}')), 2, 'changes export follows the filters');
select throws_ok($$select public.export_csv('title_computers', '{}')$$, '22023', null, 'a title export needs the title');
reset role;

select results_eq($$select target, data -> 'rows', position('W1' in data::text) from public.audit_log
  where action = 'export csv' order by id limit 2$$,
  $$values ('computers', '2'::jsonb, 0), ('computers', '1'::jsonb, 0)$$, 'exports are audited with filters and counts, never rows');

select * from finish();
rollback;
