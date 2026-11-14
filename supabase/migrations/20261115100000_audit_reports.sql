-- Evidence packages for auditors (PCI DSS 12.5.1, ISO 27001 A.5.9, CIS 1.1/2.1): the point-in-time report data,
-- the table that keeps each generated package, and its RPCs. The Edge Function builds the files and the ZIP.
alter table public.scan_settings
  add column scope_statement text not null default 'Computers managed by Sophos Central in this tenant (Windows, macOS, Linux). Devices without the Sophos agent are out of scope.'
  check (char_length(scope_statement) <= 2000);

create table public.audit_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  as_of timestamptz not null,
  scope_tag text,
  -- No foreign key: the actor id stays when a user is removed (SET NULL is an update and the no-change trigger would refuse it).
  generated_by uuid,
  generated_at timestamptz not null default now(),
  manifest jsonb not null,
  manifest_sha256 text not null,
  archive bytea not null check (octet_length(archive) <= 26214400),
  users_masked boolean not null
);
create index audit_reports_tenant_idx on public.audit_reports (tenant_id, generated_at desc);

alter table public.audit_reports enable row level security;
-- No policies and no grants: the browser reads the view (without the archive), and writes go through record_audit_report.
revoke all on table public.audit_reports from anon, authenticated, service_role;

-- Packages are never changed or deleted by the app.
create function public.audit_reports_block_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Audit reports cannot be changed' using errcode = '42501';
end;
$$;
create trigger audit_reports_block_change before update or delete on public.audit_reports
  for each row execute function public.audit_reports_block_change();

create view public.v_audit_reports
with (security_barrier = true)
as
select a.id, a.tenant_id, a.as_of, a.scope_tag, a.generated_by, p.email as generated_by_email, a.generated_at,
  a.manifest, a.manifest_sha256, octet_length(a.archive) as archive_bytes, a.users_masked
from public.audit_reports a
join public.my_tenant_roles() r on r.tenant_id = a.tenant_id
left join public.profiles p on p.id = a.generated_by;
revoke all on public.v_audit_reports from anon;
grant select on public.v_audit_reports to authenticated;

-- Report data as of p_as_of. The computer set and installations are as of the date; policy classes, vulnerabilities and
-- context (owner, coverage...) are current. Exceptions: every enabled "tolerated" rule of the published policy.
create function public.audit_report_data(p_tenant_id uuid, p_as_of timestamptz, p_scope_tag text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_stale integer;
  v_pol uuid;
begin
  if not exists (select 1 from public.my_tenant_roles() r where r.tenant_id = p_tenant_id and r.role in ('admin', 'operator')) then
    raise exception 'Only admins and operators can generate audit reports' using errcode = '42501';
  end if;
  select coalesce(max(s.stale_after_days), 14) into v_stale from public.scan_settings s where s.tenant_id = p_tenant_id;
  select p.id into v_pol from public.policies p where p.tenant_id = p_tenant_id and p.status = 'published';

  return (
    with comp as (
      select l.id, l.hostname, k.sophos_endpoint_id, l.platform, l.os_name, l.os_version, l.os_build, l.associated_user,
        l.owner, l.department, l.criticality, l.scope_tags, l.last_seen_at, l.inventoried_at, l.inventory_source, l.coverage_status
      from public.v_computer_list l
      join public.computers k on k.id = l.id
      where l.tenant_id = p_tenant_id and k.created_at <= p_as_of and (k.retired_at is null or k.retired_at > p_as_of)
        and (p_scope_tag is null or p_scope_tag = any (l.scope_tags))
    ),
    soft as (
      select c.hostname, c.platform, i.computer_id, i.title_id, coalesce(i.version, '') as version, t.kind, t.source, t.canonical_name, t.vendor,
        nullif(concat_ws(' / ', tc.level1_name, tc.level2_name), '') as category, tc.attention_level,
        case when v_pol is not null then vp.class end as policy_class, i.valid_from
      from public.installations i
      join comp c on c.id = i.computer_id
      join public.software_titles t on t.id = i.title_id
      left join public.title_classification tc on tc.title_id = t.id
      left join public.title_version_policy vp on vp.tenant_id = p_tenant_id and vp.title_id = i.title_id and vp.version = coalesce(i.version, '')
      where i.valid_from <= p_as_of and (i.valid_to is null or i.valid_to > p_as_of)
    ),
    -- One row per (title, version, platform), so each vulnerability row joins this small set instead of rescanning installations.
    present as (
      select s.title_id, s.version, s.platform::text as platform, count(distinct s.computer_id) as computers from soft s group by 1, 2, 3
    ),
    vulns as (
      select t.canonical_name, v.version, v.vuln_id, vc.severity, vc.cvss_score, vc.kev_added is not null as kev, vc.kev_due, vc.epss,
        v.fixed_in, v.first_seen_at, sum(pr.computers)::bigint as computers
      from public.title_version_vulns v
      join present pr on pr.title_id = v.title_id and pr.version = v.version and (v.platforms is null or pr.platform = any (v.platforms))
      join public.vuln_cache vc on vc.product_key = v.product_key and vc.vuln_id = v.vuln_id
      join public.software_titles t on t.id = v.title_id
      where v.tenant_id = p_tenant_id and not v.uncertain
      group by t.canonical_name, v.title_id, v.version, v.vuln_id, vc.severity, vc.cvss_score, vc.kev_added, vc.kev_due, vc.epss, v.fixed_in, v.first_seen_at
    )
    select jsonb_build_object(
      'computers', coalesce((select jsonb_agg(to_jsonb(c) - 'id' order by c.hostname, c.id) from comp c), '[]'::jsonb),
      'software', coalesce((select jsonb_agg(jsonb_build_object('hostname', s.hostname, 'kind', s.kind, 'source', s.source,
          'canonical_name', s.canonical_name, 'vendor', s.vendor, 'version', nullif(s.version, ''), 'category', s.category,
          'attention_level', s.attention_level, 'policy_class', s.policy_class, 'first_seen', s.valid_from)
          order by s.hostname, s.canonical_name, s.version) from soft s), '[]'::jsonb),
      'vulnerabilities', coalesce((select jsonb_agg(to_jsonb(v) order by v.canonical_name, v.version, v.vuln_id) from vulns v), '[]'::jsonb),
      'exceptions', coalesce((select jsonb_agg(jsonb_build_object('name', r.name, 'reason', r.business_purpose, 'review_by', r.review_by, 'owner', r.owner)
          order by r.review_by nulls first, r.name)
          from public.policy_rules r where r.policy_id = v_pol and r.class = 'tolerated_app' and r.enabled), '[]'::jsonb),
      'coverage', jsonb_build_object('total', (select count(*) from comp), 'current', (select count(*) from comp where coverage_status = 'current'),
          'stale', (select count(*) from comp where coverage_status = 'stale'), 'never', (select count(*) from comp where coverage_status = 'never'),
          'stale_after_days', v_stale),
      'policy', (select jsonb_build_object('version', p.version, 'published_at', p.published_at,
          'rule_count', (select count(*) from public.policy_rules r where r.policy_id = p.id), 'default_class', p.default_class,
          -- The same shape as Policies > Export policy, which Import policy reads.
          'rules', coalesce((select jsonb_agg(jsonb_build_object('position', r.position, 'name', r.name, 'class', r.class, 'match', r.match,
              'kinds', to_jsonb(r.kinds), 'enabled', r.enabled,
              'conditions', coalesce((select jsonb_agg(jsonb_build_object('field', c.field, 'operator', c.operator, 'value', c.value,
                  'value2', c.value2, 'values', to_jsonb(c."values"), 'case_sensitive', c.case_sensitive) order by c.position)
                from public.policy_conditions c where c.rule_id = r.id), '[]'::jsonb),
              'owner', r.owner, 'business_purpose', r.business_purpose, 'mitigating_controls', r.mitigating_controls,
              'risk_accepted_by', r.risk_accepted_by, 'review_by', r.review_by, 'alert_on_new', r.alert_on_new) order by r.position)
            from public.policy_rules r where r.policy_id = p.id), '[]'::jsonb))
          from public.policies p where p.id = v_pol),
      'scope_statement', (select s.scope_statement from public.scan_settings s where s.tenant_id = p_tenant_id),
      -- Only admins and operators get here, so the user names are always included.
      'users_masked', false
    )
  );
end;
$$;

-- p_generated_by: the user who asked for the package (the Edge Function runs as service_role, so auth.uid() is empty).
create function public.record_audit_report(p_tenant_id uuid, p_as_of timestamptz, p_scope_tag text, p_manifest jsonb,
  p_manifest_sha256 text, p_archive bytea, p_users_masked boolean, p_generated_by uuid default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.audit_reports (tenant_id, as_of, scope_tag, generated_by, manifest, manifest_sha256, archive, users_masked)
  values (p_tenant_id, p_as_of, p_scope_tag, p_generated_by, p_manifest, p_manifest_sha256, p_archive, p_users_masked)
  returning id into v_id;
  insert into public.audit_log (user_id, action, target, data)
  values (p_generated_by, 'audit_report', p_tenant_id::text,
    jsonb_build_object('id', v_id, 'as_of', p_as_of, 'scope_tag', p_scope_tag, 'manifest_sha256', p_manifest_sha256));
  return v_id;
end;
$$;

-- Only admins and operators of the report's tenant get the file; viewers read the metadata through v_audit_reports.
create function public.get_audit_report_archive(p_report_id uuid)
returns bytea
language sql
stable
security definer
set search_path = ''
as $$
  select a.archive
  from public.audit_reports a
  where a.id = p_report_id
    and exists (select 1 from public.my_tenant_roles() r where r.tenant_id = a.tenant_id and r.role in ('admin', 'operator'));
$$;

revoke all on function public.audit_reports_block_change() from public, anon, authenticated;
revoke all on function public.audit_report_data(uuid, timestamptz, text), public.get_audit_report_archive(uuid) from public, anon;
grant execute on function public.audit_report_data(uuid, timestamptz, text), public.get_audit_report_archive(uuid) to authenticated;
revoke all on function public.record_audit_report(uuid, timestamptz, text, jsonb, text, bytea, boolean, uuid) from public, anon, authenticated;
grant execute on function public.record_audit_report(uuid, timestamptz, text, jsonb, text, bytea, boolean, uuid) to service_role;
