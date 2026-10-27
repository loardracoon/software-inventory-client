-- Phase 2: computer sync from the Sophos Central Endpoint API.
-- The sync-computers Edge Function (service role) upserts tenants and calls apply_computer_sync once
-- per tenant, only after reading every page of that tenant's endpoints. Rows are never deleted: an
-- endpoint missing from two consecutive complete syncs gets retired_at; one that comes back is
-- reactivated.

alter table public.computers add column endpoint_type text check (endpoint_type in ('computer', 'server'));

alter table public.tenants add column last_synced_at timestamptz;
comment on column public.tenants.id_type is 'Type of the credential this tenant was reached through (tenant, partner or organization).';

alter table public.sophos_connection
  add column last_sync_at timestamptz,
  add column last_sync_ok boolean,
  add column last_sync_message text;

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
    last_seen_at timestamptz
  );

  select count(*) into v_seen from incoming;

  select count(*) into v_reactivated
  from public.computers c
  join incoming i on i.sophos_endpoint_id = c.sophos_endpoint_id
  where c.tenant_id = p_tenant_id and c.retired_at is not null;

  with upserted as (
    insert into public.computers as c (
      tenant_id, sophos_endpoint_id, hostname, platform, endpoint_type, os_name, os_version, os_build,
      associated_user, health, last_seen_at
    )
    select
      p_tenant_id, i.sophos_endpoint_id, i.hostname, i.platform, i.endpoint_type, i.os_name, i.os_version,
      i.os_build, i.associated_user, i.health, i.last_seen_at
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
      retired_at = case when c.missing_syncs + 1 >= 2 then now() else null end
    where c.tenant_id = p_tenant_id
      and c.retired_at is null
      and not exists (select 1 from incoming i where i.sophos_endpoint_id = c.sophos_endpoint_id)
    returning c.retired_at
  )
  select count(*), count(*) filter (where retired_at is not null) into v_missing, v_retired from missing;

  update public.tenants set last_synced_at = now() where id = p_tenant_id;

  return jsonb_build_object(
    'seen', v_seen,
    'new', v_new,
    'reactivated', v_reactivated,
    'missing', v_missing,
    'retired', v_retired
  );
end;
$$;

revoke all on function public.apply_computer_sync(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_computer_sync(uuid, jsonb) to service_role;

-- Status for the Settings card, now with the last sync.
drop function public.get_sophos_connection_status();

create function public.get_sophos_connection_status()
returns table (
  configured boolean,
  client_id_hint text,
  configured_at timestamptz,
  configured_by_email text,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_message text,
  id_type text,
  data_region_host text,
  last_sync_at timestamptz,
  last_sync_ok boolean,
  last_sync_message text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id is not null,
    case when public.is_admin() then '••••' || right(c.client_id, 4) end,
    case when public.is_admin() then c.configured_at end,
    case when public.is_admin() then p.email end,
    c.last_test_at,
    c.last_test_ok,
    case when public.is_admin() then c.last_test_message end,
    c.id_type,
    case when public.is_admin() then c.data_region_host end,
    c.last_sync_at,
    c.last_sync_ok,
    case when public.is_admin() then c.last_sync_message end
  from (select 1) as one
  left join public.sophos_connection c on c.id = 1
  left join public.profiles p on p.id = c.configured_by;
$$;

revoke all on function public.get_sophos_connection_status() from public, anon;
grant execute on function public.get_sophos_connection_status() to authenticated;

-- Tenants the caller can see, with computer counts (no usernames, so viewers may read it).
create view public.v_tenant_overview
with (security_barrier = true)
as
select
  t.id,
  t.name,
  t.sophos_tenant_id,
  t.id_type,
  t.data_region_host,
  t.last_synced_at,
  t.created_at,
  r.role,
  (select count(*) from public.computers c where c.tenant_id = t.id and c.retired_at is null) as active_computers,
  (select count(*) from public.computers c where c.tenant_id = t.id and c.retired_at is not null) as retired_computers
from public.tenants t
join public.my_tenant_roles() r on r.tenant_id = t.id;

revoke all on table public.v_tenant_overview from anon, authenticated;
grant select on table public.v_tenant_overview to authenticated;
