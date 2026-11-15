-- Stage 3: end of life in the application policy. The field eol is true when the release of an installed version is
-- end of life; a change in the end-of-life results of a tenant makes its policy evaluate again.

alter table public.eol_eval_state add column changed_at timestamptz;

-- eol_replace (20261116100000) plus change detection: changed_at moves only when the stored results differ.
create or replace function public.eol_replace(p_tenant_id uuid, p_titles jsonb, p_computers jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_titles integer;
  v_computers integer;
  v_before text;
  v_after text;
begin
  select md5(coalesce((select string_agg(t.title_id::text || '|' || t.version || '|' || t.status, ',' order by t.title_id, t.version)
                       from public.title_version_eol t where t.tenant_id = p_tenant_id), '')
       || '#' || coalesce((select string_agg(c.id::text || '|' || c.os_eol_status, ',' order by c.id)
                       from public.computers c where c.tenant_id = p_tenant_id and c.os_eol_status is not null), ''))
  into v_before;

  delete from public.title_version_eol where tenant_id = p_tenant_id;
  insert into public.title_version_eol (tenant_id, title_id, version, product_key, release, eol_from, status)
  select p_tenant_id, (e ->> 'title_id')::uuid, coalesce(e ->> 'version', ''), e ->> 'product_key', e ->> 'release', (e ->> 'eol_from')::date, e ->> 'status'
  from jsonb_array_elements(coalesce(p_titles, '[]')) e;
  get diagnostics v_titles = row_count;

  update public.computers c set os_eol_release = null, os_eol_from = null, os_eol_status = null
  where c.tenant_id = p_tenant_id
    and c.id not in (select (e ->> 'computer_id')::uuid from jsonb_array_elements(coalesce(p_computers, '[]')) e);
  update public.computers c set os_eol_release = x.release, os_eol_from = x.eol_from, os_eol_status = x.status
  from (select (e ->> 'computer_id')::uuid as id, e ->> 'release' as release, (e ->> 'eol_from')::date as eol_from, e ->> 'status' as status
        from jsonb_array_elements(coalesce(p_computers, '[]')) e) x
  where c.id = x.id and c.tenant_id = p_tenant_id;
  get diagnostics v_computers = row_count;

  select md5(coalesce((select string_agg(t.title_id::text || '|' || t.version || '|' || t.status, ',' order by t.title_id, t.version)
                       from public.title_version_eol t where t.tenant_id = p_tenant_id), '')
       || '#' || coalesce((select string_agg(c.id::text || '|' || c.os_eol_status, ',' order by c.id)
                       from public.computers c where c.tenant_id = p_tenant_id and c.os_eol_status is not null), ''))
  into v_after;

  insert into public.eol_eval_state (tenant_id, evaluated_at, changed_at)
  values (p_tenant_id, now(), case when v_before is distinct from v_after then clock_timestamp() end)
  on conflict (tenant_id) do update set evaluated_at = now(),
    changed_at = case when v_before is distinct from v_after then clock_timestamp() else public.eol_eval_state.changed_at end;
  return jsonb_build_object('titles', v_titles, 'computers', v_computers);
end;
$$;

alter table public.policy_conditions drop constraint policy_conditions_check;
alter table public.policy_conditions add constraint policy_conditions_check check (case
  when field in ('category', 'subcategory') then operator in ('equals', 'not_equals', 'in', 'not_in')
  when field = 'version' then operator in ('equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'between', 'regex')
  when field in ('cvss', 'epss') then operator in ('equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'between')
  when field in ('kev', 'eol') then operator in ('equals', 'not_equals')
  else operator in ('equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'regex', 'in', 'not_in')
end);

-- Whether the installed (title, version) is end of life.
create or replace function public.title_version_eol_input(p_tenant_id uuid, p_title_id uuid, p_version text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.title_version_eol e
    where e.tenant_id = p_tenant_id and e.title_id = p_title_id and e.version = coalesce(p_version, '') and e.status = 'eol');
$$;
revoke all on function public.title_version_eol_input(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.title_version_eol_input(uuid, uuid, text) to service_role;

drop function public.policy_eval_inputs(uuid, boolean, uuid, text, integer);
create function public.policy_eval_inputs(
  p_tenant_id uuid,
  p_only_new boolean default true,
  p_after_title uuid default null,
  p_after_version text default null,
  p_limit integer default 1000
)
returns table (
  title_id uuid, version text, kind public.title_kind, name text, vendor text, external_id text,
  category_slug text, category_name text, subcategory_slug text, subcategory_name text,
  max_cvss numeric, kev boolean, max_epss numeric, eol boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with pub as (
    select p.version from public.policies p where p.tenant_id = p_tenant_id and p.status = 'published'
  ),
  pairs as (
    select distinct i.title_id, coalesce(i.version, '') as version
    from public.installations i
    join public.computers c on c.id = i.computer_id and c.retired_at is null
    where i.tenant_id = p_tenant_id and i.valid_to is null
  )
  select p.title_id, p.version, t.kind, t.canonical_name, t.vendor, t.external_id,
    cat.parent_slug, tc.level1_name, tc.category_slug, tc.level2_name,
    vi.max_cvss, vi.kev, vi.max_epss, public.title_version_eol_input(p_tenant_id, p.title_id, p.version)
  from pairs p
  join public.software_titles t on t.id = p.title_id
  left join public.title_classification tc on tc.title_id = t.id
  left join public.categories_cache cat on cat.slug = tc.category_slug
  cross join lateral public.title_version_vuln_inputs(p_tenant_id, p.title_id, p.version) vi
  where exists (select 1 from pub)
    and (p_after_title is null or (p.title_id, p.version) > (p_after_title, coalesce(p_after_version, '')))
    and (not p_only_new or not exists (
      select 1 from public.title_version_policy v
      where v.tenant_id = p_tenant_id and v.title_id = p.title_id and v.version = p.version
        and v.policy_version = (select pub.version from pub)))
  order by p.title_id, p.version
  limit least(greatest(p_limit, 1), 5000);
$$;
revoke all on function public.policy_eval_inputs(uuid, boolean, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.policy_eval_inputs(uuid, boolean, uuid, text, integer) to service_role;

drop function public.policy_preview_inputs(uuid);
create function public.policy_preview_inputs(p_tenant_id uuid)
returns table (
  title_id uuid, version text, kind public.title_kind, name text, vendor text, external_id text,
  category_slug text, category_name text, subcategory_slug text, subcategory_name text,
  computers bigint, installations bigint, current_class public.policy_class, current_rule_id uuid,
  max_cvss numeric, kev boolean, max_epss numeric, eol boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with pairs as (
    select i.title_id, coalesce(i.version, '') as version, count(distinct i.computer_id) as computers, count(*) as installations
    from public.installations i
    join public.computers c on c.id = i.computer_id and c.retired_at is null
    where i.tenant_id = p_tenant_id and i.valid_to is null
      and exists (select 1 from public.my_tenant_roles() r where r.tenant_id = p_tenant_id)
    group by i.title_id, coalesce(i.version, '')
  )
  select p.title_id, p.version, t.kind, t.canonical_name, t.vendor, t.external_id,
    cat.parent_slug, tc.level1_name, tc.category_slug, tc.level2_name,
    p.computers, p.installations, v.class, v.rule_id,
    vi.max_cvss, vi.kev, vi.max_epss, public.title_version_eol_input(p_tenant_id, p.title_id, p.version)
  from pairs p
  join public.software_titles t on t.id = p.title_id
  left join public.title_classification tc on tc.title_id = t.id
  left join public.categories_cache cat on cat.slug = tc.category_slug
  left join public.title_version_policy v on v.tenant_id = p_tenant_id and v.title_id = p.title_id and v.version = p.version
  cross join lateral public.title_version_vuln_inputs(p_tenant_id, p.title_id, p.version) vi
  order by p.computers desc, t.canonical_name, p.version
  limit 20001;
$$;
revoke all on function public.policy_preview_inputs(uuid) from public, anon;
grant execute on function public.policy_preview_inputs(uuid) to authenticated;

-- A vulnerability or end-of-life run that changed something makes the policy evaluate the tenant fully again.
create or replace function public.policy_due_tenants()
returns table (tenant_id uuid, policy_id uuid, full_run boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.tenant_id, p.id,
    p.evaluated_at is null
      or p.evaluated_at < coalesce((select m.at from public.maintenance_state m where m.key = 'dictionary_changed'), '-infinity')
      or p.evaluated_at < coalesce((select s.changed_at from public.vuln_eval_state s where s.tenant_id = p.tenant_id), '-infinity')
      or p.evaluated_at < coalesce((select e.changed_at from public.eol_eval_state e where e.tenant_id = p.tenant_id), '-infinity')
  from public.policies p
  where p.status = 'published';
$$;
