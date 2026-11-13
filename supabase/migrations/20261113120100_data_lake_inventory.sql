-- Data Lake gap fill: Windows computers that Live Endpoint Search (LES) never collected get programs and
-- browser extensions from the daily Sophos Data Lake softwareinfo snapshot. One source per computer and
-- domain: a Data Lake snapshot is superseded while a LES snapshot of that domain exists, and the first LES
-- snapshot closes the open Data Lake rows. The Deno collector runs the search; this file stores the results
-- (raw_results, ingested by the normal ingest_snapshot path).

alter table public.scan_settings
  add column data_lake_inventory boolean not null default false,
  add constraint scan_settings_provider_not_data_lake check (provider <> 'data_lake');
alter table public.tenants add column data_lake_attempt_at timestamptz;
alter table public.computers add column data_lake_checked_at timestamptz;
comment on column public.tenants.data_lake_attempt_at is 'Last Data Lake search attempt; the collector retries a failed search one hour later.';
comment on column public.computers.data_lake_checked_at is 'Last time a Data Lake search covered this computer, even when it found nothing.';

alter table public.snapshots drop constraint snapshots_outcome_check;
alter table public.snapshots add constraint snapshots_outcome_check
  check (outcome in ('baseline', 'unchanged', 'diff', 'out_of_order', 'superseded'));

-- Reference rows only: never enabled, so current_queries() skips them and no scan task is made. normalize()
-- keys dl.programs v2 like inv.programs v2 (productName()). The sql is the QL template the collector fills in.
insert into public.query_catalog (domain, platform, version, name, enabled, required_tables, sql) values
('programs', 'windows', 2, 'dl.programs', false, '{}', $q$from softwareinfo where normalizer = 'sophos-xdr-it-hygiene-ingestor' and host_id in ('<id1>', '<id2>') earliest='<earliest>' latest='<latest>' | fields host_id, time, product.name, product.version, product.vendor_name, product.uid, product.type_id, product.path, product.source, product.url_string, original_data$q$),
('extensions', 'windows', 1, 'dl.extensions', false, '{}', $q$from softwareinfo where normalizer = 'sophos-xdr-it-hygiene-ingestor' and host_id in ('<id1>', '<id2>') earliest='<earliest>' latest='<latest>' | fields host_id, time, product.name, product.version, product.vendor_name, product.uid, product.type_id, product.path, product.source, product.url_string, original_data$q$)
on conflict (platform, name, version) do nothing;

-- An applied snapshot of this computer and domain that did not come from the Data Lake.
create or replace function public.has_live_snapshot(p_computer_id uuid, p_domain public.inventory_domain)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.snapshots s
    where s.computer_id = p_computer_id and s.domain = p_domain and s.applied_at is not null and s.query_name not like 'dl.%'
  );
$$;

-- Computers the Data Lake should fill, with the domains LES does not cover.
create or replace function public.data_lake_targets(p_tenant_id uuid, p_limit integer default 50)
returns table (computer_id uuid, sophos_endpoint_id text, domains public.inventory_domain[])
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.sophos_endpoint_id, d.domains
  from public.computers c
  join public.scan_settings st on st.tenant_id = c.tenant_id and st.data_lake_inventory
  cross join lateral (
    select array_agg(u.x order by u.ord) as domains
    from unnest(array['programs', 'extensions']::public.inventory_domain[]) with ordinality as u (x, ord)
    where not public.has_live_snapshot(c.id, u.x)
  ) d
  where c.tenant_id = p_tenant_id and c.retired_at is null and c.platform = 'windows'
    and (c.data_lake_checked_at is null or c.data_lake_checked_at < now() - interval '20 hours')
    and d.domains is not null
  order by c.data_lake_checked_at nulls first, c.id
  limit p_limit;
$$;

-- p_results = [{ computer_id, domain, collected_at, rows }]. One finished run per search and domain; a run
-- that already exists (same search stored before) adds nothing. Only computers of p_tenant_id count.
create or replace function public.store_data_lake_results(p_tenant_id uuid, p_search_urn text, p_checked uuid[], p_results jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_stored integer := 0;
  v_n integer;
  v_domain public.inventory_domain;
  v_q public.query_catalog;
  v_run uuid;
begin
  if jsonb_typeof(p_results) <> 'array' then
    raise exception 'p_results must be a JSON array' using errcode = '22023';
  end if;

  drop table if exists pg_temp.dl_items;
  create temporary table dl_items on commit drop as
  select c.id as computer_id, c.sophos_endpoint_id, x.domain, x.collected_at, coalesce(x.rows, '[]'::jsonb) as rows
  from jsonb_to_recordset(p_results) as x (computer_id uuid, domain public.inventory_domain, collected_at timestamptz, rows jsonb)
  join public.computers c on c.id = x.computer_id and c.tenant_id = p_tenant_id
  where x.collected_at is not null;

  for v_domain in select distinct i.domain from dl_items i order by 1 loop
    v_run := null;
    select * into v_q from public.query_catalog
    where platform = 'windows' and name = 'dl.' || v_domain::text
    order by version desc limit 1;
    if v_q.id is null then
      continue;
    end if;

    insert into public.query_runs (tenant_id, sophos_run_id, provider, domain, platform, query_id, query_version, endpoint_ids, status, finished_at)
    select p_tenant_id, p_search_urn || ':' || v_domain::text, 'data_lake', v_domain, 'windows', v_q.id, v_q.version,
           array_agg(i.sophos_endpoint_id), 'finished', now()
    from dl_items i where i.domain = v_domain
    on conflict (provider, sophos_run_id) do nothing
    returning id into v_run;
    if v_run is null then
      continue;
    end if;

    insert into public.raw_results (tenant_id, run_id, computer_id, rows, row_count, query_id, received_at)
    select p_tenant_id, v_run, i.computer_id, i.rows, jsonb_array_length(i.rows), v_q.id, i.collected_at
    from dl_items i where i.domain = v_domain
    on conflict (run_id, computer_id) do nothing;
    get diagnostics v_n = row_count;
    v_stored := v_stored + v_n;
  end loop;

  update public.computers set data_lake_checked_at = now()
  where tenant_id = p_tenant_id and id = any (coalesce(p_checked, '{}'));
  return v_stored;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'has_live_snapshot(uuid, public.inventory_domain)', 'data_lake_targets(uuid, integer)',
    'store_data_lake_results(uuid, text, uuid[], jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;

-- apply_snapshot as in 20261027000000_snapshots_apply.sql, plus the source rule for dl.* snapshots. A
-- superseded snapshot is not the previous snapshot of its scope.
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
  -- A dl.* and a LES snapshot of one computer and domain have different query_name locks. This lock makes them
  -- apply one after the other, so each sees the other's applied_at and rows (no duplicate open installations).
  perform pg_advisory_xact_lock(hashtext('apply_snapshot_domain:' || s.computer_id::text || ':' || s.domain::text));

  select * into prev from public.snapshots
  where computer_id = s.computer_id and query_name = s.query_name and applied_at is not null and id <> s.id
    and outcome is distinct from 'superseded'
  order by collected_at desc
  limit 1;

  v_hardware := s.domain in ('hardware', 'disks');

  if s.query_name like 'dl.%' and public.has_live_snapshot(s.computer_id, s.domain) then
    v_outcome := 'superseded';
  elsif prev.id is not null and prev.collected_at > s.collected_at then
    v_outcome := 'out_of_order';
  elsif v_hardware then
    v_outcome := public.apply_hardware_snapshot(s, prev, p_items);
  else
    -- A LES snapshot ends the open Data Lake rows without change events. valid_to never precedes valid_from,
    -- so a LES snapshot older than the Data Lake rows leaves no inverted interval.
    if s.query_name not like 'dl.%' then
      update public.installations set valid_to = greatest(valid_from, s.collected_at)
      where computer_id = s.computer_id and domain = s.domain and query_name like 'dl.%' and valid_to is null;
    end if;
    v_outcome := public.apply_software_snapshot(s, prev, p_items);
  end if;

  update public.snapshots set applied_at = now(), outcome = v_outcome, is_baseline = (v_outcome = 'baseline') where id = s.id;
  return v_outcome;
end;
$$;

-- query_catalog_status as in 20261027030100_programs_query_v2.sql, without the Data Lake reference rows.
create or replace function public.query_catalog_status(p_tenant_id uuid default null)
returns table (
  query_id uuid,
  name text,
  version integer,
  domain public.inventory_domain,
  platform public.platform,
  enabled boolean,
  required_tables text[],
  tenants_ok integer,
  tenants_missing integer,
  tenants_not_probed integer,
  missing_tables text[],
  last_probed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with current_queries as (
    select q.* from public.query_catalog q
    where q.name not like 'dl.%' and q.version = (select max(q2.version) from public.query_catalog q2 where q2.platform = q.platform and q2.name = q.name)
  ),
  visible as (
    select r.tenant_id from public.my_tenant_roles() r where p_tenant_id is null or r.tenant_id = p_tenant_id
  ),
  per_tenant as (
    select
      q.id,
      v.tenant_id,
      pc.probed_at,
      case
        when pc.tenant_id is null then null
        else array(select t from unnest(q.required_tables) t where not (t = any (pc.osquery_tables)))
      end as missing
    from current_queries q
    join visible v on exists (
      select 1 from public.computers c
      where c.tenant_id = v.tenant_id and c.platform = q.platform and c.retired_at is null
    )
    left join public.platform_capabilities pc on pc.tenant_id = v.tenant_id and pc.platform = q.platform
  )
  select
    q.id,
    q.name,
    q.version,
    q.domain,
    q.platform,
    q.enabled,
    q.required_tables,
    (count(p.tenant_id) filter (where p.missing is not null and cardinality(p.missing) = 0))::integer,
    (count(p.tenant_id) filter (where cardinality(p.missing) > 0))::integer,
    (count(p.tenant_id) filter (where p.missing is null))::integer,
    coalesce(
      (select array_agg(distinct m order by m) from per_tenant p2, unnest(p2.missing) m where p2.id = q.id),
      '{}'
    ),
    max(p.probed_at)
  from current_queries q
  left join per_tenant p on p.id = q.id
  group by q.id, q.name, q.version, q.domain, q.platform, q.enabled, q.required_tables
  order by q.domain, q.platform, q.name, q.version;
$$;

-- v_computer_list as in 20261103120000_computer_online_status.sql, plus data_lake_snapshot_at at the end.
create or replace view public.v_computer_list
with (security_barrier = true)
as
select
  c.id, c.tenant_id, c.hostname, c.platform, c.os_name, c.os_version, c.os_build, c.endpoint_type, c.health,
  case when r.role = 'viewer' then null else c.associated_user end as associated_user,
  r.role = 'viewer' and c.associated_user is not null as user_masked,
  c.last_seen_at, c.last_collected_at, c.retired_at,
  st.cycle_status, st.next_attempt_at, st.last_error,
  coalesce(cnt.programs, 0) as programs,
  coalesce(cnt.extensions, 0) as extensions,
  coalesce(cnt.packages, 0) as packages,
  coalesce(att.items, '[]'::jsonb) as attention,
  coalesce(att.slugs, '{}') as attention_slugs,
  coalesce(att.level1_slugs, '{}') as attention_level1_slugs,
  coalesce(vv.summary, '{"critical": 0, "high": 0, "medium": 0, "low": 0, "kev": 0, "possible": 0, "top": []}'::jsonb) as vulns,
  c.online, c.online_checked_at,
  (select max(sn.collected_at) from public.snapshots sn
   where sn.computer_id = c.id and sn.applied_at is not null and sn.query_name like 'dl.%'
     and sn.outcome is distinct from 'superseded') as data_lake_snapshot_at
from public.computers c
join public.my_tenant_roles() r on r.tenant_id = c.tenant_id
left join lateral (
  select
    case
      when count(*) = 0 then 'not_scheduled'
      when bool_or(t.status = 'error') then 'error'
      when bool_or(t.status in ('retry_scheduled', 'no_response')) then 'retry_scheduled'
      when bool_or(t.status = 'dispatched') then 'dispatched'
      when bool_or(t.status = 'pending') then 'pending'
      when bool_or(t.status = 'missed') then 'missed'
      else 'collected'
    end as cycle_status,
    min(t.next_attempt_at) filter (where t.status = 'retry_scheduled') as next_attempt_at,
    max(t.last_error) filter (where t.status = 'error') as last_error
  from public.scan_tasks t
  join public.scan_cycles cy on cy.id = t.cycle_id and cy.status = 'open'
  where t.computer_id = c.id
) st on true
left join lateral (
  select
    count(*) filter (where i.domain = 'programs') as programs,
    count(*) filter (where i.domain in ('extensions', 'ide_extensions')) as extensions,
    count(*) filter (where i.domain = 'packages') as packages
  from public.installations i
  where i.computer_id = c.id and i.valid_to is null
) cnt on true
left join lateral (
  select
    jsonb_agg(jsonb_build_object('slug', g.category_slug, 'level1', g.level1_name, 'level2', g.level2_name, 'attention', g.attention_level,
      'titles', to_jsonb(g.titles)) order by g.attention_level desc, g.level2_name) as items,
    array_agg(g.category_slug) as slugs,
    array_agg(distinct split_part(g.category_slug, '/', 1)) as level1_slugs
  from (
    select tc.category_slug, tc.level1_name, tc.level2_name, tc.attention_level,
      (array_agg(distinct t.canonical_name))[1:10] as titles
    from public.installations i
    join public.title_classification tc on tc.title_id = i.title_id
    join public.software_titles t on t.id = i.title_id
    where i.computer_id = c.id and i.valid_to is null and tc.attention_level in ('review', 'not_allowed')
    group by tc.category_slug, tc.level1_name, tc.level2_name, tc.attention_level
  ) g
) att on true
left join lateral (
  select jsonb_build_object(
      'critical', count(*) filter (where not x.uncertain and x.severity = 'CRITICAL'),
      'high', count(*) filter (where not x.uncertain and x.severity = 'HIGH'),
      'medium', count(*) filter (where not x.uncertain and x.severity = 'MEDIUM'),
      'low', count(*) filter (where not x.uncertain and x.severity = 'LOW'),
      'kev', count(*) filter (where not x.uncertain and x.kev),
      'possible', count(*) filter (where x.uncertain),
      'top', coalesce(jsonb_agg(jsonb_build_object('id', x.vuln_id, 'severity', x.severity, 'score', x.cvss_score, 'kev', x.kev,
          'uncertain', x.uncertain, 'title', x.title) order by x.rn) filter (where x.rn <= 8), '[]')) as summary
  from (
    select y.*, row_number() over (order by y.uncertain, y.kev desc, y.cvss_score desc nulls last, y.vuln_id) as rn
    from (
      select v.vuln_id, vc.severity, vc.cvss_score, vc.kev_added is not null as kev, bool_and(v.uncertain) as uncertain,
        min(t.canonical_name) as title
      from public.installations i
      join public.title_version_vulns v on v.tenant_id = i.tenant_id and v.title_id = i.title_id and v.version = coalesce(i.version, '')
      join public.vuln_cache vc on vc.product_key = v.product_key and vc.vuln_id = v.vuln_id
      join public.software_titles t on t.id = i.title_id
      where i.computer_id = c.id and i.valid_to is null and (v.platforms is null or c.platform::text = any (v.platforms))
      group by v.vuln_id, vc.severity, vc.cvss_score, vc.kev_added
    ) y
  ) x
  having count(*) > 0
) vv on true;
