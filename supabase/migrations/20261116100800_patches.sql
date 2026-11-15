-- Stage 3: Windows patch state from the Sophos Data Lake (patchstate). A patch is an item of its own domain, kept over
-- time like disks: one open row per patch uid, closed when a later snapshot of the computer no longer lists it. Unlike
-- programs there is no Live Discover source, so the Data Lake rule "one source per domain" does not apply: every live
-- Windows computer of a tenant with the setting on gets its patches from the Data Lake.

alter table public.scan_settings
  add column data_lake_patches boolean not null default false,
  add column patch_stale_days integer not null default 60 check (patch_stale_days between 1 and 365);

alter table public.hardware_versions drop constraint hardware_versions_domain_check;
alter table public.hardware_versions add constraint hardware_versions_domain_check check (domain in ('hardware', 'disks', 'patches'));

-- Reference row only: never enabled, so no scan task is made. The sql is the QL template the collector fills in.
insert into public.query_catalog (domain, platform, version, name, enabled, required_tables, sql) values
('patches', 'windows', 1, 'dl.patches', false, '{}', $q$from patchstate where normalizer = 'sophos-xdr-it-hygiene-ingestor' and host_id in ('<id1>', '<id2>') earliest='<earliest>' latest='<latest>' | fields host_id, time, kb_article.title, kb_article.install_time, kb_article.uid, original_data$q$)
on conflict (platform, name, version) do nothing;

-- Computers the Data Lake should fill, with the domains to fill: programs and extensions that LES does not cover (when the
-- inventory setting is on) and patches (when the patch setting is on). Same 20-hour re-check as before.
create or replace function public.data_lake_targets(p_tenant_id uuid, p_limit integer default 50)
returns table (computer_id uuid, sophos_endpoint_id text, domains public.inventory_domain[])
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.sophos_endpoint_id, d.domains
  from public.computers c
  join public.scan_settings st on st.tenant_id = c.tenant_id and (st.data_lake_inventory or st.data_lake_patches)
  cross join lateral (
    select array_agg(u.x order by u.ord) as domains
    from unnest(array['programs', 'extensions', 'patches']::public.inventory_domain[]) with ordinality as u (x, ord)
    where case when u.x = 'patches' then st.data_lake_patches else st.data_lake_inventory and not public.has_live_snapshot(c.id, u.x) end
  ) d
  where c.tenant_id = p_tenant_id and c.retired_at is null and c.platform = 'windows'
    and (c.data_lake_checked_at is null or c.data_lake_checked_at < now() - interval '20 hours')
    and d.domains is not null
  order by c.data_lake_checked_at nulls first, c.id
  limit p_limit;
$$;

-- apply_snapshot treats patches like hardware (item rows, no software installations): a text patch of the live definition.
do $$
declare
  v_def text;
  v_old constant text := $q$v_hardware := s.domain in ('hardware', 'disks');$q$;
begin
  select pg_get_functiondef('public.apply_snapshot(uuid, jsonb)'::regprocedure) into v_def;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'apply_snapshot has changed: update this migration';
  end if;
  execute replace(v_def, v_old, $q$v_hardware := s.domain in ('hardware', 'disks', 'patches');$q$);
end;
$$;
