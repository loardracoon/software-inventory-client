-- Data Lake gap fill: source rule (one source per computer and domain), catalog rows, storage RPC.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
truncate public.tenants, public.software_titles, public.sophos_connection, public.audit_log,
  public.dictionary_cache, public.hub_submissions cascade;
delete from public.profiles;
delete from vault.secrets where name = 'sophos_client_secret';
delete from public.maintenance_state;

select plan(34);

-- Fixtures ----------------------------------------------------------------------------------------
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'admin@example.com');
insert into public.tenants (id, sophos_tenant_id, name, id_type) values
  ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'tenant');
insert into public.tenant_members (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'admin');
update public.scan_settings set data_lake_inventory = true where tenant_id = '10000000-0000-0000-0000-00000000000a';
insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform, retired_at, data_lake_checked_at) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'ep-w1', 'W1', 'windows', null, null),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'ep-w2', 'W2', 'windows', null, null),
  ('20000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', 'ep-w3', 'W3', 'windows', now(), null),
  ('20000000-0000-0000-0000-0000000000a4', '10000000-0000-0000-0000-00000000000a', 'ep-w4', 'W4', 'windows', null, now() - interval '2 hours'),
  ('20000000-0000-0000-0000-0000000000a5', '10000000-0000-0000-0000-00000000000a', 'ep-m1', 'M1', 'macos', null, null);

create function pg_temp.q(p_platform text, p_name text, p_version int default 1) returns uuid language sql as $$
  select id from public.query_catalog where platform::text = p_platform and name = p_name and version = p_version;
$$;
create function pg_temp.raw_les(p_computer uuid, p_query uuid, p_at timestamptz) returns uuid language plpgsql as $$
declare v_run uuid; v_id uuid;
begin
  insert into public.query_runs (tenant_id, provider, domain, platform, query_version, status)
  values ('10000000-0000-0000-0000-00000000000a', 'live_endpoint_search', 'programs', 'windows', 2, 'finished') returning id into v_run;
  insert into public.raw_results (tenant_id, run_id, computer_id, rows, row_count, query_id, received_at)
  values ('10000000-0000-0000-0000-00000000000a', v_run, p_computer, '[]', 0, p_query, p_at) returning id into v_id;
  return v_id;
end $$;
create function pg_temp.pkg(p_name text, p_version text) returns jsonb language sql as $$
  select jsonb_build_object(
    'title', jsonb_build_object('kind', 'program', 'source', 'registry', 'match_key', p_name || '|', 'canonical_name', p_name,
                                'vendor', null, 'external_id', null, 'description', null),
    'scope_key', '', 'username', null, 'version', p_version, 'path', null, 'attrs', '{}'::jsonb,
    'row_hash', md5(p_name || p_version));
$$;
create function pg_temp.payload(p_items jsonb) returns jsonb language sql as $$
  select jsonb_build_object('items', p_items, 'content_hash', md5(p_items::text));
$$;
-- Programs result of one computer as the collector sends it to store_data_lake_results.
create function pg_temp.dl_item(p_computer uuid, p_at timestamptz) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('computer_id', p_computer, 'domain', 'programs', 'collected_at', p_at,
    'rows', jsonb_build_array(jsonb_build_object('name', 'App A'), jsonb_build_object('name', 'App B'))));
$$;
create function pg_temp.dl_raw(p_urn text, p_computer uuid) returns uuid language sql as $$
  select r.id from public.raw_results r join public.query_runs u on u.id = r.run_id
  where u.sophos_run_id = p_urn || ':programs' and r.computer_id = p_computer;
$$;
create function pg_temp.dl_ingest(p_urn text, p_computer uuid, p_items jsonb) returns text language sql as $$
  select public.ingest_snapshot(pg_temp.dl_raw(p_urn, p_computer), pg_temp.payload(p_items)) ->> 'outcome';
$$;

-- W2 has a LES programs snapshot.
select public.ingest_snapshot(pg_temp.raw_les('20000000-0000-0000-0000-0000000000a2', pg_temp.q('windows', 'inv.programs', 2), '2026-11-10 10:00Z'),
  pg_temp.payload(jsonb_build_array(pg_temp.pkg('App A', '1'))));

-- Schema and catalog --------------------------------------------------------------------------------
select ok('data_lake' = any (enum_range(null::public.query_provider)::text[]), 'query_provider has data_lake');
select results_eq(
  $$select name, version, enabled from public.query_catalog where name like 'dl.%' and platform = 'windows' order by name$$,
  $$values ('dl.extensions', 1, false), ('dl.programs', 2, false)$$, 'dl.programs v2 and dl.extensions v1 exist, disabled');
select is((select count(*)::int from public.current_queries() where name like 'dl.%'), 0, 'Data Lake queries are never scheduled');
select throws_ok($$update public.scan_settings set provider = 'data_lake'$$, '23514', null, 'data_lake is not a Live Endpoint Search provider');

-- Targets -------------------------------------------------------------------------------------------
select results_eq(
  $$select c.hostname, t.domains::text[] from public.data_lake_targets('10000000-0000-0000-0000-00000000000a') t
    join public.computers c on c.id = t.computer_id order by c.hostname$$,
  $$values ('W1', '{programs,extensions}'::text[]), ('W2', '{extensions}'::text[])$$, 'targets: W1 both domains, W2 extensions only');
update public.scan_settings set data_lake_inventory = false;
select is((select count(*)::int from public.data_lake_targets('10000000-0000-0000-0000-00000000000a')), 0, 'setting off: no targets');
update public.scan_settings set data_lake_inventory = true;

-- Store ---------------------------------------------------------------------------------------------
select is(public.store_data_lake_results('10000000-0000-0000-0000-00000000000a', 'urn:s1', array['20000000-0000-0000-0000-0000000000a1']::uuid[],
  pg_temp.dl_item('20000000-0000-0000-0000-0000000000a1', '2026-11-13 07:17+00')), 1, 'store inserts one raw result');
select is(public.store_data_lake_results('10000000-0000-0000-0000-00000000000a', 'urn:s1', array['20000000-0000-0000-0000-0000000000a1']::uuid[],
  pg_temp.dl_item('20000000-0000-0000-0000-0000000000a1', '2026-11-13 07:17+00')), 0, 'the same search stores nothing twice');
select is((select count(*)::int from public.query_runs where provider = 'data_lake'), 1, 'one run per search and domain');
select is((select received_at from public.raw_results where id = pg_temp.dl_raw('urn:s1', '20000000-0000-0000-0000-0000000000a1')),
  '2026-11-13 07:17+00'::timestamptz, 'received_at is the Data Lake collection time');
select is((select data_lake_checked_at is not null from public.computers where hostname = 'W1'), true, 'checked computers are stamped');
select is((select data_lake_checked_at is null from public.computers where hostname = 'M1'), true, 'unchecked computers are not stamped');
-- A computer the collector could not search (endpoint id not a UUID, one host over the row limit): no search URN.
select is(public.store_data_lake_results('10000000-0000-0000-0000-00000000000a', null, array['20000000-0000-0000-0000-0000000000a5']::uuid[], '[]'),
  0, 'a store without a search stores nothing');
select is((select data_lake_checked_at is not null from public.computers where hostname = 'M1'), true, 'a store without a search stamps p_checked');

-- Ingest --------------------------------------------------------------------------------------------
select is(pg_temp.dl_ingest('urn:s1', '20000000-0000-0000-0000-0000000000a1',
  jsonb_build_array(pg_temp.pkg('App A', '1'), pg_temp.pkg('App B', '1'))), 'baseline', 'the first Data Lake snapshot is a baseline');
select public.store_data_lake_results('10000000-0000-0000-0000-00000000000a', 'urn:s2', array['20000000-0000-0000-0000-0000000000a1']::uuid[],
  pg_temp.dl_item('20000000-0000-0000-0000-0000000000a1', '2026-11-14 07:17+00'));
select is(pg_temp.dl_ingest('urn:s2', '20000000-0000-0000-0000-0000000000a1',
  jsonb_build_array(pg_temp.pkg('App A', '2'), pg_temp.pkg('App B', '1'))), 'diff', 'the next Data Lake snapshot is diffed');
select results_eq($$select change::text, from_version, to_version from public.change_events$$,
  $$values ('updated', '1', '2')$$, 'one updated event');

-- A host that reported with no rows in a domain: the empty snapshot closes the open rows of that domain.
select public.store_data_lake_results('10000000-0000-0000-0000-00000000000a', 'urn:e1', array['20000000-0000-0000-0000-0000000000a4']::uuid[],
  pg_temp.dl_item('20000000-0000-0000-0000-0000000000a4', '2026-11-13 07:00+00'));
select pg_temp.dl_ingest('urn:e1', '20000000-0000-0000-0000-0000000000a4', jsonb_build_array(pg_temp.pkg('App A', '1')));
select public.store_data_lake_results('10000000-0000-0000-0000-00000000000a', 'urn:e2', array['20000000-0000-0000-0000-0000000000a4']::uuid[],
  jsonb_build_array(jsonb_build_object('computer_id', '20000000-0000-0000-0000-0000000000a4', 'domain', 'programs',
    'collected_at', '2026-11-14 07:00+00', 'rows', '[]'::jsonb)));
select is((select row_count from public.raw_results where id = pg_temp.dl_raw('urn:e2', '20000000-0000-0000-0000-0000000000a4')), 0,
  'an item with no rows is stored with row_count 0');
select is(pg_temp.dl_ingest('urn:e2', '20000000-0000-0000-0000-0000000000a4', '[]'), 'diff', 'an empty Data Lake snapshot is diffed');
select is((select count(*)::int from public.installations where computer_id = '20000000-0000-0000-0000-0000000000a4' and valid_to is null), 0,
  'the empty snapshot closes the open rows');

-- Superseded ----------------------------------------------------------------------------------------
select public.store_data_lake_results('10000000-0000-0000-0000-00000000000a', 'urn:s3', array['20000000-0000-0000-0000-0000000000a2']::uuid[],
  pg_temp.dl_item('20000000-0000-0000-0000-0000000000a2', '2026-11-14 07:20+00'));
select is(pg_temp.dl_ingest('urn:s3', '20000000-0000-0000-0000-0000000000a2', jsonb_build_array(pg_temp.pkg('App A', '9'))),
  'superseded', 'a Data Lake snapshot is superseded by a LES snapshot');
select is((select count(*)::int from public.installations where computer_id = '20000000-0000-0000-0000-0000000000a2' and query_name = 'dl.programs'),
  0, 'a superseded snapshot applies nothing');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select is((select data_lake_snapshot_at from public.v_computer_list where hostname = 'W1'), '2026-11-14 07:17+00'::timestamptz,
  'v_computer_list shows the last Data Lake snapshot while Data Lake rows are open');
reset role;

-- Handover: a LES snapshot older than the Data Lake rows takes over --------------------------------
create temp table ev_before as select count(*)::int n from public.change_events;
select lives_ok($$select public.ingest_snapshot(pg_temp.raw_les('20000000-0000-0000-0000-0000000000a1', pg_temp.q('windows', 'inv.programs', 2), '2026-11-14 06:00Z'),
  pg_temp.payload(jsonb_build_array(pg_temp.pkg('App A', '2'))))$$, 'an older LES snapshot is ingested after Data Lake rows');
select is((select count(*)::int from public.installations where computer_id = '20000000-0000-0000-0000-0000000000a1'
  and query_name = 'dl.programs' and valid_to is null), 0, 'Data Lake rows are closed');
select is((select count(*)::int from public.installations where computer_id = '20000000-0000-0000-0000-0000000000a1'
  and query_name = 'dl.programs' and valid_to = valid_from and valid_from = '2026-11-14 07:17Z'), 1,
  'a row newer than the LES snapshot closes at its own valid_from');
select is((select count(*)::int from public.installations where valid_to < valid_from), 0, 'no interval is inverted');
select is((select count(*)::int from public.installations i join public.software_titles t on t.id = i.title_id
  where i.computer_id = '20000000-0000-0000-0000-0000000000a1' and t.match_key = 'App A|' and i.valid_to is null), 1,
  'one open installation of the title');
select is((select count(*)::int from public.change_events), (select n from ev_before), 'the handover creates no change event');

-- Browser access ------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select is((select data_lake_snapshot_at from public.v_computer_list where hostname = 'W1'), null::timestamptz,
  'v_computer_list shows no Data Lake snapshot after Live Endpoint Search took over');
select is((select count(*)::int from public.query_catalog_status('10000000-0000-0000-0000-00000000000a') where name like 'dl.%'), 0,
  'Settings > Queries does not list Data Lake queries');
select ok((select count(*) from public.query_catalog_status('10000000-0000-0000-0000-00000000000a') where name = 'inv.programs') > 0,
  'it still lists the Live Endpoint Search queries');
select throws_ok($$select public.data_lake_targets('10000000-0000-0000-0000-00000000000a')$$, '42501', null, 'browser users cannot list targets');
select throws_ok($$select public.store_data_lake_results('10000000-0000-0000-0000-00000000000a', 'urn:x', '{}', '[]')$$, '42501', null,
  'browser users cannot store results');
reset role;

select * from finish();
rollback;
