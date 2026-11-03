-- Online status of each computer as Sophos Central reports it (GET /endpoint/v1/endpoints: online,
-- lastSeenAt), for the Status column of the Computers page. The full computer sync writes it, and the
-- collector refreshes it between syncs (apply_computer_status, every 15 minutes) without adding or
-- retiring computers. This is Central's view; the collector still asks Live Endpoint Search before a run.

alter table public.computers
  add column online boolean,
  add column online_checked_at timestamptz;
comment on column public.computers.online is 'Sophos Central "online" at online_checked_at; null when Central did not say.';

alter table public.tenants add column status_checked_at timestamptz;
comment on column public.tenants.status_checked_at is 'Last time the online status of this tenant''s computers was read from Sophos Central.';

create or replace function public.apply_computer_sync(p_tenant_id uuid, p_endpoints jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_seen integer;
  v_new integer;
  v_reactivated integer;
  v_missing integer;
  v_retired integer;
begin
  if jsonb_typeof(p_endpoints) <> 'array' then
    raise exception 'p_endpoints must be a JSON array' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('apply_computer_sync:' || p_tenant_id::text));

  drop table if exists pg_temp.incoming;
  create temporary table incoming on commit drop as
  select *
  from jsonb_to_recordset(p_endpoints) as x (
    sophos_endpoint_id text,
    hostname text,
    platform public.platform,
    endpoint_type text,
    os_name text,
    os_version text,
    os_build text,
    associated_user text,
    health text,
    last_seen_at timestamptz,
    online boolean
  );

  select count(*) into v_seen from incoming;

  select count(*) into v_reactivated
  from public.computers c
  join incoming i on i.sophos_endpoint_id = c.sophos_endpoint_id
  where c.tenant_id = p_tenant_id and c.retired_at is not null;

  with upserted as (
    insert into public.computers as c (
      tenant_id, sophos_endpoint_id, hostname, platform, endpoint_type, os_name, os_version, os_build,
      associated_user, health, last_seen_at, online, online_checked_at
    )
    select
      p_tenant_id, i.sophos_endpoint_id, i.hostname, i.platform, i.endpoint_type, i.os_name, i.os_version,
      i.os_build, i.associated_user, i.health, i.last_seen_at, i.online, now()
    from incoming i
    on conflict (sophos_endpoint_id) do update set
      hostname = excluded.hostname,
      platform = excluded.platform,
      endpoint_type = excluded.endpoint_type,
      os_name = excluded.os_name,
      os_version = excluded.os_version,
      os_build = excluded.os_build,
      associated_user = excluded.associated_user,
      health = excluded.health,
      last_seen_at = excluded.last_seen_at,
      online = excluded.online,
      online_checked_at = excluded.online_checked_at,
      missing_syncs = 0,
      retired_at = null
    -- An endpoint ID never moves between tenants; ignore it if another tenant already owns it.
    where c.tenant_id = excluded.tenant_id
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted) into v_new from upserted;

  with missing as (
    update public.computers c set
      missing_syncs = c.missing_syncs + 1,
      retired_at = case when c.missing_syncs + 1 >= 2 then now() else null end,
      online = null
    where c.tenant_id = p_tenant_id
      and c.retired_at is null
      and not exists (select 1 from incoming i where i.sophos_endpoint_id = c.sophos_endpoint_id)
    returning c.retired_at
  )
  select count(*), count(*) filter (where retired_at is not null) into v_missing, v_retired from missing;

  update public.tenants set last_synced_at = now(), status_checked_at = now() where id = p_tenant_id;

  return jsonb_build_object(
    'seen', v_seen,
    'new', v_new,
    'reactivated', v_reactivated,
    'missing', v_missing,
    'retired', v_retired
  );
end;
$$;

-- Between full syncs: only online and last_seen_at of computers this tenant already has. Endpoints that
-- are not in the list are left as they are (the full sync decides about missing computers).
create or replace function public.apply_computer_status(p_tenant_id uuid, p_endpoints jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if jsonb_typeof(p_endpoints) <> 'array' then
    raise exception 'p_endpoints must be a JSON array' using errcode = '22023';
  end if;

  update public.computers c set
    online = i.online,
    online_checked_at = now(),
    last_seen_at = coalesce(i.last_seen_at, c.last_seen_at)
  from jsonb_to_recordset(p_endpoints) as i (sophos_endpoint_id text, online boolean, last_seen_at timestamptz)
  where c.tenant_id = p_tenant_id and c.sophos_endpoint_id = i.sophos_endpoint_id;
  get diagnostics v_updated = row_count;

  update public.tenants set status_checked_at = now() where id = p_tenant_id;
  return v_updated;
end;
$$;

revoke all on function public.apply_computer_status(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_computer_status(uuid, jsonb) to service_role;

-- v_computer_list as in 20261029180000_platforms.sql, plus online and online_checked_at at the end.
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
  c.online, c.online_checked_at
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
