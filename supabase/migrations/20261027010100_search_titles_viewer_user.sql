-- Phase 6 fix: search_titles ignores the user filter for viewers instead of returning nothing
-- (viewers cannot search by username; the screen hides the filter for them).

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

revoke all on function public.search_titles(uuid, text, public.title_kind, text, public.attention_level[], text, public.platform, text, text, timestamptz, text, boolean, integer, integer) from public, anon;
grant execute on function public.search_titles(uuid, text, public.title_kind, text, public.attention_level[], text, public.platform, text, text, timestamptz, text, boolean, integer, integer) to authenticated;
