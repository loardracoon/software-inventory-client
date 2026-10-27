-- Phase 5: ingest_snapshot / apply_snapshot (SCD type 2), baselines, events, title_summary.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
-- Start from an empty app inside this transaction so data from local use cannot leak into the
-- assertions; the final rollback restores everything.
truncate public.tenants, public.software_titles, public.sophos_connection, public.audit_log,
  public.dictionary_cache, public.hub_submissions cascade;
delete from public.profiles;
delete from vault.secrets where name = 'sophos_client_secret';
delete from public.maintenance_state;

select plan(26);

-- Fixtures ----------------------------------------------------------------------------------------
insert into public.tenants (id, sophos_tenant_id, name, id_type) values
  ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'tenant');
insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'ep-w1', 'W1', 'windows'),
  ('20000000-0000-0000-0000-0000000000a4', '10000000-0000-0000-0000-00000000000a', 'ep-l1', 'L1', 'linux');
insert into public.query_runs (id, tenant_id, provider, domain, platform, query_version, status) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'live_endpoint_search', 'extensions', 'windows', 1, 'finished');

create function pg_temp.q(p_platform text, p_name text, p_version int default 1) returns uuid language sql as $$
  select id from public.query_catalog where platform::text = p_platform and name = p_name and version = p_version;
$$;
-- A raw result collected at p_at (the rows themselves are not read by apply_snapshot).
create function pg_temp.raw(p_computer uuid, p_query uuid, p_at timestamptz) returns uuid language sql as $$
  insert into public.raw_results (tenant_id, run_id, computer_id, rows, row_count, query_id, received_at)
  values ('10000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', p_computer, '[]', 0, p_query, p_at)
  on conflict (run_id, computer_id) do nothing
  returning id;
$$;
-- raw_results is unique per (run, computer): give each snapshot its own run.
create function pg_temp.raw_new(p_computer uuid, p_query uuid, p_at timestamptz) returns uuid language plpgsql as $$
declare v_run uuid; v_id uuid;
begin
  insert into public.query_runs (tenant_id, provider, domain, platform, query_version, status)
  values ('10000000-0000-0000-0000-00000000000a', 'live_endpoint_search', 'extensions', 'windows', 1, 'finished') returning id into v_run;
  insert into public.raw_results (tenant_id, run_id, computer_id, rows, row_count, query_id, received_at)
  values ('10000000-0000-0000-0000-00000000000a', v_run, p_computer, '[]', 0, p_query, p_at) returning id into v_id;
  return v_id;
end $$;
create function pg_temp.ext(p_id text, p_version text) returns jsonb language sql as $$
  select jsonb_build_object(
    'title', jsonb_build_object('kind', 'extension', 'source', 'chrome', 'match_key', p_id, 'canonical_name', 'Ext ' || p_id,
                                'vendor', null, 'external_id', p_id, 'description', 'Untrusted <b>text</b>'),
    'scope_key', 'user01|Default', 'username', 'user01', 'version', p_version,
    'path', 'C:\Users\user01\AppData\Local\Google\Chrome\User Data\Default\Extensions\' || p_id,
    'attrs', '{}'::jsonb, 'row_hash', md5(p_id || ':' || p_version));
$$;
create function pg_temp.pkg(p_source text, p_name text, p_version text) returns jsonb language sql as $$
  select jsonb_build_object(
    'title', jsonb_build_object('kind', 'program', 'source', p_source, 'match_key', p_name || '|', 'canonical_name', p_name,
                                'vendor', null, 'external_id', null, 'description', null),
    'scope_key', '', 'username', null, 'version', p_version, 'path', null, 'attrs', '{}'::jsonb,
    'row_hash', md5(p_source || p_name || p_version));
$$;
create function pg_temp.payload(p_items jsonb) returns jsonb language sql as $$
  select jsonb_build_object('items', p_items, 'content_hash', md5(p_items::text));
$$;
create function pg_temp.ingest(p_computer uuid, p_query uuid, p_at timestamptz, p_items jsonb) returns text language sql as $$
  select public.ingest_snapshot(pg_temp.raw_new(p_computer, p_query, p_at), pg_temp.payload(p_items)) ->> 'outcome';
$$;
create function pg_temp.open_versions() returns text language sql as $$
  select string_agg(t.match_key || '=' || i.version, ',' order by t.match_key)
  from public.installations i join public.software_titles t on t.id = i.title_id
  where i.computer_id = '20000000-0000-0000-0000-0000000000a1' and i.valid_to is null;
$$;

-- First snapshot: baseline, no events ---------------------------------------------------------------
select is(pg_temp.ingest('20000000-0000-0000-0000-0000000000a1', pg_temp.q('windows', 'inv.extensions'), '2026-10-05 13:00Z',
  jsonb_build_array(pg_temp.ext('a', '1.0'), pg_temp.ext('b', '1.0'), pg_temp.ext('c', '1.0'))), 'baseline', 'the first collection is a baseline');
select is(pg_temp.open_versions(), 'a=1.0,b=1.0,c=1.0', 'the baseline opens every installation');
select is((select count(*)::int from public.change_events), 0, 'a baseline creates no change events');
select is((select count(*)::int from public.software_titles where kind = 'extension'), 3, 'titles are created');
select is((select count(*)::int from public.hub_submissions), 3, 'unknown titles are queued for the hub');
select is((select ingested_at is not null from public.raw_results order by received_at limit 1), true, 'the raw result is marked ingested');

-- Same content: unchanged -------------------------------------------------------------------------
select is(pg_temp.ingest('20000000-0000-0000-0000-0000000000a1', pg_temp.q('windows', 'inv.extensions'), '2026-10-12 13:00Z',
  jsonb_build_array(pg_temp.ext('a', '1.0'), pg_temp.ext('b', '1.0'), pg_temp.ext('c', '1.0'))), 'unchanged', 'same content is unchanged');
select is(
  (select count(distinct last_seen_snapshot)::int from public.installations where valid_to is null),
  1, 'unchanged touches last_seen_snapshot');
select is(
  (select last_seen_snapshot from public.installations where valid_to is null limit 1),
  (select id from public.snapshots order by collected_at desc limit 1), 'last_seen_snapshot is the latest snapshot');

-- One removed and one upgraded: exactly one removed and one updated event -------------------------
select is(pg_temp.ingest('20000000-0000-0000-0000-0000000000a1', pg_temp.q('windows', 'inv.extensions'), '2026-10-19 13:00Z',
  jsonb_build_array(pg_temp.ext('b', '2.0'), pg_temp.ext('c', '1.0'))), 'diff', 'a changed snapshot is diffed');
select results_eq(
  $$select change::text, t.match_key, from_version, to_version from public.change_events e join public.software_titles t on t.id = e.title_id order by 1$$,
  $$values ('removed', 'a', '1.0', null::text), ('updated', 'b', '1.0', '2.0')$$,
  'exactly one removed and one updated event');
select is(pg_temp.open_versions(), 'b=2.0,c=1.0', 'open rows follow the latest snapshot');
select is((select count(*)::int from public.installations), 4, 'history is kept: a, b 1.0 and c stay; b 2.0 is a new row');

-- Added ---------------------------------------------------------------------------------------------
select pg_temp.ingest('20000000-0000-0000-0000-0000000000a1', pg_temp.q('windows', 'inv.extensions'), '2026-10-26 13:00Z',
  jsonb_build_array(pg_temp.ext('b', '2.0'), pg_temp.ext('c', '1.0'), pg_temp.ext('d', '0.1')));
select is((select to_version from public.change_events where change = 'added'), '0.1', 'a new key is added');

-- As of: valid_from <= t < valid_to ---------------------------------------------------------------------
select is(
  (select string_agg(t.match_key || '=' || i.version, ',' order by t.match_key)
   from public.installations i join public.software_titles t on t.id = i.title_id
   where i.valid_from <= '2026-10-15 00:00Z' and (i.valid_to is null or i.valid_to > '2026-10-15 00:00Z')),
  'a=1.0,b=1.0,c=1.0', 'the inventory as of a past date is the old state');

-- Idempotency and order -------------------------------------------------------------------------------
select is(public.ingest_snapshot((select raw_result_id from public.snapshots order by collected_at desc limit 1), '{"items": []}'),
  '{"skipped": true}'::jsonb, 'a raw result is ingested once');
select is(public.apply_snapshot((select id from public.snapshots order by collected_at desc limit 1), '[]'),
  'diff', 'applying again returns the outcome without changes');
select is(pg_temp.ingest('20000000-0000-0000-0000-0000000000a1', pg_temp.q('windows', 'inv.extensions'), '2026-10-01 13:00Z',
  jsonb_build_array(pg_temp.ext('z', '9.9'))), 'out_of_order', 'an older snapshot arriving late is not applied');
select is(pg_temp.open_versions(), 'b=2.0,c=1.0,d=0.1', 'the late snapshot changed nothing');

-- New query version: baseline without events --------------------------------------------------------
insert into public.query_catalog (domain, platform, version, name, sql, required_tables)
values ('extensions', 'windows', 2, 'inv.extensions', 'SELECT 1', '{users}');
select is(pg_temp.ingest('20000000-0000-0000-0000-0000000000a1', pg_temp.q('windows', 'inv.extensions', 2), '2026-11-02 13:00Z',
  jsonb_build_array(pg_temp.ext('b', '2.0'), pg_temp.ext('e', '5.0'))), 'baseline', 'a new query version is a baseline');
select is((select count(*)::int from public.change_events), 3, 'the new baseline adds no events');

-- deb and rpm do not remove each other ----------------------------------------------------------------
select pg_temp.ingest('20000000-0000-0000-0000-0000000000a4', pg_temp.q('linux', 'inv.programs.deb'), '2026-10-05 13:00Z', jsonb_build_array(pg_temp.pkg('deb', 'curl', '8.5')));
select pg_temp.ingest('20000000-0000-0000-0000-0000000000a4', pg_temp.q('linux', 'inv.programs.rpm'), '2026-10-05 13:01Z', jsonb_build_array(pg_temp.pkg('rpm', 'bash', '5.2')));
select pg_temp.ingest('20000000-0000-0000-0000-0000000000a4', pg_temp.q('linux', 'inv.programs.deb'), '2026-10-12 13:00Z', jsonb_build_array(pg_temp.pkg('deb', 'curl', '8.6')));
select results_eq(
  $$select t.source, i.version from public.installations i join public.software_titles t on t.id = i.title_id
    where i.computer_id = '20000000-0000-0000-0000-0000000000a4' and i.valid_to is null order by 1$$,
  $$values ('deb', '8.6'), ('rpm', '5.2')$$, 'deb and rpm snapshots are diffed separately');

-- Hub queue skips known titles ----------------------------------------------------------------------
insert into public.dictionary_cache (kind, source, match_key, canonical_name, category_slug, attention_level, method)
values ('extension', 'chrome', 'f', 'Known', 'other/other', 'info', 'manual');
select pg_temp.ingest('20000000-0000-0000-0000-0000000000a1', pg_temp.q('windows', 'inv.extensions', 2), '2026-11-09 13:00Z',
  jsonb_build_array(pg_temp.ext('b', '2.0'), pg_temp.ext('e', '5.0'), pg_temp.ext('f', '1.0')));
select is((select count(*)::int from public.hub_submissions where match_key = 'f'), 0, 'titles the dictionary knows are not queued');

-- Disks: free space without a new version -----------------------------------------------------------
create function pg_temp.disk(p_size text, p_free text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('item_key', 'C:', 'attrs', jsonb_build_object('size', p_size, 'free_space', p_free), 'row_hash', md5('C:' || p_size)));
$$;
select pg_temp.ingest('20000000-0000-0000-0000-0000000000a1', pg_temp.q('windows', 'inv.disks'), '2026-10-05 13:00Z', pg_temp.disk('512', '100'));
select pg_temp.ingest('20000000-0000-0000-0000-0000000000a1', pg_temp.q('windows', 'inv.disks'), '2026-10-12 13:00Z', pg_temp.disk('512', '90'));
select results_eq(
  $$select count(*)::int, max(attrs ->> 'free_space') from public.hardware_versions where domain = 'disks'$$,
  $$values (1, '90')$$, 'free space refreshes the open row without a new version');
select pg_temp.ingest('20000000-0000-0000-0000-0000000000a1', pg_temp.q('windows', 'inv.disks'), '2026-10-19 13:00Z', pg_temp.disk('1024', '600'));
select results_eq(
  $$select count(*)::int, count(*) filter (where valid_to is null)::int from public.hardware_versions where domain = 'disks'$$,
  $$values (2, 1)$$, 'a resized disk gets a new version and the old one is closed');

-- title_summary ------------------------------------------------------------------------------------
select ok(public.refresh_title_summary_if_due() and not public.refresh_title_summary_if_due(),
  'title_summary refreshes once, then waits 5 minutes');

select * from finish();
rollback;
