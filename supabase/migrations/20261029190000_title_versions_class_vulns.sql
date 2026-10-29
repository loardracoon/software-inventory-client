-- Title page › Version distribution (Phase 9 follow-up): each installed version with its policy class (the most
-- restrictive across the visible tenants and spellings) and its known vulnerabilities by severity, as the
-- Software and Computers lists show them. A match with an OS counts only for computers with that OS.

drop function public.title_versions(uuid, uuid);

create function public.title_versions(p_title_id uuid, p_tenant_id uuid default null)
returns table (version text, computers bigint, policy_class public.policy_class, vulns jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  with inst as (
    select i.tenant_id, i.title_id, i.version, i.computer_id, c.platform
    from public.installations i
    join public.my_tenant_roles() r on r.tenant_id = i.tenant_id
    join public.computers c on c.id = i.computer_id and c.retired_at is null
    where i.title_id = any (public.title_group_ids(p_title_id)) and i.valid_to is null and (p_tenant_id is null or i.tenant_id = p_tenant_id)
  ),
  v as (
    select inst.version, count(distinct inst.computer_id) as computers from inst group by inst.version
  )
  select v.version, v.computers,
    (select max(p.class)
     from public.title_version_policy p
     join (select distinct x.tenant_id, x.title_id from inst x where x.version is not distinct from v.version) t
       on t.tenant_id = p.tenant_id and t.title_id = p.title_id
     where p.version = coalesce(v.version, '')),
    (select jsonb_build_object(
        'critical', count(*) filter (where not y.uncertain and y.severity = 'CRITICAL'),
        'high', count(*) filter (where not y.uncertain and y.severity = 'HIGH'),
        'medium', count(*) filter (where not y.uncertain and y.severity = 'MEDIUM'),
        'low', count(*) filter (where not y.uncertain and y.severity = 'LOW'),
        'kev', count(*) filter (where not y.uncertain and y.kev),
        'possible', count(*) filter (where y.uncertain),
        'top', coalesce(jsonb_agg(jsonb_build_object('id', y.vuln_id, 'severity', y.severity, 'score', y.cvss_score, 'kev', y.kev, 'uncertain', y.uncertain)
          order by y.uncertain, y.kev desc, y.cvss_score desc nulls last, y.vuln_id) filter (where y.rn <= 8), '[]'))
     from (
       select z.*, row_number() over (order by z.uncertain, z.kev desc, z.cvss_score desc nulls last, z.vuln_id) as rn
       from (
         select m.vuln_id, c.severity, c.cvss_score, c.kev_added is not null as kev, bool_and(m.uncertain) as uncertain
         from (select distinct x.tenant_id, x.title_id, x.platform from inst x where x.version is not distinct from v.version) t
         join public.title_version_vulns m
           on m.tenant_id = t.tenant_id and m.title_id = t.title_id and m.version = coalesce(v.version, '')
          and (m.platforms is null or t.platform::text = any (m.platforms))
         join public.vuln_cache c on c.product_key = m.product_key and c.vuln_id = m.vuln_id
         group by m.vuln_id, c.severity, c.cvss_score, c.kev_added
       ) z
     ) y)
  from v
  order by public.version_key(v.version) desc;
$$;

revoke all on function public.title_versions(uuid, uuid) from public, anon;
grant execute on function public.title_versions(uuid, uuid) to authenticated;
