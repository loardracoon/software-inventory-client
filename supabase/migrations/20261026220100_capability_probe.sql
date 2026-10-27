-- Phase 3: capability probe. For each tenant and platform, the probe-capabilities Edge Function runs
-- "SELECT name FROM osquery_registry WHERE registry = 'table'" on the most recently seen computer and
-- stores the table list in platform_capabilities. A query whose required_tables are not all present
-- is skipped for that tenant and platform.

create table public.capability_probes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  platform public.platform not null,
  computer_id uuid not null,
  provider public.query_provider not null,
  sophos_run_id text,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'no_response')),
  error text,
  table_count integer,
  requested_by uuid references auth.users (id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (computer_id, tenant_id) references public.computers (id, tenant_id) on delete restrict
);

create unique index capability_probes_one_running_idx
  on public.capability_probes (tenant_id, platform) where status = 'running';
create index capability_probes_latest_idx on public.capability_probes (tenant_id, platform, started_at desc);
create index capability_probes_computer_idx on public.capability_probes (computer_id);

alter table public.capability_probes enable row level security;

create policy "Members read capability probes"
  on public.capability_probes for select
  to authenticated
  using (tenant_id in (select r.tenant_id from public.my_tenant_roles() r));

revoke all on table public.capability_probes from anon, authenticated;
grant select on table public.capability_probes to authenticated;

-- Counts one Sophos run against the per-minute budget (api_budget). Server side only.
create or replace function public.record_api_run(p_tenant_id uuid, p_runs integer default 1)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.api_budget (tenant_id, minute, runs)
  values (p_tenant_id, date_trunc('minute', now()), p_runs)
  on conflict (tenant_id, minute) do update set runs = public.api_budget.runs + excluded.runs;
$$;

revoke all on function public.record_api_run(uuid, integer) from public, anon, authenticated;
grant execute on function public.record_api_run(uuid, integer) to service_role;

-- Required tables of a query that the tenant's platform lacks: '{}' when runnable, null when the
-- platform was never probed. Phase 4 dispatches only queries with '{}'.
create or replace function public.missing_tables(p_tenant_id uuid, p_query_id uuid)
returns text[]
language sql
stable
set search_path = ''
as $$
  select case
    when pc.tenant_id is null then null
    else array(select t from unnest(q.required_tables) t where not (t = any (pc.osquery_tables)) order by t)
  end
  from public.query_catalog q
  left join public.platform_capabilities pc on pc.tenant_id = p_tenant_id and pc.platform = q.platform
  where q.id = p_query_id;
$$;

grant execute on function public.missing_tables(uuid, uuid) to authenticated, service_role;

-- Settings › Queries: one row per catalog query with its status across the tenants the caller can
-- see (or one tenant). Only tenants with active computers on the query's platform are counted.
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
  with visible as (
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
    from public.query_catalog q
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
  from public.query_catalog q
  left join per_tenant p on p.id = q.id
  group by q.id
  order by q.domain, q.platform, q.name, q.version;
$$;

revoke all on function public.query_catalog_status(uuid) from public, anon;
grant execute on function public.query_catalog_status(uuid) to authenticated;

-- Latest probe per tenant and platform, with the probed computer's hostname (no usernames).
create view public.v_capability_probes_latest
with (security_barrier = true)
as
select distinct on (p.tenant_id, p.platform)
  p.id,
  p.tenant_id,
  t.name as tenant_name,
  p.platform,
  p.computer_id,
  c.hostname,
  p.provider,
  p.status,
  p.error,
  p.table_count,
  p.started_at,
  p.finished_at
from public.capability_probes p
join public.my_tenant_roles() r on r.tenant_id = p.tenant_id
join public.tenants t on t.id = p.tenant_id
join public.computers c on c.id = p.computer_id
order by p.tenant_id, p.platform, p.started_at desc;

revoke all on table public.v_capability_probes_latest from anon, authenticated;
grant select on table public.v_capability_probes_latest to authenticated;
