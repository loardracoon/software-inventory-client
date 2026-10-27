-- Phase 8: program queries v2. Same SQL as v1; the version tells _shared/normalize.ts to key programs by
-- the product name without version or architecture ("7-Zip 23.01 (x64)" → "7-Zip"), so one product is
-- one title. Cycles opened from now on use v2; apply_snapshot treats the new query version as a
-- baseline, so the switch creates no change events.

insert into public.query_catalog (domain, platform, version, name, required_tables, sql)
select q.domain, q.platform, 2, q.name, q.required_tables, q.sql
from public.query_catalog q
where q.domain = 'programs' and q.version = 1
on conflict (platform, name, version) do nothing;

-- Settings › Queries lists only the version in use (the latest of each query name and platform).
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
    where q.version = (select max(q2.version) from public.query_catalog q2 where q2.platform = q.platform and q2.name = q.name)
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
