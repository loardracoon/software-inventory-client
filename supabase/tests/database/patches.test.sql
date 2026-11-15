-- Stage 3: Windows patch state from the Data Lake (patchstate) as an inventory domain.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select set_config('app.audit_purge', 'on', true);
truncate public.tenants, public.software_titles, public.sophos_connection, public.audit_log,
  public.dictionary_cache, public.hub_submissions cascade;
delete from public.profiles;
delete from vault.secrets where name = 'sophos_client_secret';
delete from public.maintenance_state;

select plan(17);

insert into public.tenants (id, sophos_tenant_id, name, id_type) values
  ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'tenant');
insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform, retired_at, data_lake_checked_at) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'ep-w1', 'W1', 'windows', null, null),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'ep-w2', 'W2', 'windows', null, null),
  ('20000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', 'ep-w3', 'W3', 'windows', now(), null),
  ('20000000-0000-0000-0000-0000000000a4', '10000000-0000-0000-0000-00000000000a', 'ep-w4', 'W4', 'windows', null, now() - interval '2 hours'),
  ('20000000-0000-0000-0000-0000000000a5', '10000000-0000-0000-0000-00000000000a', 'ep-m1', 'M1', 'macos', null, null);

create function pg_temp.q(p_platform text, p_name text, p_version int default 1) returns uuid language sql as $$
  select id from public.query_catalog where platform::text = p_platform and name = p_name and version = p_version;
$$;
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
-- A patch item as normalize() sends it.
create function pg_temp.patch(p_uid text, p_kb text, p_at text) returns jsonb language sql as $$
  select jsonb_build_object('item_key', p_uid, 'attrs', jsonb_build_object('kb', p_kb, 'title', 'Update ' || p_kb, 'installed_at', p_at, 'installed_by', null),
    'row_hash', md5(p_uid || p_kb || p_at));
$$;
create function pg_temp.store(p_urn text, p_computer uuid, p_at timestamptz) returns integer language sql as $$
  select public.store_data_lake_results('10000000-0000-0000-0000-00000000000a', p_urn, array[p_computer],
    jsonb_build_array(jsonb_build_object('computer_id', p_computer, 'domain', 'patches', 'collected_at', p_at, 'rows', '[]'::jsonb)));
$$;
create function pg_temp.ingest(p_urn text, p_computer uuid, p_items jsonb) returns text language sql as $$
  select public.ingest_snapshot(
    (select r.id from public.raw_results r join public.query_runs u on u.id = r.run_id where u.sophos_run_id = p_urn || ':patches' and r.computer_id = p_computer),
    pg_temp.payload(p_items)) ->> 'outcome';
$$;

-- W2 has a LES programs snapshot (programs are covered; patches never are).
insert into public.query_runs (id, tenant_id, provider, domain, platform, query_version, status)
values ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'live_endpoint_search', 'programs', 'windows', 2, 'finished');
insert into public.raw_results (id, tenant_id, run_id, computer_id, rows, row_count, query_id, received_at)
values ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-0000000000a2', '[]', 0, pg_temp.q('windows', 'inv.programs', 2), '2026-11-10 10:00Z');
select public.ingest_snapshot('60000000-0000-0000-0000-000000000001', pg_temp.payload(jsonb_build_array(pg_temp.pkg('App A', '1'))));

-- Schema and catalog ------------------------------------------------------------------------------
select ok('patches' = any (enum_range(null::public.inventory_domain)::text[]), 'inventory_domain has patches');
select results_eq($$select name, version, enabled from public.query_catalog where name = 'dl.patches'$$, $$values ('dl.patches', 1, false)$$,
  'dl.patches exists, disabled');
select is((select count(*)::int from public.current_queries() where name = 'dl.patches'), 0, 'the patch query is never scheduled');
select results_eq($$select data_lake_patches, patch_stale_days from public.scan_settings where tenant_id = '10000000-0000-0000-0000-00000000000a'$$,
  $$values (false, 60)$$, 'settings: off by default, stale after 60 days');
select throws_ok($$update public.scan_settings set patch_stale_days = 0$$, '23514', null, 'settings: stale days are 1 to 365');

-- Targets -------------------------------------------------------------------------------------------
select is((select count(*)::int from public.data_lake_targets('10000000-0000-0000-0000-00000000000a')), 0, 'targets: both settings off, none');
update public.scan_settings set data_lake_patches = true where tenant_id = '10000000-0000-0000-0000-00000000000a';
select results_eq($$select hostname, domains::text[] from public.data_lake_targets('10000000-0000-0000-0000-00000000000a') t join public.computers c on c.id = t.computer_id order by 1$$,
  $$values ('W1', array['patches']), ('W2', array['patches'])$$, 'targets: patches on alone selects the live, unchecked Windows computers');
update public.scan_settings set data_lake_inventory = true where tenant_id = '10000000-0000-0000-0000-00000000000a';
select results_eq($$select hostname, domains::text[] from public.data_lake_targets('10000000-0000-0000-0000-00000000000a') t join public.computers c on c.id = t.computer_id order by 1$$,
  $$values ('W1', array['programs', 'extensions', 'patches']), ('W2', array['extensions', 'patches'])$$,
  'targets: a computer collected by LES still gets patches');
update public.scan_settings set data_lake_patches = false where tenant_id = '10000000-0000-0000-0000-00000000000a';
select results_eq($$select hostname, domains::text[] from public.data_lake_targets('10000000-0000-0000-0000-00000000000a') t join public.computers c on c.id = t.computer_id order by 1$$,
  $$values ('W1', array['programs', 'extensions']), ('W2', array['extensions'])$$, 'targets: patches off leaves the inventory domains');
update public.scan_settings set data_lake_patches = true where tenant_id = '10000000-0000-0000-0000-00000000000a';

-- Storage and the hardware path ---------------------------------------------------------------------------------
select is(pg_temp.store('urn:p1', '20000000-0000-0000-0000-0000000000a1', '2026-11-14 06:00Z'), 1, 'store: one raw result for the patches search');
select is(pg_temp.ingest('urn:p1', '20000000-0000-0000-0000-0000000000a1',
  jsonb_build_array(pg_temp.patch('u1', 'KB1', '2026-10-01'), pg_temp.patch('u2', 'KB2', '2026-10-15'))), 'baseline', 'ingest: first patch snapshot is a baseline');
select results_eq($$select item_key, attrs ->> 'kb' from public.hardware_versions where computer_id = '20000000-0000-0000-0000-0000000000a1' and domain = 'patches' and valid_to is null order by 1$$,
  $$values ('u1', 'KB1'), ('u2', 'KB2')$$, 'ingest: one open row per patch');
select is((select count(*)::int from public.installations where computer_id = '20000000-0000-0000-0000-0000000000a1'), 0, 'ingest: patches are not software installations');

select pg_temp.store('urn:p2', '20000000-0000-0000-0000-0000000000a1', '2026-11-15 06:00Z');
select is(pg_temp.ingest('urn:p2', '20000000-0000-0000-0000-0000000000a1', jsonb_build_array(pg_temp.patch('u1', 'KB1', '2026-10-01'), pg_temp.patch('u3', 'KB3', '2026-11-12'))),
  'diff', 'ingest: a second snapshot with a removed and a new patch is a diff');
select results_eq($$select item_key from public.hardware_versions where computer_id = '20000000-0000-0000-0000-0000000000a1' and domain = 'patches' and valid_to is null order by 1$$,
  $$values ('u1'), ('u3')$$, 'ingest: the removed KB is closed and the new one opens');
select is((select valid_to from public.hardware_versions where item_key = 'u2' and domain = 'patches'), '2026-11-15 06:00Z'::timestamptz, 'ingest: the closed patch ends at the snapshot time');

-- W2 has a LES programs snapshot: its patch snapshot is a normal baseline, not superseded.
select pg_temp.store('urn:p3', '20000000-0000-0000-0000-0000000000a2', '2026-11-15 06:00Z');
select is(pg_temp.ingest('urn:p3', '20000000-0000-0000-0000-0000000000a2', jsonb_build_array(pg_temp.patch('u1', 'KB1', '2026-10-01'))), 'baseline',
  'source rule: a LES-collected computer still stores its patches');

select * from finish();
rollback;
