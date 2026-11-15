-- Stage 3: end of life on the screens. Software list (support status and filter), title versions, computer list and
-- overview counts. Each object is its live definition (or latest earlier text) plus the end-of-life columns.

-- search_titles: the live definition plus support_status / eol_from and the p_support filter.
do $$
declare
  v_def text;
  v_parts text[][] := array[
    array['p_vuln text DEFAULT NULL::text)', 'p_vuln text DEFAULT NULL::text, p_support text DEFAULT NULL::text)'],
    array['vuln_top jsonb, total_count bigint)', 'vuln_top jsonb, support_status text, eol_from date, total_count bigint)'],
    array['    group by r.product_key
  )
  select g.title_id, t.kind,', '    group by r.product_key
  ),
  -- Worst support status of the listed installed versions of a product and the earliest end date among those not supported.
  support as (
    select pk.product_key,
      (array[''supported'', ''ending_soon'', ''eol''])[max(case e.status when ''eol'' then 3 when ''ending_soon'' then 2 else 1 end)] as status,
      min(e.eol_from) filter (where e.status <> ''supported'') as eol_from
    from (select distinct m.tenant_id, m.title_id, coalesce(m.version, '''') as version from matched m) p
    join public.title_products pk on pk.title_id = p.title_id
    join public.title_version_eol e on e.tenant_id = p.tenant_id and e.title_id = p.title_id and e.version = p.version
    group by pk.product_key
  )
  select g.title_id, t.kind,'],
    array['coalesce(vu.top, ''[]''),
    count(*) over () as total_count', 'coalesce(vu.top, ''[]''),
    su.status, su.eol_from,
    count(*) over () as total_count'],
    array['  left join vulns vu on vu.product_key = g.product_key
  where p_vuln is null or p_vuln = ''''
', '  left join vulns vu on vu.product_key = g.product_key
  left join support su on su.product_key = g.product_key
  where (p_support is null or p_support = '''' or su.status = p_support)
    and (p_vuln is null or p_vuln = ''''
'],
    array['    or (p_vuln = ''possible'' and coalesce(vu.possible, 0) > 0)', '    or (p_vuln = ''possible'' and coalesce(vu.possible, 0) > 0))']
  ];
  i integer;
begin
  select pg_get_functiondef('public.search_titles'::regproc) into v_def;
  for i in 1 .. array_length(v_parts, 1) loop
    if (length(v_def) - length(replace(v_def, v_parts[i][1], ''))) / length(v_parts[i][1]) <> 1 then
      raise exception 'search_titles has changed (part %): update this migration', i;
    end if;
    v_def := replace(v_def, v_parts[i][1], v_parts[i][2]);
  end loop;
  drop function public.search_titles(uuid, text, public.title_kind, text, public.attention_level[], text, public.platform, text, text,
    timestamptz, text, boolean, integer, integer, public.policy_class[], text);
  execute v_def;
end;
$$;

revoke all on function public.search_titles(uuid, text, public.title_kind, text, public.attention_level[], text, public.platform, text, text,
    timestamptz, text, boolean, integer, integer, public.policy_class[], text, text) from public, anon;
grant execute on function public.search_titles(uuid, text, public.title_kind, text, public.attention_level[], text, public.platform, text, text,
    timestamptz, text, boolean, integer, integer, public.policy_class[], text, text) to authenticated;

drop function public.title_versions(uuid, uuid);

create function public.title_versions(p_title_id uuid, p_tenant_id uuid default null)
returns table (version text, computers bigint, policy_class public.policy_class, vulns jsonb, support_status text, eol_from date, release text)
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
     ) y),
    eo.status, eo.eol_from, eo.release
  from v
  left join lateral (
    select e.status, e.eol_from, e.release
    from public.title_version_eol e
    join (select distinct x.tenant_id, x.title_id from inst x where x.version is not distinct from v.version) t
      on t.tenant_id = e.tenant_id and t.title_id = e.title_id
    where e.version = coalesce(v.version, '')
    order by case e.status when 'eol' then 3 when 'ending_soon' then 2 else 1 end desc, e.eol_from nulls last
    limit 1) eo on true
  order by public.version_key(v.version) desc;
$$;

revoke all on function public.title_versions(uuid, uuid) from public, anon;
grant execute on function public.title_versions(uuid, uuid) to authenticated;

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
  end as data_lake_snapshot_at,
  case when inv.inventoried_at is null then 'none' when inv.query_name like 'dl.%' then 'data_lake' else 'live_endpoint_search' end
    as inventory_source,
  inv.inventoried_at,
  case when inv.inventoried_at is null then 'never'
       when inv.inventoried_at <= now() - make_interval(days => coalesce(ss.stale_after_days, 14)) then 'stale'
       else 'current' end as coverage_status,
  c.owner, c.department, c.criticality, c.scope_tags,
  c.os_eol_release, c.os_eol_from, c.os_eol_status
from public.computers c
join public.my_tenant_roles() r on r.tenant_id = c.tenant_id
left join public.scan_settings ss on ss.tenant_id = c.tenant_id
-- The latest applied snapshot gives both the date and the source, so they always agree.
left join lateral (select sn.collected_at as inventoried_at, sn.query_name from public.snapshots sn
  where sn.computer_id = c.id and sn.applied_at is not null order by sn.collected_at desc limit 1) inv on true
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

-- overview_stats as in 20261114100000_coverage_status.sql, plus the end-of-life counts.
create or replace function public.overview_stats(p_tenant_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with v as (
    select r.tenant_id from public.my_tenant_roles() r where p_tenant_id is null or r.tenant_id = p_tenant_id
  ),
  comps as (
    select c.* from public.computers c join v on v.tenant_id = c.tenant_id where c.retired_at is null
  ),
  inst as (
    select i.* from public.installations i join comps c on c.id = i.computer_id where i.valid_to is null
  ),
  cov as (
    select case when inv.at is null then 'never'
                when inv.at <= now() - make_interval(days => coalesce(ss.stale_after_days, 14)) then 'stale' else 'current' end as status
    from comps c
    left join public.scan_settings ss on ss.tenant_id = c.tenant_id
    left join lateral (select max(sn.collected_at) as at from public.snapshots sn where sn.computer_id = c.id and sn.applied_at is not null) inv on true
  ),
  tasks as (
    select t.status from public.scan_tasks t
    join v on v.tenant_id = t.tenant_id
    join public.scan_cycles cy on cy.id = t.cycle_id and cy.status = 'open'
  ),
  ev as (
    select e.change from public.change_events e join v on v.tenant_id = e.tenant_id
    where e.detected_at > now() - interval '7 days'
  )
  select jsonb_build_object(
    'computers', (select count(*) from comps),
    'computers_by_platform', (select coalesce(jsonb_object_agg(platform, n), '{}') from (select platform, count(*) n from comps group by 1) p),
    'coverage_pct', (select round(100.0 * count(*) filter (where status = 'collected') / nullif(count(*) filter (where status <> 'skipped'), 0), 1) from tasks),
    'coverage_never', (select count(*) from cov where status = 'never'),
    'coverage_stale', (select count(*) from cov where status = 'stale'),
    'coverage_current', (select count(*) from cov where status = 'current'),
    'eol_titles', (select count(distinct e.title_id) from public.title_version_eol e join inst i on i.title_id = e.title_id and coalesce(i.version, '') = e.version and i.tenant_id = e.tenant_id where e.status = 'eol'),
    'ending_soon_titles', (select count(distinct e.title_id) from public.title_version_eol e join inst i on i.title_id = e.title_id and coalesce(i.version, '') = e.version and i.tenant_id = e.tenant_id where e.status = 'ending_soon'),
    'eol_computers', (select count(*) from comps where os_eol_status = 'eol'),
    'ending_soon_computers', (select count(*) from comps where os_eol_status = 'ending_soon'),
    'titles', (select count(distinct title_id) from inst),
    'extension_installs', (select count(*) from inst where domain in ('extensions', 'ide_extensions')),
    'distinct_extensions', (select count(distinct title_id) from inst where domain in ('extensions', 'ide_extensions')),
    'package_installs', (select count(*) from inst where domain = 'packages'),
    'package_managers', (select coalesce(array_agg(distinct t.source), '{}') from inst i join public.software_titles t on t.id = i.title_id where i.domain = 'packages'),
    'changes_7d', (select count(*) from ev),
    'added_7d', (select count(*) from ev where change = 'added'),
    'updated_7d', (select count(*) from ev where change = 'updated'),
    'removed_7d', (select count(*) from ev where change = 'removed')
  );
$$;

