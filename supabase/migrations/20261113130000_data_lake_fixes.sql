-- Data Lake gap fill, final review fixes.
-- v_computer_list as in 20261113120100_data_lake_inventory.sql, but data_lake_snapshot_at is set only while the
-- computer has an open Data Lake installation: after Live Endpoint Search takes over every domain, the header
-- no longer shows "Data Lake snapshot <date>".
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
  case when exists (select 1 from public.installations i
                   where i.computer_id = c.id and i.valid_to is null and i.query_name like 'dl.%')
  then (select max(sn.collected_at) from public.snapshots sn
        where sn.computer_id = c.id and sn.applied_at is not null and sn.query_name like 'dl.%'
          and sn.outcome is distinct from 'superseded')
  end as data_lake_snapshot_at
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
