-- Phase 6: read models for the screens. Every view and function filters the tenants the caller can
-- see (my_tenant_roles) and masks usernames for viewers; lists page, sort and filter on the server
-- (PostgREST ranges on the views, limit/offset on search_titles). p_tenant_id null = all visible
-- tenants (the top-bar switcher), otherwise one of them.

-- Installations with title, classification and computer, for the computer and title pages.
create view public.v_installation_details
with (security_barrier = true)
as
select
  vi.*,
  t.kind, t.source, t.canonical_name, t.vendor, t.external_id,
  tc.category_slug, tc.level1_name, tc.level2_name, tc.attention_level, tc.origin, tc.method, tc.confidence,
  c.hostname, c.platform
from public.v_installations vi
join public.software_titles t on t.id = vi.title_id
join public.computers c on c.id = vi.computer_id
left join public.title_classification tc on tc.title_id = t.id;

-- Change events with title, category and computer (no usernames).
create view public.v_change_log
with (security_barrier = true)
as
select
  e.id, e.tenant_id, e.computer_id, c.hostname, c.platform, e.title_id, t.kind, t.source, t.canonical_name, t.external_id,
  e.domain, e.change, e.from_version, e.to_version, e.detected_at, e.snapshot_id,
  tc.category_slug, tc.level1_name, tc.level2_name, tc.attention_level
from public.change_events e
join public.my_tenant_roles() r on r.tenant_id = e.tenant_id
join public.computers c on c.id = e.computer_id
join public.software_titles t on t.id = e.title_id
left join public.title_classification tc on tc.title_id = e.title_id;

-- Computers list: cycle status in the open cycle, counts per domain, attention categories present.
create view public.v_computer_list
with (security_barrier = true)
as
select
  c.id, c.tenant_id, c.hostname, c.platform, c.os_name, c.os_version, c.os_build, c.endpoint_type, c.health,
  case when r.role = 'viewer' then null else c.associated_user end as associated_user,
  (r.role = 'viewer' and c.associated_user is not null) as user_masked,
  c.last_seen_at, c.last_collected_at, c.retired_at,
  st.cycle_status, st.next_attempt_at, st.last_error,
  coalesce(cnt.programs, 0) as programs,
  coalesce(cnt.extensions, 0) as extensions,
  coalesce(cnt.packages, 0) as packages,
  coalesce(att.items, '[]'::jsonb) as attention,
  coalesce(att.slugs, '{}') as attention_slugs,
  coalesce(att.level1_slugs, '{}') as attention_level1_slugs
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
    jsonb_agg(distinct jsonb_build_object('slug', tc.category_slug, 'level1', tc.level1_name, 'level2', tc.level2_name,
                                          'attention', tc.attention_level)) as items,
    array_agg(distinct tc.category_slug) as slugs,
    array_agg(distinct split_part(tc.category_slug, '/', 1)) as level1_slugs
  from public.installations i
  join public.title_classification tc on tc.title_id = i.title_id
  where i.computer_id = c.id and i.valid_to is null and tc.attention_level in ('review', 'not_allowed')
) att on true;

-- Scans: tasks waiting for a retry in open cycles.
create view public.v_retry_queue
with (security_barrier = true)
as
select
  t.id, t.tenant_id, t.computer_id, c.hostname, c.platform, c.last_seen_at, q.name as query_name, t.domain, t.status,
  t.attempts, t.next_attempt_at, t.last_error, t.updated_at
from public.scan_tasks t
join public.my_tenant_roles() r on r.tenant_id = t.tenant_id
join public.scan_cycles cy on cy.id = t.cycle_id and cy.status = 'open'
join public.computers c on c.id = t.computer_id
join public.query_catalog q on q.id = t.query_id
where t.status in ('retry_scheduled', 'no_response');

-- Scans: recent runs with what came back.
create view public.v_recent_runs
with (security_barrier = true)
as
select
  qr.id, qr.tenant_id, qr.provider, qr.domain, qr.platform, q.name as query_name, qr.query_version, qr.status, qr.cancelled,
  qr.priority, qr.error, qr.started_at, qr.finished_at,
  cardinality(qr.endpoint_ids) as endpoints,
  (select count(*) from public.raw_results rr where rr.run_id = qr.id) as collected,
  (select count(*) from public.scan_tasks t where t.last_run_id = qr.id and t.status in ('no_response', 'retry_scheduled', 'missed')) as no_response,
  (select count(*) from public.scan_tasks t where t.last_run_id = qr.id and t.status = 'error') as errors,
  extract(epoch from (coalesce(qr.finished_at, now()) - qr.started_at))::integer as duration_seconds
from public.query_runs qr
join public.my_tenant_roles() r on r.tenant_id = qr.tenant_id
left join public.query_catalog q on q.id = qr.query_id;

-- Software search, grouped by title. Filters that need installations (platform, user, version below,
-- installed on a date) run on installations, not on title_summary. The user filter is ignored for
-- viewers (it would reveal usernames).
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
  p_offset integer default 0
)
returns table (
  title_id uuid, kind public.title_kind, source text, canonical_name text, vendor text, external_id text,
  category_slug text, level1_name text, level2_name text, attention_level public.attention_level, origin text,
  method text, confidence numeric, computers bigint, versions bigint, latest_version text, first_seen timestamptz,
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
    select i.title_id, i.computer_id, i.version, i.valid_from
    from public.installations i
    join visible v on v.tenant_id = i.tenant_id
    join public.computers c on c.id = i.computer_id and c.retired_at is null
    where (case when p_as_of is null then i.valid_to is null
                else i.valid_from <= p_as_of and (i.valid_to is null or i.valid_to > p_as_of) end)
      and (p_platform is null or c.platform = p_platform)
      and (p_user is null or (v.role <> 'viewer' and lower(i.username) like '%' || lower(p_user) || '%'))
      and (p_version_below is null or public.version_key(i.version) < public.version_key(p_version_below))
  ),
  grouped as (
    select
      t.id as title_id, t.kind, t.source, t.canonical_name, t.vendor, t.external_id,
      tc.category_slug, tc.level1_name, tc.level2_name, tc.attention_level, tc.origin, tc.method, tc.confidence,
      count(distinct m.computer_id) as computers,
      count(distinct m.version) as versions,
      (array_agg(m.version order by public.version_key(m.version) desc))[1] as latest_version,
      min(m.valid_from) as first_seen
    from matched m
    join public.software_titles t on t.id = m.title_id
    left join public.title_classification tc on tc.title_id = t.id
    where (p_kind is null or t.kind = p_kind)
      and (p_source is null or t.source = p_source)
      and (p_category is null or tc.category_slug = p_category or tc.category_slug like p_category || '/%')
      and (p_attention is null or tc.attention_level = any (p_attention))
      and (p_query is null or p_query = ''
           or t.canonical_name ilike '%' || p_query || '%'
           or t.vendor ilike '%' || p_query || '%'
           or t.external_id ilike '%' || p_query || '%')
    group by t.id, tc.category_slug, tc.level1_name, tc.level2_name, tc.attention_level, tc.origin, tc.method, tc.confidence
  )
  select g.*, count(*) over () as total_count
  from grouped g
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
  limit least(greatest(p_limit, 1), 200)
  offset greatest(p_offset, 0);
$$;

-- Title page: version distribution (open installations on active computers).
create or replace function public.title_versions(p_title_id uuid, p_tenant_id uuid default null)
returns table (version text, computers bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select i.version, count(distinct i.computer_id)
  from public.installations i
  join public.my_tenant_roles() r on r.tenant_id = i.tenant_id
  join public.computers c on c.id = i.computer_id and c.retired_at is null
  where i.title_id = p_title_id and i.valid_to is null and (p_tenant_id is null or i.tenant_id = p_tenant_id)
  group by i.version
  order by public.version_key(i.version) desc;
$$;

-- Overview KPIs.
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

-- Overview chart: changes per week (weeks start on Monday, UTC), oldest first, empty weeks included.
create or replace function public.weekly_changes(p_tenant_id uuid default null, p_weeks integer default 12)
returns table (week_start date, added bigint, updated bigint, removed bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with weeks as (
    select generate_series(
      date_trunc('week', now()) - make_interval(weeks => least(greatest(p_weeks, 1), 104) - 1),
      date_trunc('week', now()),
      interval '1 week'
    )::date as week_start
  ),
  ev as (
    select date_trunc('week', e.detected_at)::date as week_start, e.change
    from public.change_events e
    join public.my_tenant_roles() r on r.tenant_id = e.tenant_id
    where (p_tenant_id is null or e.tenant_id = p_tenant_id)
      and e.detected_at >= date_trunc('week', now()) - make_interval(weeks => least(greatest(p_weeks, 1), 104) - 1)
  )
  select w.week_start,
         count(ev.change) filter (where ev.change = 'added'),
         count(ev.change) filter (where ev.change = 'updated'),
         count(ev.change) filter (where ev.change = 'removed')
  from weeks w left join ev on ev.week_start = w.week_start
  group by w.week_start
  order by w.week_start;
$$;

-- Open cycles with task and computer progress (one row per visible tenant with an open cycle).
create or replace function public.cycle_overview(p_tenant_id uuid default null)
returns table (
  tenant_id uuid, tenant_name text, cycle_id uuid, opened_at timestamptz, closes_at timestamptz,
  tasks bigint, collected bigint, pending bigint, dispatched bigint, retrying bigint, missed bigint, errors bigint,
  skipped bigint, coverage_pct numeric, computers bigint, computers_collected bigint, next_retry_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    cy.tenant_id, tn.name, cy.id, cy.opened_at, cy.closes_at,
    count(t.id),
    count(t.id) filter (where t.status = 'collected'),
    count(t.id) filter (where t.status = 'pending'),
    count(t.id) filter (where t.status = 'dispatched'),
    count(t.id) filter (where t.status in ('retry_scheduled', 'no_response')),
    count(t.id) filter (where t.status = 'missed'),
    count(t.id) filter (where t.status = 'error'),
    count(t.id) filter (where t.status = 'skipped'),
    round(100.0 * count(t.id) filter (where t.status = 'collected') / nullif(count(t.id) filter (where t.status <> 'skipped'), 0), 1),
    count(distinct t.computer_id),
    (select count(*) from (
       select t2.computer_id from public.scan_tasks t2 where t2.cycle_id = cy.id
       group by t2.computer_id having bool_and(t2.status in ('collected', 'skipped'))
     ) done),
    min(t.next_attempt_at) filter (where t.status = 'retry_scheduled')
  from public.scan_cycles cy
  join public.my_tenant_roles() r on r.tenant_id = cy.tenant_id
  join public.tenants tn on tn.id = cy.tenant_id
  left join public.scan_tasks t on t.cycle_id = cy.id
  where cy.status = 'open' and (p_tenant_id is null or cy.tenant_id = p_tenant_id)
  group by cy.id, tn.name
  order by tn.name;
$$;

-- Overview: level-2 categories with attention Review or Not allowed currently installed.
create or replace function public.needs_attention(p_tenant_id uuid default null, p_limit integer default 8)
returns table (category_slug text, level1_name text, level2_name text, attention_level public.attention_level, titles bigint, computers bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select tc.category_slug, tc.level1_name, tc.level2_name, tc.attention_level,
         count(distinct i.title_id), count(distinct i.computer_id)
  from public.installations i
  join public.my_tenant_roles() r on r.tenant_id = i.tenant_id
  join public.computers c on c.id = i.computer_id and c.retired_at is null
  join public.title_classification tc on tc.title_id = i.title_id
  where i.valid_to is null and tc.attention_level in ('review', 'not_allowed')
    and (p_tenant_id is null or i.tenant_id = p_tenant_id)
  group by tc.category_slug, tc.level1_name, tc.level2_name, tc.attention_level
  order by (tc.attention_level = 'not_allowed') desc, count(distinct i.computer_id) desc, tc.level2_name
  limit least(greatest(p_limit, 1), 50);
$$;

-- Computer page: this computer's tasks in the open cycle.
create or replace function public.computer_cycle_tasks(p_computer_id uuid)
returns table (query_name text, domain public.inventory_domain, status public.task_status, attempts integer,
               next_attempt_at timestamptz, last_error text, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select q.name, t.domain, t.status, t.attempts, t.next_attempt_at, t.last_error, t.updated_at
  from public.scan_tasks t
  join public.my_tenant_roles() r on r.tenant_id = t.tenant_id
  join public.scan_cycles cy on cy.id = t.cycle_id and cy.status = 'open'
  join public.query_catalog q on q.id = t.query_id
  where t.computer_id = p_computer_id
  order by t.domain, q.name;
$$;

revoke all on table public.v_installation_details, public.v_change_log, public.v_computer_list, public.v_retry_queue,
  public.v_recent_runs from anon, authenticated;
grant select on table public.v_installation_details, public.v_change_log, public.v_computer_list, public.v_retry_queue,
  public.v_recent_runs to authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'search_titles(uuid, text, public.title_kind, text, public.attention_level[], text, public.platform, text, text, timestamptz, text, boolean, integer, integer)',
    'title_versions(uuid, uuid)', 'overview_stats(uuid)', 'weekly_changes(uuid, integer)', 'cycle_overview(uuid)',
    'needs_attention(uuid, integer)', 'computer_cycle_tasks(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
