-- Stage 3: patch state on the screens and in the evidence package. A computer's last patch is the newest installed_at among
-- its open 'patches' rows; it is stale when older than the tenant's patch_stale_days, unknown when there is no patch data.

-- v_computer_list as in 20261116100300_eol_screens.sql, plus last_patch_at and patch_status at the end.
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
  c.os_eol_release, c.os_eol_from, c.os_eol_status,
  pt.last_patch_at,
  case when pt.last_patch_at is null then 'unknown'
       when pt.last_patch_at < current_date - coalesce(ss.patch_stale_days, 60) then 'stale'
       else 'current' end as patch_status
from public.computers c
join public.my_tenant_roles() r on r.tenant_id = c.tenant_id
left join public.scan_settings ss on ss.tenant_id = c.tenant_id
-- The install date is ISO text only: anything else is no date (a bad value must not break a screen).
left join lateral (select max((substring(h.attrs ->> 'installed_at' from '^\d{4}-\d{2}-\d{2}'))::date) as last_patch_at
  from public.hardware_versions h where h.computer_id = c.id and h.domain = 'patches' and h.valid_to is null) pt on true
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

-- overview_stats and audit_report_data are patched on their live definitions (same signatures and grants).
do $$
declare
  v_def text;
  v_old constant text := $q$'titles', (select count(distinct title_id) from inst),$q$;
begin
  select pg_get_functiondef('public.overview_stats'::regproc) into v_def;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'overview_stats has changed: update this migration';
  end if;
  execute replace(v_def, v_old,
    $q$'patch_tracked_computers', (select count(*) from comps c cross join lateral (select max((substring(h.attrs ->> 'installed_at' from '^\d{4}-\d{2}-\d{2}'))::date) as d from public.hardware_versions h
       where h.computer_id = c.id and h.domain = 'patches' and h.valid_to is null) p where p.d is not null),
    'patch_stale_computers', (select count(*) from comps c left join public.scan_settings ss on ss.tenant_id = c.tenant_id
       cross join lateral (select max((substring(h.attrs ->> 'installed_at' from '^\d{4}-\d{2}-\d{2}'))::date) as d from public.hardware_versions h
       where h.computer_id = c.id and h.domain = 'patches' and h.valid_to is null) p where p.d < current_date - coalesce(ss.patch_stale_days, 60)),
    $q$ || v_old);
end;
$$;

do $$
declare
  v_def text;
  v_parts text[][] := array[
    array['l.os_eol_status, l.os_eol_from', 'l.os_eol_status, l.os_eol_from, l.last_patch_at, l.patch_status'],
    array['''remediation'', (select jsonb_build_object(', '''patches'', coalesce((select jsonb_agg(jsonb_build_object(''hostname'', c.hostname, ''kb'', h.attrs ->> ''kb'', ''title'', h.attrs ->> ''title'', ''installed_at'', h.attrs ->> ''installed_at'', ''installed_by'', h.attrs ->> ''installed_by'') order by c.hostname, h.attrs ->> ''installed_at'' desc nulls last, h.item_key) from public.hardware_versions h join comp c on c.id = h.computer_id where h.domain = ''patches'' and h.valid_from <= p_as_of and (h.valid_to is null or h.valid_to > p_as_of)), ''[]''::jsonb),
      ''remediation'', (select jsonb_build_object(']
  ];
  i integer;
begin
  select pg_get_functiondef('public.audit_report_data'::regproc) into v_def;
  for i in 1 .. array_length(v_parts, 1) loop
    if (length(v_def) - length(replace(v_def, v_parts[i][1], ''))) / length(v_parts[i][1]) <> 1 then
      raise exception 'audit_report_data has changed (part %): update this migration', i;
    end if;
    v_def := replace(v_def, v_parts[i][1], v_parts[i][2]);
  end loop;
  execute v_def;
end;
$$;
