-- Phase 9: application policy (CIS Controls v8.1, Control 2).
--
-- Each tenant has an ordered list of rules that gives every installed (title, version) one policy
-- class. Rules run top down and the first match wins; when no rule matches, the policy's default class
-- applies. Classes are local to this app and never go to the Dictionary Hub.
--
-- The evaluation itself runs in TypeScript (supabase/functions/_shared/policy.ts), in the browser for
-- the editor preview and in the policy-evaluate Edge Function / collector for stored results, so the
-- two can never disagree. SQL stores the policy, validates what it can, and keeps the results.
--
-- Rules keep a lineage_id across policy versions: a draft copies the published rules with new ids and
-- the same lineage, so the UI and the edit RPCs address a rule by its lineage.

create type public.policy_class as enum ('core_system', 'sanctioned_app', 'tolerated_app', 'unsanctioned_app');
create type public.policy_field as enum ('vendor', 'name', 'category', 'subcategory', 'version', 'external_id');
create type public.policy_operator as enum (
  'equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'regex', 'in', 'not_in',
  'gt', 'gte', 'lt', 'lte', 'between'
);
create type public.policy_status as enum ('draft', 'published', 'archived');
create type public.rule_match as enum ('all', 'any');

-- Tables ------------------------------------------------------------------------------------------

create table public.policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  version integer not null check (version > 0),
  status public.policy_status not null default 'draft',
  default_class public.policy_class not null default 'unsanctioned_app',
  note text check (char_length(note) <= 1000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  published_by uuid references auth.users (id) on delete set null,
  published_at timestamptz,
  -- Last complete evaluation of every current (title, version); null = due.
  evaluated_at timestamptz,
  unique (tenant_id, version)
);

create unique index policies_one_draft_idx on public.policies (tenant_id) where status = 'draft';
create unique index policies_one_published_idx on public.policies (tenant_id) where status = 'published';

create table public.policy_rules (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies (id) on delete cascade,
  lineage_id uuid not null default gen_random_uuid(),
  position integer not null check (position > 0),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  class public.policy_class not null,
  match public.rule_match not null default 'all',
  kinds public.title_kind[] not null check (cardinality(kinds) > 0),
  enabled boolean not null default true,
  owner text check (char_length(owner) <= 200),
  business_purpose text check (char_length(business_purpose) <= 1000),
  mitigating_controls text check (char_length(mitigating_controls) <= 1000),
  risk_accepted_by text check (char_length(risk_accepted_by) <= 200),
  review_by date,
  alert_on_new boolean not null default false,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Deferred so a reorder can rewrite positions inside one transaction.
  constraint policy_rules_position_key unique (policy_id, position) deferrable initially deferred,
  unique (policy_id, lineage_id)
);

create index policy_rules_lineage_idx on public.policy_rules (lineage_id);

create table public.policy_conditions (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.policy_rules (id) on delete cascade,
  position integer not null check (position > 0),
  field public.policy_field not null,
  operator public.policy_operator not null,
  value text check (char_length(value) <= 1000),
  value2 text check (char_length(value2) <= 200),
  "values" text[] check (cardinality("values") <= 200),
  case_sensitive boolean not null default false,
  unique (rule_id, position),
  -- Operators per field type (same table as OPERATORS_BY_TYPE in _shared/policy.ts).
  check (case
    when field in ('category', 'subcategory') then operator in ('equals', 'not_equals', 'in', 'not_in')
    when field = 'version' then operator in ('equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'between', 'regex')
    else operator in ('equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'regex', 'in', 'not_in')
  end),
  -- Every operator needs its value(s). The regex itself is compiled and checked in TypeScript.
  check (case
    when operator in ('in', 'not_in') then coalesce(cardinality("values"), 0) > 0 or btrim(coalesce(value, '')) <> ''
    when operator = 'between' then btrim(coalesce(value, '')) <> '' and btrim(coalesce(value2, '')) <> ''
    else btrim(coalesce(value, '')) <> ''
  end),
  check (operator <> 'regex' or char_length(value) <= 200)
);

-- The class of each installed (title, version) under the tenant's published policy. version '' = the
-- installation reports no version. rule_id null = the default class applied.
create table public.title_version_policy (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  title_id uuid not null references public.software_titles (id) on delete cascade,
  version text not null default '',
  policy_version integer not null,
  class public.policy_class not null,
  rule_id uuid references public.policy_rules (id) on delete set null,
  evaluated_at timestamptz not null default now(),
  primary key (tenant_id, title_id, version)
);

create index title_version_policy_class_idx on public.title_version_policy (tenant_id, class);

create table public.policy_class_changes (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  title_id uuid not null references public.software_titles (id) on delete cascade,
  version text not null,
  from_class public.policy_class not null,
  to_class public.policy_class not null,
  policy_version integer not null,
  rule_id uuid references public.policy_rules (id) on delete set null,
  changed_at timestamptz not null default now()
);

create index policy_class_changes_tenant_idx on public.policy_class_changes (tenant_id, changed_at desc);
create index policy_class_changes_title_idx on public.policy_class_changes (title_id, changed_at desc);

-- RLS: every member of the tenant reads; nobody writes directly. Admins change policies through the
-- RPCs below (one transaction each, audited); results are written by the service role.
alter table public.policies enable row level security;
alter table public.policy_rules enable row level security;
alter table public.policy_conditions enable row level security;
alter table public.title_version_policy enable row level security;
alter table public.policy_class_changes enable row level security;

create policy "Tenant members read policies"
  on public.policies for select to authenticated
  using (tenant_id in (select r.tenant_id from public.my_tenant_roles() r));

create policy "Tenant members read policy rules"
  on public.policy_rules for select to authenticated
  using (policy_id in (select p.id from public.policies p where p.tenant_id in (select r.tenant_id from public.my_tenant_roles() r)));

create policy "Tenant members read policy conditions"
  on public.policy_conditions for select to authenticated
  using (rule_id in (
    select pr.id from public.policy_rules pr
    join public.policies p on p.id = pr.policy_id
    where p.tenant_id in (select r.tenant_id from public.my_tenant_roles() r)));

create policy "Tenant members read title classes"
  on public.title_version_policy for select to authenticated
  using (tenant_id in (select r.tenant_id from public.my_tenant_roles() r));

create policy "Tenant members read class changes"
  on public.policy_class_changes for select to authenticated
  using (tenant_id in (select r.tenant_id from public.my_tenant_roles() r));

revoke all on table public.policies, public.policy_rules, public.policy_conditions, public.title_version_policy,
  public.policy_class_changes from anon, authenticated;
grant select on table public.policies, public.policy_rules, public.policy_conditions, public.title_version_policy,
  public.policy_class_changes to authenticated;

alter table public.alerts drop constraint alerts_kind_check;
alter table public.alerts add constraint alerts_kind_check
  check (kind in ('coverage_low', 'query_error', 'collector_stale', 'test', 'policy_unsanctioned'));

-- Views -------------------------------------------------------------------------------------------

-- One row per tenant and currently installed title: the most restrictive class among its installed
-- versions (the enum order is core < sanctioned < tolerated < unsanctioned), the rule behind it, and
-- whether versions differ. Titles not evaluated yet have no row.
create view public.title_policy
with (security_barrier = true)
as
select
  p.tenant_id,
  p.title_id,
  max(p.class) as class,
  (array_agg(p.rule_id order by p.class desc, p.version))[1] as rule_id,
  count(distinct p.class) > 1 as mixed_versions
from (
  select distinct i.tenant_id, i.title_id, v.version, v.class, v.rule_id
  from public.installations i
  join public.computers c on c.id = i.computer_id and c.retired_at is null
  join public.title_version_policy v
    on v.tenant_id = i.tenant_id and v.title_id = i.title_id and v.version = coalesce(i.version, '')
  where i.valid_to is null
    and i.tenant_id in (select r.tenant_id from public.my_tenant_roles() r)
) p
group by p.tenant_id, p.title_id;

create view public.v_policy_class_changes
with (security_barrier = true)
as
select
  ch.id, ch.tenant_id, ch.title_id, t.kind, t.source, t.canonical_name, t.vendor, t.external_id,
  ch.version, ch.from_class, ch.to_class, ch.policy_version, pr.name as rule_name, pr.lineage_id as rule_lineage_id,
  ch.changed_at
from public.policy_class_changes ch
join public.my_tenant_roles() r on r.tenant_id = ch.tenant_id
join public.software_titles t on t.id = ch.title_id
left join public.policy_rules pr on pr.id = ch.rule_id;

-- v_installation_details gains the class of the installation's (title, version) at the end.
create or replace view public.v_installation_details
with (security_barrier = true)
as
select
  vi.*,
  t.kind, t.source, t.canonical_name, t.vendor, t.external_id,
  tc.category_slug, tc.level1_name, tc.level2_name, tc.attention_level, tc.origin, tc.method, tc.confidence,
  c.hostname, c.platform,
  tvp.class as policy_class
from public.v_installations vi
join public.software_titles t on t.id = vi.title_id
join public.computers c on c.id = vi.computer_id
left join public.title_classification tc on tc.title_id = t.id
left join public.title_version_policy tvp
  on tvp.tenant_id = vi.tenant_id and tvp.title_id = vi.title_id and tvp.version = coalesce(vi.version, '');

revoke all on table public.title_policy, public.v_policy_class_changes from anon, authenticated;
grant select on table public.title_policy, public.v_policy_class_changes to authenticated;

-- Helpers -----------------------------------------------------------------------------------------

create or replace function public.policy_require_admin(p_tenant_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_tenant_id is null or not exists (
    select 1 from public.my_tenant_roles() r where r.tenant_id = p_tenant_id and r.role = 'admin'
  ) then
    raise exception 'Only admins of this tenant can change its application policy' using errcode = '42501';
  end if;
end;
$$;

-- One policy with its rules and conditions, as the UI and the evaluator read it.
create or replace function public.policy_json(p_policy_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'tenant_id', p.tenant_id, 'version', p.version, 'status', p.status, 'default_class', p.default_class,
    'note', p.note, 'created_at', p.created_at, 'published_at', p.published_at, 'evaluated_at', p.evaluated_at,
    'published_by', (select pf.email from public.profiles pf where pf.id = p.published_by),
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'lineage_id', r.lineage_id, 'position', r.position, 'name', r.name, 'class', r.class, 'match', r.match,
        'kinds', to_jsonb(r.kinds), 'enabled', r.enabled, 'owner', r.owner, 'business_purpose', r.business_purpose,
        'mitigating_controls', r.mitigating_controls, 'risk_accepted_by', r.risk_accepted_by, 'review_by', r.review_by,
        'alert_on_new', r.alert_on_new, 'updated_at', r.updated_at,
        'conditions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'field', c.field, 'operator', c.operator, 'value', c.value, 'value2', c.value2, 'values', to_jsonb(c."values"),
            'case_sensitive', c.case_sensitive) order by c.position)
          from public.policy_conditions c where c.rule_id = r.id), '[]'::jsonb)
      ) order by r.position)
      from public.policy_rules r where r.policy_id = p.id), '[]'::jsonb)
  )
  from public.policies p
  where p.id = p_policy_id;
$$;

-- The tenant's draft, created from the published policy (or empty) when there is none.
create or replace function public.policy_ensure_draft(p_tenant_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_draft uuid;
  v_published public.policies;
  v_version integer;
begin
  perform public.policy_require_admin(p_tenant_id);
  -- Serialize draft creation per tenant.
  perform 1 from public.tenants where id = p_tenant_id for update;

  select id into v_draft from public.policies where tenant_id = p_tenant_id and status = 'draft';
  if v_draft is not null then
    return v_draft;
  end if;

  select * into v_published from public.policies where tenant_id = p_tenant_id and status = 'published';
  select coalesce(max(version), 0) + 1 into v_version from public.policies where tenant_id = p_tenant_id;

  insert into public.policies (tenant_id, version, status, default_class, note)
  values (p_tenant_id, v_version, 'draft', coalesce(v_published.default_class, 'unsanctioned_app'), v_published.note)
  returning id into v_draft;

  if v_published.id is not null then
    insert into public.policy_rules (policy_id, lineage_id, position, name, class, match, kinds, enabled, owner, business_purpose,
                                     mitigating_controls, risk_accepted_by, review_by, alert_on_new, created_by, created_at, updated_at)
    select v_draft, r.lineage_id, r.position, r.name, r.class, r.match, r.kinds, r.enabled, r.owner, r.business_purpose,
      r.mitigating_controls, r.risk_accepted_by, r.review_by, r.alert_on_new, r.created_by, r.created_at, r.updated_at
    from public.policy_rules r where r.policy_id = v_published.id;

    insert into public.policy_conditions (rule_id, position, field, operator, value, value2, "values", case_sensitive)
    select nr.id, c.position, c.field, c.operator, c.value, c.value2, c."values", c.case_sensitive
    from public.policy_conditions c
    join public.policy_rules r on r.id = c.rule_id and r.policy_id = v_published.id
    join public.policy_rules nr on nr.policy_id = v_draft and nr.lineage_id = r.lineage_id;
  end if;
  return v_draft;
end;
$$;

-- Moves a draft rule to a position (1..n), shifting the rules in between.
create or replace function public.policy_place_rule(p_draft uuid, p_rule_id uuid, p_position integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_old integer;
  v_max integer;
  v_new integer;
begin
  select position into v_old from public.policy_rules where id = p_rule_id and policy_id = p_draft;
  select count(*) into v_max from public.policy_rules where policy_id = p_draft;
  v_new := least(greatest(coalesce(p_position, v_old), 1), v_max);
  if v_new < v_old then
    update public.policy_rules set position = position + 1 where policy_id = p_draft and position >= v_new and position < v_old;
  elsif v_new > v_old then
    update public.policy_rules set position = position - 1 where policy_id = p_draft and position > v_old and position <= v_new;
  end if;
  update public.policy_rules set position = v_new where id = p_rule_id;
  return v_new;
end;
$$;

-- Reads -------------------------------------------------------------------------------------------

-- The published policy, the draft and the version list of one tenant, and whether the caller may edit.
create or replace function public.policy_get(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not exists (select 1 from public.my_tenant_roles() r where r.tenant_id = p_tenant_id) then null
  else jsonb_build_object(
    'published', (select public.policy_json(p.id) from public.policies p where p.tenant_id = p_tenant_id and p.status = 'published'),
    'draft', (select public.policy_json(p.id) from public.policies p where p.tenant_id = p_tenant_id and p.status = 'draft'),
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object('version', p.version, 'status', p.status, 'published_at', p.published_at,
        'published_by', (select pf.email from public.profiles pf where pf.id = p.published_by)) order by p.version desc)
      from public.policies p where p.tenant_id = p_tenant_id), '[]'::jsonb),
    'can_edit', exists (select 1 from public.my_tenant_roles() r where r.tenant_id = p_tenant_id and r.role = 'admin')
  ) end;
$$;

-- One rule across the policy versions (newest first), for the rule editor's history.
create or replace function public.policy_rule_history(p_tenant_id uuid, p_lineage_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'version', p.version, 'status', p.status, 'published_at', p.published_at,
      'published_by', (select pf.email from public.profiles pf where pf.id = p.published_by),
      'position', r.position, 'name', r.name, 'class', r.class, 'enabled', r.enabled, 'updated_at', r.updated_at
    ) order by p.version desc), '[]'::jsonb)
  from public.policy_rules r
  join public.policies p on p.id = r.policy_id
  where r.lineage_id = p_lineage_id and p.tenant_id = p_tenant_id
    and exists (select 1 from public.my_tenant_roles() m where m.tenant_id = p_tenant_id);
$$;

-- Classification inputs of the tenant's current (title, version) pairs, with computer and
-- installation counts and the stored class, for the editor preview and the title tester. Capped at
-- 20,001 rows: the caller shows "preview not available" above 20,000.
create or replace function public.policy_preview_inputs(p_tenant_id uuid)
returns table (
  title_id uuid, version text, kind public.title_kind, name text, vendor text, external_id text,
  category_slug text, category_name text, subcategory_slug text, subcategory_name text,
  computers bigint, installations bigint, current_class public.policy_class, current_rule_id uuid
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
    p.computers, p.installations, v.class, v.rule_id
  from pairs p
  join public.software_titles t on t.id = p.title_id
  left join public.title_classification tc on tc.title_id = t.id
  left join public.categories_cache cat on cat.slug = tc.category_slug
  left join public.title_version_policy v on v.tenant_id = p_tenant_id and v.title_id = p.title_id and v.version = p.version
  order by p.computers desc, t.canonical_name, p.version
  limit 20001;
$$;

-- Dashboard and class cards: counts per class (titles by their most restrictive version, and
-- installations), the unsanctioned footprint, titles left to the default class, and tolerated rules
-- whose review is overdue or due within 30 days. p_tenant_id null = every visible tenant.
create or replace function public.policy_overview(p_tenant_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with vis as (
    select r.tenant_id from public.my_tenant_roles() r where p_tenant_id is null or r.tenant_id = p_tenant_id
  ),
  inst as (
    select i.tenant_id, i.title_id, i.computer_id, v.class, v.rule_id
    from public.installations i
    join vis on vis.tenant_id = i.tenant_id
    join public.computers c on c.id = i.computer_id and c.retired_at is null
    left join public.title_version_policy v
      on v.tenant_id = i.tenant_id and v.title_id = i.title_id and v.version = coalesce(i.version, '')
    where i.valid_to is null
  ),
  titles as (
    select tenant_id, title_id, max(class) as class, (array_agg(rule_id order by class desc nulls last))[1] as rule_id
    from inst group by tenant_id, title_id
  ),
  classes as (
    select k.class,
      (select count(*) from titles t where t.class = k.class) as titles,
      (select count(*) from inst i where i.class = k.class) as installations
    from unnest(enum_range(null::public.policy_class)) as k (class)
  ),
  exceptions as (
    select p.tenant_id, r.lineage_id, r.name, r.owner, r.review_by, r.review_by < current_date as overdue
    from public.policies p
    join vis on vis.tenant_id = p.tenant_id
    join public.policy_rules r on r.policy_id = p.id
    where p.status = 'published' and r.class = 'tolerated_app' and r.enabled
      and (r.review_by is null or r.review_by < current_date + 30)
  )
  select jsonb_build_object(
    'classes', (select jsonb_agg(jsonb_build_object('class', c.class, 'titles', c.titles, 'installations', c.installations) order by c.class) from classes c),
    'total_titles', (select count(*) from titles),
    'total_installations', (select count(*) from inst),
    'not_evaluated_titles', (select count(*) from titles where class is null),
    'default_titles', (select count(*) from titles where class is not null and rule_id is null),
    'unsanctioned_installations', (select count(*) from inst where class = 'unsanctioned_app'),
    'unsanctioned_computers', (select count(distinct computer_id) from inst where class = 'unsanctioned_app'),
    'exceptions', coalesce((select jsonb_agg(to_jsonb(e) order by e.review_by nulls first, e.name) from exceptions e), '[]'::jsonb),
    'published', (
      select jsonb_build_object('version', p.version, 'published_at', p.published_at, 'evaluated_at', p.evaluated_at,
        'default_class', p.default_class, 'published_by', (select pf.email from public.profiles pf where pf.id = p.published_by))
      from public.policies p where p_tenant_id is not null and p.tenant_id = p_tenant_id and p.status = 'published'
        and exists (select 1 from vis))
  );
$$;

-- Draft edits (admins of the tenant) -------------------------------------------------------------

-- Inserts (lineage_id null) or updates a draft rule with its conditions. Returns the lineage id.
-- p_rule: { lineage_id?, position?, name, class, match, kinds[], enabled, owner, business_purpose,
-- mitigating_controls, risk_accepted_by, review_by, alert_on_new, conditions: [{ field, operator,
-- value, value2, values[], case_sensitive }] }
create or replace function public.policy_save_rule(p_tenant_id uuid, p_rule jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_draft uuid;
  v_version integer;
  v_lineage uuid := nullif(p_rule ->> 'lineage_id', '')::uuid;
  v_position integer := nullif(p_rule ->> 'position', '')::integer;
  v_rule_id uuid;
  v_max integer;
  v_new boolean := false;
begin
  v_draft := public.policy_ensure_draft(p_tenant_id);
  select version into v_version from public.policies where id = v_draft;
  if jsonb_array_length(coalesce(p_rule -> 'conditions', '[]')) = 0 then
    raise exception 'A rule needs at least one condition' using errcode = '22023';
  end if;

  if v_lineage is not null then
    select id into v_rule_id from public.policy_rules where policy_id = v_draft and lineage_id = v_lineage;
    if v_rule_id is null then
      raise exception 'Rule % is not in the draft', v_lineage using errcode = 'P0002';
    end if;
    update public.policy_rules set
      name = btrim(p_rule ->> 'name'),
      class = (p_rule ->> 'class')::public.policy_class,
      match = coalesce(nullif(p_rule ->> 'match', ''), 'all')::public.rule_match,
      kinds = array(select jsonb_array_elements_text(coalesce(p_rule -> 'kinds', '[]'))::public.title_kind),
      enabled = coalesce((p_rule ->> 'enabled')::boolean, true),
      owner = nullif(btrim(p_rule ->> 'owner'), ''),
      business_purpose = nullif(btrim(p_rule ->> 'business_purpose'), ''),
      mitigating_controls = nullif(btrim(p_rule ->> 'mitigating_controls'), ''),
      risk_accepted_by = nullif(btrim(p_rule ->> 'risk_accepted_by'), ''),
      review_by = nullif(p_rule ->> 'review_by', '')::date,
      alert_on_new = coalesce((p_rule ->> 'alert_on_new')::boolean, false),
      updated_at = now()
    where id = v_rule_id;
    delete from public.policy_conditions where rule_id = v_rule_id;
  else
    v_new := true;
    select count(*) into v_max from public.policy_rules where policy_id = v_draft;
    v_position := least(greatest(coalesce(v_position, v_max + 1), 1), v_max + 1);
    update public.policy_rules set position = position + 1 where policy_id = v_draft and position >= v_position;
    insert into public.policy_rules (policy_id, position, name, class, match, kinds, enabled, owner, business_purpose,
                                     mitigating_controls, risk_accepted_by, review_by, alert_on_new)
    values (v_draft, v_position, btrim(p_rule ->> 'name'), (p_rule ->> 'class')::public.policy_class,
      coalesce(nullif(p_rule ->> 'match', ''), 'all')::public.rule_match,
      array(select jsonb_array_elements_text(coalesce(p_rule -> 'kinds', '[]'))::public.title_kind),
      coalesce((p_rule ->> 'enabled')::boolean, true), nullif(btrim(p_rule ->> 'owner'), ''),
      nullif(btrim(p_rule ->> 'business_purpose'), ''), nullif(btrim(p_rule ->> 'mitigating_controls'), ''),
      nullif(btrim(p_rule ->> 'risk_accepted_by'), ''), nullif(p_rule ->> 'review_by', '')::date,
      coalesce((p_rule ->> 'alert_on_new')::boolean, false))
    returning id, lineage_id into v_rule_id, v_lineage;
  end if;

  insert into public.policy_conditions (rule_id, position, field, operator, value, value2, "values", case_sensitive)
  select v_rule_id, c.ord, (c.item ->> 'field')::public.policy_field, (c.item ->> 'operator')::public.policy_operator,
    nullif(c.item ->> 'value', ''), nullif(c.item ->> 'value2', ''),
    case when jsonb_typeof(c.item -> 'values') = 'array' and jsonb_array_length(c.item -> 'values') > 0
      then array(select btrim(x) from jsonb_array_elements_text(c.item -> 'values') x where btrim(x) <> '') end,
    coalesce((c.item ->> 'case_sensitive')::boolean, false)
  from jsonb_array_elements(p_rule -> 'conditions') with ordinality as c (item, ord);

  if not v_new and v_position is not null then
    perform public.policy_place_rule(v_draft, v_rule_id, v_position);
  end if;

  insert into public.audit_log (user_id, action, target, data)
  values (auth.uid(), case when v_new then 'policy rule added' else 'policy rule changed' end, 'policy_rules',
    jsonb_build_object('tenant_id', p_tenant_id, 'version', v_version, 'lineage_id', v_lineage,
      'name', btrim(p_rule ->> 'name'), 'class', p_rule ->> 'class'));
  return v_lineage;
end;
$$;

create or replace function public.policy_move_rule(p_tenant_id uuid, p_lineage_id uuid, p_position integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_draft uuid := public.policy_ensure_draft(p_tenant_id);
  v_rule public.policy_rules;
  v_new integer;
begin
  select * into v_rule from public.policy_rules where policy_id = v_draft and lineage_id = p_lineage_id;
  if v_rule.id is null then
    raise exception 'Rule % is not in the draft', p_lineage_id using errcode = 'P0002';
  end if;
  v_new := public.policy_place_rule(v_draft, v_rule.id, p_position);
  if v_new <> v_rule.position then
    insert into public.audit_log (user_id, action, target, data)
    values (auth.uid(), 'policy rule moved', 'policy_rules',
      jsonb_build_object('tenant_id', p_tenant_id, 'lineage_id', p_lineage_id, 'name', v_rule.name, 'from', v_rule.position, 'to', v_new));
  end if;
  return v_new;
end;
$$;

create or replace function public.policy_set_rule_enabled(p_tenant_id uuid, p_lineage_id uuid, p_enabled boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_draft uuid := public.policy_ensure_draft(p_tenant_id);
  v_name text;
begin
  update public.policy_rules set enabled = p_enabled, updated_at = now()
  where policy_id = v_draft and lineage_id = p_lineage_id
  returning name into v_name;
  if v_name is null then
    raise exception 'Rule % is not in the draft', p_lineage_id using errcode = 'P0002';
  end if;
  insert into public.audit_log (user_id, action, target, data)
  values (auth.uid(), case when p_enabled then 'policy rule enabled' else 'policy rule disabled' end, 'policy_rules',
    jsonb_build_object('tenant_id', p_tenant_id, 'lineage_id', p_lineage_id, 'name', v_name));
end;
$$;

create or replace function public.policy_delete_rule(p_tenant_id uuid, p_lineage_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_draft uuid := public.policy_ensure_draft(p_tenant_id);
  v_rule public.policy_rules;
begin
  delete from public.policy_rules where policy_id = v_draft and lineage_id = p_lineage_id returning * into v_rule;
  if v_rule.id is null then
    raise exception 'Rule % is not in the draft', p_lineage_id using errcode = 'P0002';
  end if;
  update public.policy_rules set position = position - 1 where policy_id = v_draft and position > v_rule.position;
  insert into public.audit_log (user_id, action, target, data)
  values (auth.uid(), 'policy rule deleted', 'policy_rules',
    jsonb_build_object('tenant_id', p_tenant_id, 'lineage_id', p_lineage_id, 'name', v_rule.name, 'position', v_rule.position));
end;
$$;

create or replace function public.policy_set_default_class(p_tenant_id uuid, p_class public.policy_class)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_draft uuid := public.policy_ensure_draft(p_tenant_id);
begin
  update public.policies set default_class = p_class where id = v_draft;
  insert into public.audit_log (user_id, action, target, data)
  values (auth.uid(), 'policy default class', 'policies', jsonb_build_object('tenant_id', p_tenant_id, 'class', p_class));
end;
$$;

create or replace function public.policy_discard_draft(p_tenant_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_version integer;
begin
  perform public.policy_require_admin(p_tenant_id);
  delete from public.policies where tenant_id = p_tenant_id and status = 'draft' returning version into v_version;
  if v_version is not null then
    insert into public.audit_log (user_id, action, target, data)
    values (auth.uid(), 'policy draft discarded', 'policies', jsonb_build_object('tenant_id', p_tenant_id, 'version', v_version));
  end if;
end;
$$;

-- Validates and publishes the draft; the old published version is archived. The caller then runs the
-- policy-evaluate Edge Function (evaluated_at stays null until that full evaluation finishes, so the
-- collector also picks it up).
create or replace function public.policy_publish(p_tenant_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_draft public.policies;
  v_errors text;
  v_rules integer;
begin
  perform public.policy_require_admin(p_tenant_id);
  select * into v_draft from public.policies where tenant_id = p_tenant_id and status = 'draft' for update;
  if v_draft.id is null then
    raise exception 'There is no draft to publish' using errcode = 'P0002';
  end if;

  select string_agg(format('rule %s (%s): %s', x.position, x.name, x.problem), '; ' order by x.position, x.problem)
  into v_errors
  from (
    select r.position, r.name, 'add at least one condition' as problem
    from public.policy_rules r
    where r.policy_id = v_draft.id and not exists (select 1 from public.policy_conditions c where c.rule_id = r.id)
    union all
    select r.position, r.name,
      'a tolerated rule needs an owner, a business purpose, mitigating controls, who accepted the risk and a review date'
    from public.policy_rules r
    where r.policy_id = v_draft.id and r.class = 'tolerated_app'
      and (r.owner is null or r.business_purpose is null or r.mitigating_controls is null or r.risk_accepted_by is null
           or r.review_by is null)
  ) x;
  if v_errors is not null then
    raise exception 'Cannot publish: %', v_errors using errcode = '22023';
  end if;

  update public.policies set status = 'archived' where tenant_id = p_tenant_id and status = 'published';
  update public.policies set status = 'published', published_by = auth.uid(), published_at = now(), evaluated_at = null
  where id = v_draft.id;

  select count(*) into v_rules from public.policy_rules where policy_id = v_draft.id;
  insert into public.audit_log (user_id, action, target, data)
  values (auth.uid(), 'policy published', 'policies',
    jsonb_build_object('tenant_id', p_tenant_id, 'version', v_draft.version, 'rules', v_rules, 'default_class', v_draft.default_class));
  return jsonb_build_object('policy_id', v_draft.id, 'version', v_draft.version);
end;
$$;

-- Server side (service role) ----------------------------------------------------------------------

-- Pages (keyset on title_id, version) through the tenant's current (title, version) pairs. With
-- p_only_new, only pairs without a class under the published version.
create or replace function public.policy_eval_inputs(
  p_tenant_id uuid,
  p_only_new boolean default true,
  p_after_title uuid default null,
  p_after_version text default null,
  p_limit integer default 1000
)
returns table (
  title_id uuid, version text, kind public.title_kind, name text, vendor text, external_id text,
  category_slug text, category_name text, subcategory_slug text, subcategory_name text
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
    cat.parent_slug, tc.level1_name, tc.category_slug, tc.level2_name
  from pairs p
  join public.software_titles t on t.id = p.title_id
  left join public.title_classification tc on tc.title_id = t.id
  left join public.categories_cache cat on cat.slug = tc.category_slug
  where exists (select 1 from pub)
    and (p_after_title is null or (p.title_id, p.version) > (p_after_title, coalesce(p_after_version, '')))
    and (not p_only_new or not exists (
      select 1 from public.title_version_policy v
      where v.tenant_id = p_tenant_id and v.title_id = p.title_id and v.version = p.version
        and v.policy_version = (select pub.version from pub)))
  order by p.title_id, p.version
  limit least(greatest(p_limit, 1), 5000);
$$;

-- Stores one page of results under the published policy p_policy_id: class changes for pairs whose
-- class changed, an alert for new unsanctioned pairs of rules with alert_on_new (when p_alert), then
-- the classes. Refuses when p_policy_id is no longer the published policy (a publish during the run).
-- p_results: [{ title_id, version, class, rule_id }]
create or replace function public.policy_store_results(p_tenant_id uuid, p_policy_id uuid, p_results jsonb, p_alert boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_policy public.policies;
  v_changed integer := 0;
  v_alerts integer := 0;
  v_stored integer := 0;
begin
  select * into v_policy from public.policies where id = p_policy_id and tenant_id = p_tenant_id and status = 'published';
  if v_policy.id is null then
    raise exception 'Policy % is not the published policy of this tenant', p_policy_id using errcode = '40001';
  end if;

  insert into public.policy_class_changes (tenant_id, title_id, version, from_class, to_class, policy_version, rule_id)
  select p_tenant_id, r.title_id, coalesce(r.version, ''), v.class, r.class, v_policy.version, r.rule_id
  from jsonb_to_recordset(p_results) as r (title_id uuid, version text, class public.policy_class, rule_id uuid)
  join public.title_version_policy v on v.tenant_id = p_tenant_id and v.title_id = r.title_id and v.version = coalesce(r.version, '')
  where v.class <> r.class;
  get diagnostics v_changed = row_count;

  if p_alert and exists (select 1 from public.alert_settings s where s.id = 1 and s.enabled) then
    insert into public.alerts (kind, dedupe_key, tenant_id, title, body, data)
    select 'policy_unsanctioned', 'policy:' || pr.lineage_id || ':' || r.title_id || ':' || coalesce(r.version, ''), p_tenant_id,
      format('Unsanctioned software in %s: %s', tn.name, t.canonical_name),
      format('%s %s was found and matches the rule "%s" (Unsanctioned) of policy version %s. Remove it or document an exception.',
        t.canonical_name, coalesce(nullif(r.version, ''), '(no version)'), pr.name, v_policy.version),
      jsonb_build_object('title_id', r.title_id, 'version', coalesce(r.version, ''), 'rule_lineage_id', pr.lineage_id,
        'policy_version', v_policy.version)
    from jsonb_to_recordset(p_results) as r (title_id uuid, version text, class public.policy_class, rule_id uuid)
    join public.policy_rules pr on pr.id = r.rule_id and pr.alert_on_new
    join public.software_titles t on t.id = r.title_id
    join public.tenants tn on tn.id = p_tenant_id
    left join public.title_version_policy v on v.tenant_id = p_tenant_id and v.title_id = r.title_id and v.version = coalesce(r.version, '')
    where r.class = 'unsanctioned_app' and (v.class is null or v.class <> 'unsanctioned_app')
    on conflict (dedupe_key) do nothing;
    get diagnostics v_alerts = row_count;
  end if;

  insert into public.title_version_policy (tenant_id, title_id, version, policy_version, class, rule_id, evaluated_at)
  select p_tenant_id, r.title_id, coalesce(r.version, ''), v_policy.version, r.class, r.rule_id, now()
  from jsonb_to_recordset(p_results) as r (title_id uuid, version text, class public.policy_class, rule_id uuid)
  on conflict (tenant_id, title_id, version) do update set
    policy_version = excluded.policy_version, class = excluded.class, rule_id = excluded.rule_id, evaluated_at = excluded.evaluated_at;
  get diagnostics v_stored = row_count;

  return jsonb_build_object('stored', v_stored, 'changed', v_changed, 'alerts', v_alerts);
end;
$$;

-- The published policy of a tenant for the evaluator (service role has no auth.uid() for policy_get).
create or replace function public.policy_published(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.policy_json(p.id) from public.policies p where p.tenant_id = p_tenant_id and p.status = 'published';
$$;

-- A full evaluation finished: the collector skips the tenant until the next publish or dictionary change.
create or replace function public.policy_evaluation_finished(p_policy_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.policies set evaluated_at = now() where id = p_policy_id and status = 'published';
$$;

-- Which tenants need an evaluation: full = never evaluated since publish, or the dictionary changed
-- since; otherwise only new (title, version) pairs.
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
  from public.policies p
  where p.status = 'published';
$$;

-- search_titles gains the Policy class filter and columns ----------------------------------------

drop function public.search_titles(uuid, text, public.title_kind, text, public.attention_level[], text, public.platform, text, text,
  timestamptz, text, boolean, integer, integer);

create or replace function public.search_titles(
  p_tenant_id uuid default null,
  p_query text default null,
  p_kind public.title_kind default null,
  p_category text default null,
  p_attention public.attention_level[] default null,
  p_source text default null,
  p_platform public.platform default null,
  p_user text default null,
  p_version_below text default null,
  p_as_of timestamptz default null,
  p_sort text default 'computers',
  p_desc boolean default true,
  p_limit integer default 25,
  p_offset integer default 0,
  p_policy public.policy_class[] default null
)
returns table (
  title_id uuid, kind public.title_kind, source text, canonical_name text, vendor text, external_id text,
  category_slug text, level1_name text, level2_name text, attention_level public.attention_level, origin text,
  method text, confidence numeric, computers bigint, versions bigint, latest_version text, first_seen timestamptz,
  policy_class public.policy_class, policy_rule_lineage_id uuid, policy_rule_name text, mixed_versions boolean,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with visible as (
    select r.tenant_id, r.role from public.my_tenant_roles() r
    where p_tenant_id is null or r.tenant_id = p_tenant_id
  ),
  matched as (
    select i.tenant_id, i.title_id, i.computer_id, i.version, i.valid_from
    from public.installations i
    join visible v on v.tenant_id = i.tenant_id
    join public.computers c on c.id = i.computer_id and c.retired_at is null
    where (case when p_as_of is null then i.valid_to is null
                else i.valid_from <= p_as_of and (i.valid_to is null or i.valid_to > p_as_of) end)
      and (p_platform is null or c.platform = p_platform)
      and (p_user is null or v.role = 'viewer' or lower(i.username) like '%' || lower(p_user) || '%')
      and (p_version_below is null or public.version_key(i.version) < public.version_key(p_version_below))
  ),
  grouped as (
    select
      t.id as title_id, t.kind, t.source, t.canonical_name, t.vendor, t.external_id,
      tc.category_slug, tc.level1_name, tc.level2_name, tc.attention_level, tc.origin, tc.method, tc.confidence,
      count(distinct m.computer_id) as computers,
      count(distinct m.version) as versions,
      (array_agg(m.version order by public.version_key(m.version) desc))[1] as latest_version,
      min(m.valid_from) as first_seen,
      max(tvp.class) as policy_class,
      (array_agg(tvp.rule_id order by tvp.class desc nulls last))[1] as policy_rule_id,
      count(distinct tvp.class) > 1 as mixed_versions
    from matched m
    join public.software_titles t on t.id = m.title_id
    left join public.title_classification tc on tc.title_id = t.id
    left join public.title_version_policy tvp
      on tvp.tenant_id = m.tenant_id and tvp.title_id = m.title_id and tvp.version = coalesce(m.version, '')
    where (p_kind is null or t.kind = p_kind)
      and (p_source is null or t.source = p_source)
      and (p_category is null or p_category = '' or exists (
        select 1 from unnest(string_to_array(p_category, ',')) as s (slug)
        where btrim(s.slug) <> '' and (tc.category_slug = btrim(s.slug) or tc.category_slug like btrim(s.slug) || '/%')))
      and (p_attention is null or tc.attention_level = any (p_attention))
      and (p_query is null or p_query = ''
           or t.canonical_name ilike '%' || p_query || '%'
           or t.vendor ilike '%' || p_query || '%'
           or t.external_id ilike '%' || p_query || '%')
    group by t.id, tc.category_slug, tc.level1_name, tc.level2_name, tc.attention_level, tc.origin, tc.method, tc.confidence
    having p_policy is null or cardinality(p_policy) = 0 or max(tvp.class) = any (p_policy)
  )
  select g.title_id, g.kind, g.source, g.canonical_name, g.vendor, g.external_id, g.category_slug, g.level1_name, g.level2_name,
    g.attention_level, g.origin, g.method, g.confidence, g.computers, g.versions, g.latest_version, g.first_seen,
    g.policy_class, pr.lineage_id, pr.name, g.mixed_versions,
    count(*) over () as total_count
  from grouped g
  left join public.policy_rules pr on pr.id = g.policy_rule_id
  order by
    case when p_sort = 'computers' and p_desc then g.computers end desc nulls last,
    case when p_sort = 'computers' and not p_desc then g.computers end asc nulls last,
    case when p_sort = 'versions' and p_desc then g.versions end desc nulls last,
    case when p_sort = 'versions' and not p_desc then g.versions end asc nulls last,
    case when p_sort = 'first_seen' and p_desc then g.first_seen end desc nulls last,
    case when p_sort = 'first_seen' and not p_desc then g.first_seen end asc nulls last,
    case when p_sort = 'canonical_name' and p_desc then lower(g.canonical_name) end desc,
    case when p_sort = 'canonical_name' and not p_desc then lower(g.canonical_name) end asc,
    lower(g.canonical_name), g.title_id
  limit least(greatest(p_limit, 1), 100001)
  offset greatest(p_offset, 0);
$$;

-- Grants ------------------------------------------------------------------------------------------

do $$
declare
  f text;
begin
  -- Internal helpers: only other SECURITY DEFINER functions call them.
  foreach f in array array['policy_require_admin(uuid)', 'policy_json(uuid)', 'policy_place_rule(uuid, uuid, integer)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;

  foreach f in array array[
    'policy_get(uuid)', 'policy_rule_history(uuid, uuid)', 'policy_preview_inputs(uuid)', 'policy_overview(uuid)',
    'policy_ensure_draft(uuid)', 'policy_save_rule(uuid, jsonb)', 'policy_move_rule(uuid, uuid, integer)',
    'policy_set_rule_enabled(uuid, uuid, boolean)', 'policy_delete_rule(uuid, uuid)',
    'policy_set_default_class(uuid, public.policy_class)', 'policy_discard_draft(uuid)', 'policy_publish(uuid)',
    'search_titles(uuid, text, public.title_kind, text, public.attention_level[], text, public.platform, text, text, timestamptz, text, boolean, integer, integer, public.policy_class[])'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;

  foreach f in array array[
    'policy_eval_inputs(uuid, boolean, uuid, text, integer)', 'policy_store_results(uuid, uuid, jsonb, boolean)',
    'policy_evaluation_finished(uuid)', 'policy_due_tenants()', 'policy_published(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;

-- export_csv: the software export takes the Policy class filter and adds a "Policy class" column.
create or replace function public.export_csv(p_dataset text, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f jsonb := coalesce(p_filters, '{}');
  v_tenant uuid := nullif(f ->> 'tenantId', '')::uuid;
  v_search text := nullif(btrim(coalesce(f ->> 'search', '')), '');
  v_as_of timestamptz := nullif(f ->> 'asOf', '')::timestamptz;
  v_header text;
  v_body text;
  v_count bigint;
  c_max constant integer := 100000;
begin
  if not public.can_contribute() then
    raise exception 'Only admins and operators can export' using errcode = '42501';
  end if;

  if p_dataset = 'computers' then
    v_header := 'Hostname,Tenant,Platform,OS,OS version,User,Last seen,Last collected,Cycle status,Programs,Extensions,Packages,Attention';
    select count(*), string_agg(line, E'\r\n' order by sort_key) into v_count, v_body
    from (
      select concat_ws(',',
          public.csv_field(c.hostname), public.csv_field(t.name), public.csv_field(c.platform::text), public.csv_field(c.os_name),
          public.csv_field(c.os_version), public.csv_field(c.associated_user), public.csv_time(c.last_seen_at),
          public.csv_time(c.last_collected_at), public.csv_field(c.cycle_status::text), c.programs, c.extensions, c.packages,
          public.csv_field(array_to_string(c.attention_level1_slugs, ' '))) as line,
        lower(c.hostname) || c.id::text as sort_key
      from public.v_computer_list c
      join public.tenants t on t.id = c.tenant_id
      where c.retired_at is null
        and (v_tenant is null or c.tenant_id = v_tenant)
        and (coalesce(f ->> 'status', 'all') = 'all' or c.cycle_status::text = f ->> 'status')
        and (nullif(f ->> 'platform', '') is null or c.platform::text = f ->> 'platform')
        and (nullif(f ->> 'category', '') is null or c.attention_level1_slugs @> array[f ->> 'category'])
        and (v_search is null or c.hostname ilike public.like_contains(v_search)
             or c.associated_user ilike public.like_contains(v_search) or c.os_name ilike public.like_contains(v_search))
      limit c_max + 1
    ) x;

  elsif p_dataset = 'software' then
    v_header := 'Title,Vendor,Kind,Source,ID,Category,Subcategory,Attention,Classification,Computers,Versions,Newest version,First seen,Policy class';
    select count(*), string_agg(line, E'\r\n' order by ord) into v_count, v_body
    from (
      select concat_ws(',',
          public.csv_field(s.canonical_name), public.csv_field(s.vendor), public.csv_field(s.kind::text), public.csv_field(s.source),
          public.csv_field(s.external_id), public.csv_field(s.level1_name), public.csv_field(s.level2_name),
          public.csv_field(s.attention_level::text), public.csv_field(s.origin), s.computers, s.versions,
          public.csv_field(s.latest_version), public.csv_time(s.first_seen), public.csv_field(s.policy_class::text)) as line,
        row_number() over () as ord
      from public.search_titles(
        p_tenant_id => v_tenant,
        p_query => nullif(btrim(coalesce(f ->> 'query', '')), ''),
        p_kind => nullif(f ->> 'kind', '')::public.title_kind,
        p_category => nullif(f ->> 'category', ''),
        p_attention => (select array_agg(a::public.attention_level) from jsonb_array_elements_text(coalesce(f -> 'attention', '[]')) a),
        p_source => nullif(f ->> 'source', ''),
        p_platform => nullif(f ->> 'platform', '')::public.platform,
        p_user => nullif(btrim(coalesce(f ->> 'user', '')), ''),
        p_version_below => nullif(btrim(coalesce(f ->> 'versionBelow', '')), ''),
        p_as_of => v_as_of,
        p_policy => (select array_agg(p::public.policy_class) from jsonb_array_elements_text(coalesce(f -> 'policy', '[]')) p),
        p_limit => c_max + 1
      ) s
    ) x;

  elsif p_dataset = 'title_computers' then
    if nullif(f ->> 'titleId', '') is null then
      raise exception 'titleId is required' using errcode = '22023';
    end if;
    v_header := 'Hostname,Platform,User,Version,Source,Path,Installed since';
    select count(*), string_agg(line, E'\r\n' order by sort_key) into v_count, v_body
    from (
      select concat_ws(',',
          public.csv_field(i.hostname), public.csv_field(i.platform::text), public.csv_field(i.username),
          public.csv_field(i.version), public.csv_field(i.source), public.csv_field(i.path), public.csv_time(i.valid_from)) as line,
        lower(coalesce(i.hostname, '')) || i.id::text as sort_key
      from public.v_installation_details i
      where i.title_id = (f ->> 'titleId')::uuid
        and (v_tenant is null or i.tenant_id = v_tenant)
        and (case when v_as_of is null then i.valid_to is null
                  else i.valid_from <= v_as_of and (i.valid_to is null or i.valid_to > v_as_of) end)
      limit c_max + 1
    ) x;

  elsif p_dataset = 'changes' then
    v_header := 'Detected,Hostname,Change,Kind,Title,ID,From version,To version,Category,Subcategory,Attention';
    select count(*), string_agg(line, E'\r\n' order by detected_at desc, id) into v_count, v_body
    from (
      select concat_ws(',',
          public.csv_time(e.detected_at), public.csv_field(e.hostname), public.csv_field(e.change::text), public.csv_field(e.kind::text),
          public.csv_field(e.canonical_name), public.csv_field(e.external_id), public.csv_field(e.from_version),
          public.csv_field(e.to_version), public.csv_field(e.level1_name), public.csv_field(e.level2_name),
          public.csv_field(e.attention_level::text)) as line,
        e.detected_at, e.id
      from public.v_change_log e
      where (v_tenant is null or e.tenant_id = v_tenant)
        and (nullif(f ->> 'change', '') is null or e.change::text = f ->> 'change')
        and (nullif(f ->> 'kind', '') is null or e.kind::text = f ->> 'kind')
        and (nullif(f ->> 'category', '') is null or e.category_slug like (f ->> 'category') || '/%')
        and (nullif(f ->> 'from', '') is null or e.detected_at >= (f ->> 'from')::timestamptz)
        and (nullif(f ->> 'to', '') is null or e.detected_at <= (f ->> 'to')::timestamptz)
        and (nullif(f ->> 'computerId', '') is null or e.computer_id = (f ->> 'computerId')::uuid)
        and (nullif(f ->> 'titleId', '') is null or e.title_id = (f ->> 'titleId')::uuid)
        and (v_search is null or e.canonical_name ilike public.like_contains(v_search)
             or e.hostname ilike public.like_contains(v_search) or e.external_id ilike public.like_contains(v_search))
      order by e.detected_at desc
      limit c_max + 1
    ) x;

  else
    raise exception 'Unknown export %', p_dataset using errcode = '22023';
  end if;

  if v_count > c_max then
    raise exception 'More than % rows: narrow the filters and export again', c_max using errcode = '54000';
  end if;

  -- What was exported and how much; never the rows.
  insert into public.audit_log (user_id, action, target, data)
  values (auth.uid(), 'export csv', p_dataset, jsonb_build_object('filters', f, 'rows', v_count));

  return v_header || E'\r\n' || coalesce(v_body || E'\r\n', '');
end;
$function$;

