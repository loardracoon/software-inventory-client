-- Phase 5: snapshots and versioning. The collector normalizes each raw result (TypeScript) and calls
-- ingest_snapshot once, which creates the snapshot, applies it (SCD type 2) and marks the raw result
-- ingested, all in one transaction. Nothing is deleted: rows are closed with valid_to.
--
-- Diff scope = (computer, query_name): on Linux, inv.programs.deb and inv.programs.rpm never
-- remove each other's rows. The first snapshot of a scope, and any snapshot with a new query
-- version, is a baseline without change events.

alter table public.installations add column query_name text not null;
create index installations_scope_open_idx on public.installations (computer_id, query_name) where valid_to is null;

alter table public.snapshots
  add column query_name text not null,
  add column raw_result_id uuid unique references public.raw_results (id) on delete set null,
  add column outcome text check (outcome in ('baseline', 'unchanged', 'diff', 'out_of_order'));
create index snapshots_scope_idx on public.snapshots (computer_id, query_name, collected_at desc) where applied_at is not null;
create index snapshots_applied_at_idx on public.snapshots (applied_at desc);

alter table public.raw_results add column ingest_error text;
create index raw_results_ingest_queue_idx on public.raw_results (received_at) where ingested_at is null and ingest_error is null;

-- Small key/value state for maintenance jobs (e.g. the last title_summary refresh).
create table public.maintenance_state (
  key text primary key,
  at timestamptz not null
);
alter table public.maintenance_state enable row level security;
revoke all on table public.maintenance_state from anon, authenticated;

-- Applies one snapshot. p_items is the normalized, hashed payload from the collector:
--   software: [{ title: { kind, source, match_key, canonical_name, vendor, external_id, description },
--               scope_key, username, version, path, attrs, row_hash }]
--   hardware: [{ item_key, attrs, row_hash }]
-- Idempotent: an applied snapshot returns its outcome without changes.
create or replace function public.apply_snapshot(p_snapshot_id uuid, p_items jsonb)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.snapshots;
  prev public.snapshots;
  v_outcome text;
  v_hardware boolean;
begin
  select * into s from public.snapshots where id = p_snapshot_id for update;
  if s.id is null then
    raise exception 'Unknown snapshot %', p_snapshot_id using errcode = 'P0002';
  end if;
  if s.applied_at is not null then
    return s.outcome;
  end if;
  perform pg_advisory_xact_lock(hashtext('apply_snapshot:' || s.computer_id::text || ':' || s.query_name));

  select * into prev from public.snapshots
  where computer_id = s.computer_id and query_name = s.query_name and applied_at is not null and id <> s.id
  order by collected_at desc
  limit 1;

  v_hardware := s.domain in ('hardware', 'disks');

  if prev.id is not null and prev.collected_at > s.collected_at then
    v_outcome := 'out_of_order';
  elsif v_hardware then
    v_outcome := public.apply_hardware_snapshot(s, prev, p_items);
  else
    v_outcome := public.apply_software_snapshot(s, prev, p_items);
  end if;

  update public.snapshots set applied_at = now(), outcome = v_outcome, is_baseline = (v_outcome = 'baseline') where id = s.id;
  return v_outcome;
end;
$$;

create or replace function public.apply_software_snapshot(s public.snapshots, prev public.snapshots, p_items jsonb)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  drop table if exists pg_temp.snap_items;
  create temporary table snap_items on commit drop as
  select
    (x.title ->> 'kind')::public.title_kind as kind,
    x.title ->> 'source' as source,
    x.title ->> 'match_key' as match_key,
    x.title ->> 'canonical_name' as canonical_name,
    x.title ->> 'vendor' as vendor,
    x.title ->> 'external_id' as external_id,
    x.title ->> 'description' as description,
    coalesce(x.scope_key, '') as scope_key,
    x.username, x.version, x.path, coalesce(x.attrs, '{}'::jsonb) as attrs, x.row_hash,
    null::uuid as title_id
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
    as x (title jsonb, scope_key text, username text, version text, path text, attrs jsonb, row_hash text);

  -- Titles: the first name seen stays canonical; vendor and external ID fill in when missing.
  insert into public.software_titles as t (kind, source, match_key, canonical_name, vendor, external_id)
  select distinct on (kind, source, match_key) kind, source, match_key, canonical_name, vendor, external_id
  from snap_items
  order by kind, source, match_key
  on conflict (kind, source, match_key) do update
    set vendor = coalesce(t.vendor, excluded.vendor), external_id = coalesce(t.external_id, excluded.external_id)
    where t.vendor is null or t.external_id is null;

  update snap_items i set title_id = t.id
  from public.software_titles t
  where t.kind = i.kind and t.source = i.source and t.match_key = i.match_key;

  -- Unknown titles wait for the Hub (metadata only; sending honours the sharing switch, Phase 7).
  insert into public.hub_submissions (kind, source, match_key, name, vendor, description)
  select distinct on (i.kind, i.source, i.match_key) i.kind, i.source, i.match_key, i.canonical_name, i.vendor, left(i.description, 1000)
  from snap_items i
  where not exists (
    select 1 from public.dictionary_cache d
    where d.kind = i.kind and d.source = i.source and d.match_key = i.match_key and d.status = 'published'
  )
  order by i.kind, i.source, i.match_key
  on conflict (kind, source, match_key) do nothing;

  -- Baseline: first snapshot of the scope or a new query version. Close and reopen, no events.
  if prev.id is null or prev.query_version <> s.query_version then
    update public.installations set valid_to = s.collected_at
    where computer_id = s.computer_id and query_name = s.query_name and valid_to is null;

    insert into public.installations (tenant_id, computer_id, title_id, domain, query_name, scope_key, username, version, path, attrs,
                                      row_hash, valid_from, first_seen_snapshot, last_seen_snapshot)
    select s.tenant_id, s.computer_id, i.title_id, s.domain, s.query_name, i.scope_key, i.username, i.version, i.path, i.attrs,
           i.row_hash, s.collected_at, s.id, s.id
    from snap_items i;
    return 'baseline';
  end if;

  if prev.content_hash = s.content_hash then
    update public.installations set last_seen_snapshot = s.id
    where computer_id = s.computer_id and query_name = s.query_name and valid_to is null;
    return 'unchanged';
  end if;

  drop table if exists pg_temp.snap_open;
  create temporary table snap_open on commit drop as
  select id, title_id, scope_key, row_hash, version
  from public.installations
  where computer_id = s.computer_id and query_name = s.query_name and valid_to is null;

  -- Removed: open rows whose key is gone.
  with gone as (
    update public.installations i set valid_to = s.collected_at
    from snap_open o
    where i.id = o.id
      and not exists (select 1 from snap_items n where n.title_id = o.title_id and n.scope_key = o.scope_key)
    returning i.id, i.title_id, i.version
  )
  insert into public.change_events (tenant_id, computer_id, title_id, installation_id, domain, change, from_version, to_version, snapshot_id, detected_at)
  select s.tenant_id, s.computer_id, g.title_id, g.id, s.domain, 'removed', g.version, null, s.id, s.collected_at from gone g;

  -- Updated: same key, different hash. Close the old row, open the new one.
  drop table if exists pg_temp.snap_changed;
  create temporary table snap_changed on commit drop as
  select o.id as old_id, o.version as old_version, n.*
  from snap_open o join snap_items n on n.title_id = o.title_id and n.scope_key = o.scope_key
  where o.row_hash is distinct from n.row_hash;

  update public.installations i set valid_to = s.collected_at from snap_changed c where i.id = c.old_id;

  with opened as (
    insert into public.installations (tenant_id, computer_id, title_id, domain, query_name, scope_key, username, version, path, attrs,
                                      row_hash, valid_from, first_seen_snapshot, last_seen_snapshot)
    select s.tenant_id, s.computer_id, c.title_id, s.domain, s.query_name, c.scope_key, c.username, c.version, c.path, c.attrs,
           c.row_hash, s.collected_at, s.id, s.id
    from snap_changed c
    returning id, title_id, scope_key, version
  )
  insert into public.change_events (tenant_id, computer_id, title_id, installation_id, domain, change, from_version, to_version, snapshot_id, detected_at)
  select s.tenant_id, s.computer_id, o.title_id, o.id, s.domain, 'updated', c.old_version, o.version, s.id, s.collected_at
  from opened o join snap_changed c on c.title_id = o.title_id and c.scope_key = o.scope_key;

  -- Added: keys that were not open.
  with opened as (
    insert into public.installations (tenant_id, computer_id, title_id, domain, query_name, scope_key, username, version, path, attrs,
                                      row_hash, valid_from, first_seen_snapshot, last_seen_snapshot)
    select s.tenant_id, s.computer_id, n.title_id, s.domain, s.query_name, n.scope_key, n.username, n.version, n.path, n.attrs,
           n.row_hash, s.collected_at, s.id, s.id
    from snap_items n
    where not exists (select 1 from snap_open o where o.title_id = n.title_id and o.scope_key = n.scope_key)
    returning id, title_id, version
  )
  insert into public.change_events (tenant_id, computer_id, title_id, installation_id, domain, change, from_version, to_version, snapshot_id, detected_at)
  select s.tenant_id, s.computer_id, o.title_id, o.id, s.domain, 'added', null, o.version, s.id, s.collected_at from opened o;

  -- Same: still there.
  update public.installations i set last_seen_snapshot = s.id
  from snap_open o join snap_items n on n.title_id = o.title_id and n.scope_key = o.scope_key and n.row_hash = o.row_hash
  where i.id = o.id;

  return 'diff';
end;
$$;

-- Hardware and disks: the same versioning in hardware_versions, without change events. Untracked
-- attributes (disk free space) are refreshed on the open row.
create or replace function public.apply_hardware_snapshot(s public.snapshots, prev public.snapshots, p_items jsonb)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  drop table if exists pg_temp.snap_hw;
  create temporary table snap_hw on commit drop as
  select coalesce(x.item_key, '') as item_key, coalesce(x.attrs, '{}'::jsonb) as attrs, x.row_hash
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as x (item_key text, attrs jsonb, row_hash text);

  if prev.id is null or prev.query_version <> s.query_version then
    update public.hardware_versions set valid_to = s.collected_at
    where computer_id = s.computer_id and domain = s.domain and valid_to is null;
    insert into public.hardware_versions (tenant_id, computer_id, domain, item_key, attrs, row_hash, snapshot_id, valid_from)
    select s.tenant_id, s.computer_id, s.domain, h.item_key, h.attrs, h.row_hash, s.id, s.collected_at from snap_hw h;
    return 'baseline';
  end if;

  -- Gone or changed: close.
  update public.hardware_versions v set valid_to = s.collected_at
  where v.computer_id = s.computer_id and v.domain = s.domain and v.valid_to is null
    and not exists (select 1 from snap_hw h where h.item_key = v.item_key and h.row_hash = v.row_hash);

  -- Same: refresh untracked attributes.
  update public.hardware_versions v set attrs = h.attrs
  from snap_hw h
  where v.computer_id = s.computer_id and v.domain = s.domain and v.valid_to is null
    and h.item_key = v.item_key and h.row_hash = v.row_hash;

  -- New or changed: open.
  insert into public.hardware_versions (tenant_id, computer_id, domain, item_key, attrs, row_hash, snapshot_id, valid_from)
  select s.tenant_id, s.computer_id, s.domain, h.item_key, h.attrs, h.row_hash, s.id, s.collected_at
  from snap_hw h
  where not exists (
    select 1 from public.hardware_versions v
    where v.computer_id = s.computer_id and v.domain = s.domain and v.valid_to is null and v.item_key = h.item_key
  );

  return case when prev.content_hash = s.content_hash then 'unchanged' else 'diff' end;
end;
$$;

-- Creates the snapshot of one raw result, applies it and marks the raw result ingested.
create or replace function public.ingest_snapshot(p_raw_result_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.raw_results;
  q public.query_catalog;
  v_snapshot uuid;
  v_outcome text;
begin
  select * into r from public.raw_results where id = p_raw_result_id for update;
  if r.id is null then
    raise exception 'Unknown raw result %', p_raw_result_id using errcode = 'P0002';
  end if;
  if r.ingested_at is not null then
    return jsonb_build_object('skipped', true);
  end if;
  select * into q from public.query_catalog where id = r.query_id;
  if q.id is null then
    raise exception 'Raw result % has no query', p_raw_result_id using errcode = '22023';
  end if;

  insert into public.snapshots (tenant_id, computer_id, domain, scan_task_id, query_name, query_version, collected_at, row_count,
                                content_hash, raw_result_id)
  values (r.tenant_id, r.computer_id, q.domain, r.scan_task_id, q.name, q.version, r.received_at,
          jsonb_array_length(coalesce(p_payload -> 'items', '[]'::jsonb)), p_payload ->> 'content_hash', r.id)
  returning id into v_snapshot;

  v_outcome := public.apply_snapshot(v_snapshot, p_payload -> 'items');
  update public.raw_results set ingested_at = now(), ingest_error = null where id = r.id;
  return jsonb_build_object('snapshot_id', v_snapshot, 'outcome', v_outcome);
end;
$$;

create or replace function public.mark_ingest_error(p_raw_result_id uuid, p_error text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.raw_results set ingest_error = left(p_error, 1000) where id = p_raw_result_id and ingested_at is null;
$$;

-- Refreshes title_summary when something was applied since the last refresh, at most every 5 minutes.
create or replace function public.refresh_title_summary_if_due()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_last_refresh timestamptz;
  v_last_apply timestamptz;
begin
  select at into v_last_refresh from public.maintenance_state where key = 'title_summary_refreshed';
  select max(applied_at) into v_last_apply from public.snapshots;
  if v_last_apply is null
     or (v_last_refresh is not null and (v_last_apply <= v_last_refresh or now() - v_last_refresh < interval '5 minutes')) then
    return false;
  end if;
  refresh materialized view concurrently public.title_summary;
  insert into public.maintenance_state (key, at) values ('title_summary_refreshed', now())
  on conflict (key) do update set at = excluded.at;
  return true;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'apply_snapshot(uuid, jsonb)', 'apply_software_snapshot(public.snapshots, public.snapshots, jsonb)',
    'apply_hardware_snapshot(public.snapshots, public.snapshots, jsonb)', 'ingest_snapshot(uuid, jsonb)',
    'mark_ingest_error(uuid, text)', 'refresh_title_summary_if_due()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;
