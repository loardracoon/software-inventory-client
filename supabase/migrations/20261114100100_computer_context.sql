-- Asset context for audits (ISO 27001 A.5.9, PCI DSS 12.5.1, CIS 1.1): owner, department, criticality, scope tags.
-- Set by admins and operators (manual edit or CSV import); the Sophos Central sync never writes these columns.
create function public.valid_scope_tags(p_tags text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(cardinality(p_tags), 0) <= 10
     and not exists (select 1 from unnest(p_tags) t where t is null or t !~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$')
$$;

alter table public.computers
  add column owner text check (char_length(owner) <= 200),
  add column department text check (char_length(department) <= 200),
  add column criticality text check (criticality in ('low', 'medium', 'high', 'critical')),
  add column scope_tags text[] not null default '{}' check (public.valid_scope_tags(scope_tags)),
  add column context_updated_at timestamptz,
  add column context_updated_by uuid references auth.users (id) on delete set null;

-- Shared writer. null argument = leave unchanged; '' or '{}' = clear. No access check: callers do it.
create function public._apply_computer_context(p_ids uuid[], p_owner text, p_department text, p_criticality text, p_tags text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if char_length(p_owner) > 200 or char_length(p_department) > 200 then
    raise exception 'Owner and department can have at most 200 characters' using errcode = '22001';
  end if;
  if p_criticality is not null and p_criticality <> '' and p_criticality not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Criticality must be low, medium, high or critical' using errcode = '23514';
  end if;
  if p_tags is not null and not public.valid_scope_tags(p_tags) then
    raise exception 'Scope tags: at most 10, each 1 to 40 characters of letters, digits, space, dot, underscore or hyphen' using errcode = '22023';
  end if;
  update public.computers c set
    owner = case when p_owner is null then c.owner else nullif(btrim(p_owner), '') end,
    department = case when p_department is null then c.department else nullif(btrim(p_department), '') end,
    criticality = case when p_criticality is null then c.criticality else nullif(p_criticality, '') end,
    scope_tags = case when p_tags is null then c.scope_tags else p_tags end,
    context_updated_at = now(),
    context_updated_by = auth.uid()
  where c.id = any (p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create function public.set_computer_context(p_computer_ids uuid[], p_owner text, p_department text, p_criticality text, p_scope_tags text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if (select count(*) from public.computers c
      join public.my_tenant_roles() r on r.tenant_id = c.tenant_id and r.role in ('admin', 'operator')
      where c.id = any (p_computer_ids)) <> (select count(distinct x) from unnest(p_computer_ids) x) then
    raise exception 'Only admins and operators of the tenant can change the context of a computer' using errcode = '42501';
  end if;
  v_n := public._apply_computer_context(p_computer_ids, p_owner, p_department, p_criticality, p_scope_tags);
  insert into public.audit_log (user_id, action, target, data)
  values (auth.uid(), 'computer_context', 'computers',
    jsonb_build_object('computer_ids', to_jsonb(p_computer_ids), 'owner', p_owner, 'department', p_department,
      'criticality', p_criticality, 'scope_tags', to_jsonb(p_scope_tags)));
  return v_n;
end;
$$;

-- rows: [{ endpoint_id | hostname, owner, department, criticality, scope_tags: "pci;iso" }]. A key that is
-- absent leaves the value unchanged; an empty value clears it. Bad rows are reported and change nothing.
create function public.import_computer_context(p_tenant_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_i integer := 0;
  v_applied integer := 0;
  v_errors jsonb := '[]';
  v_ids uuid[];
  v_key text;
begin
  if not exists (select 1 from public.my_tenant_roles() r where r.tenant_id = p_tenant_id and r.role in ('admin', 'operator')) then
    raise exception 'Only admins and operators can import context' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = '22023';
  end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    begin
      v_key := nullif(btrim(coalesce(v_row ->> 'endpoint_id', '')), '');
      if v_key is not null then
        select array_agg(c.id) into v_ids from public.computers c where c.tenant_id = p_tenant_id and c.sophos_endpoint_id = v_key;
      end if;
      if v_ids is null then
        v_key := nullif(btrim(coalesce(v_row ->> 'hostname', '')), '');
        if v_key is null then raise exception 'Row has no endpoint_id or hostname'; end if;
        select array_agg(c.id) into v_ids from public.computers c
        where c.tenant_id = p_tenant_id and c.retired_at is null and lower(c.hostname) = lower(v_key);
      end if;
      if v_ids is null then raise exception 'No computer matches "%"', v_key; end if;
      if cardinality(v_ids) > 1 then raise exception 'Hostname "%" matches more than one computer; use endpoint_id', v_key; end if;
      perform public._apply_computer_context(v_ids,
        v_row ->> 'owner', v_row ->> 'department', v_row ->> 'criticality',
        case when v_row ? 'scope_tags'
          then coalesce((select array_agg(btrim(t)) from unnest(string_to_array(v_row ->> 'scope_tags', ';')) t where btrim(t) <> ''), '{}')
        end);
      v_applied := v_applied + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_object('row', v_i, 'message', sqlerrm);
    end;
    v_ids := null;
  end loop;
  insert into public.audit_log (user_id, action, target, data)
  values (auth.uid(), 'computer_context', 'tenant:' || p_tenant_id,
    jsonb_build_object('import', true, 'rows', v_i, 'applied', v_applied, 'errors', jsonb_array_length(v_errors)));
  return jsonb_build_object('applied', v_applied, 'errors', v_errors);
end;
$$;

revoke all on function public.valid_scope_tags(text[]) from public, anon;
revoke all on function public._apply_computer_context(uuid[], text, text, text, text[]) from public, anon, authenticated;
revoke all on function public.set_computer_context(uuid[], text, text, text, text[]) from public, anon;
revoke all on function public.import_computer_context(uuid, jsonb) from public, anon;
grant execute on function public.set_computer_context(uuid[], text, text, text, text[]) to authenticated;
grant execute on function public.import_computer_context(uuid, jsonb) to authenticated;
grant execute on function public.valid_scope_tags(text[]) to authenticated;

-- export_csv: the computers export adds Owner, Department, Criticality, Scope tags and takes the filters
-- criticality, scope and owner (and coverage). Patched in place; each anchor must match exactly once.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'export_csv';
  v_def := replace(v_def, 'Packages,Attention''', 'Packages,Attention,Owner,Department,Criticality,Scope tags''');
  v_def := replace(v_def, 'public.csv_field(array_to_string(c.attention_level1_slugs, '' ''))) as line',
    'public.csv_field(array_to_string(c.attention_level1_slugs, '' '')),
          public.csv_field(c.owner), public.csv_field(c.department), public.csv_field(c.criticality),
          public.csv_field(array_to_string(c.scope_tags, '';''))) as line');
  v_def := replace(v_def, '        and (nullif(f ->> ''category'', '''') is null or c.attention_level1_slugs @> array[f ->> ''category''])',
    '        and (nullif(f ->> ''category'', '''') is null or c.attention_level1_slugs @> array[f ->> ''category''])
        and (nullif(f ->> ''coverage'', '''') is null or c.coverage_status = f ->> ''coverage'')
        and (nullif(f ->> ''criticality'', '''') is null or c.criticality = f ->> ''criticality'')
        and (nullif(f ->> ''scope'', '''') is null or c.scope_tags @> array[f ->> ''scope''])
        and (nullif(btrim(coalesce(f ->> ''owner'', '''')), '''') is null or c.owner ilike public.like_contains(btrim(f ->> ''owner'')))');
  if v_def not like '%Scope tags%' or v_def not like '%c.scope_tags @>%' or v_def not like '%csv_field(c.owner)%' then
    raise exception 'export_csv has changed: update this migration';
  end if;
  execute v_def;
end;
$$;

-- v_computer_list as in 20261114100000_coverage_status.sql, plus owner, department, criticality, scope_tags (last).
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
  case
    when exists (select 1 from public.snapshots sn where sn.computer_id = c.id and sn.applied_at is not null and sn.query_name not like 'dl.%') then 'live_endpoint_search'
    when exists (select 1 from public.installations i where i.computer_id = c.id and i.valid_to is null and i.query_name like 'dl.%') then 'data_lake'
    else 'none'
  end as inventory_source,
  inv.inventoried_at,
  case when inv.inventoried_at is null then 'never'
       when inv.inventoried_at <= now() - make_interval(days => coalesce(ss.stale_after_days, 14)) then 'stale'
       else 'current' end as coverage_status,
  c.owner, c.department, c.criticality, c.scope_tags
from public.computers c
join public.my_tenant_roles() r on r.tenant_id = c.tenant_id
left join public.scan_settings ss on ss.tenant_id = c.tenant_id
left join lateral (select max(sn.collected_at) as inventoried_at from public.snapshots sn where sn.computer_id = c.id and sn.applied_at is not null) inv on true
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
