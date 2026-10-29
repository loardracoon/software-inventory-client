-- "May apply" CVEs on the Overview card and as a Software filter. A CVE may apply when no installed
-- version is certainly affected but one cannot be ruled out: the installation reports no version, or the
-- CVE data names no affected version (NVD writes "-" for many older CVEs).

create or replace function public.vuln_overview(p_tenant_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with visible as (
    select r.tenant_id from public.my_tenant_roles() r where p_tenant_id is null or r.tenant_id = p_tenant_id
  ),
  all_matches as (
    select v.tenant_id, v.title_id, v.version, v.vuln_id, v.uncertain, c.severity, c.kev_added
    from public.title_version_vulns v
    join visible on visible.tenant_id = v.tenant_id
    join public.vuln_cache c on c.product_key = v.product_key and c.vuln_id = v.vuln_id
  ),
  m as (select * from all_matches where not uncertain),
  -- CVEs with no certain match anywhere in the visible tenants.
  p as (select * from all_matches a where a.uncertain and not exists (select 1 from m where m.vuln_id = a.vuln_id)),
  kev_installs as (
    select i.id, i.computer_id
    from public.installations i
    join public.computers cp on cp.id = i.computer_id and cp.retired_at is null
    where i.valid_to is null and exists (
      select 1 from m where m.kev_added is not null and m.tenant_id = i.tenant_id and m.title_id = i.title_id and m.version = coalesce(i.version, ''))
  )
  select jsonb_build_object(
    'vulns', (select count(distinct vuln_id) from m),
    'critical', (select count(distinct vuln_id) from m where severity = 'CRITICAL'),
    'high', (select count(distinct vuln_id) from m where severity = 'HIGH'),
    'kev', (select count(distinct vuln_id) from m where kev_added is not null),
    'titles', (select count(distinct title_id) from m),
    'kev_installations', (select count(*) from kev_installs),
    'kev_computers', (select count(distinct computer_id) from kev_installs),
    'possible', (select count(distinct vuln_id) from p),
    'possible_titles', (select count(distinct title_id) from p),
    'cached', (select count(*) from public.vuln_cache),
    'synced_at', (select max(synced_at) from public.vuln_cache),
    'evaluated_at', (select max(s.evaluated_at) from public.vuln_eval_state s join visible on visible.tenant_id = s.tenant_id)
  );
$$;

-- search_titles: p_vuln = 'possible' lists products with CVEs that may apply.
do $$
declare
  v_def text;
  v_line text := '    or (p_vuln = ''high'' and coalesce(vu.critical, 0) + coalesce(vu.high, 0) > 0)';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'search_titles';
  if position(v_line in v_def) = 0 then
    raise exception 'search_titles has changed: update this migration';
  end if;
  execute replace(v_def, v_line, v_line || '
    or (p_vuln = ''possible'' and coalesce(vu.possible, 0) > 0)');
end;
$$;
