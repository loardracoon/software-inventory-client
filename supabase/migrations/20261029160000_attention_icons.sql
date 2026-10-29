-- Attention icons (Phase 10b follow-up): the Software and Computers lists show one icon with a counter
-- per attention point (Not allowed, Review, and known vulnerabilities by severity) and the details in a
-- tooltip. This adds what the tooltips need: medium and low counts and the top CVEs per Software row, and
-- per computer the titles behind each attention category and its CVE counts.

-- 1. Software ---------------------------------------------------------------------------------------------

drop function public.search_titles(uuid, text, public.title_kind, text, public.attention_level[], text, public.platform, text, text,
  timestamptz, text, boolean, integer, integer, public.policy_class[], text);

create function public.search_titles(
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
  p_policy public.policy_class[] default null,
  p_vuln text default null
)
returns table (
  title_id uuid, kind public.title_kind, source text, canonical_name text, vendor text, external_id text,
  category_slug text, level1_name text, level2_name text, attention_level public.attention_level, origin text,
  method text, confidence numeric, computers bigint, versions bigint, latest_version text, first_seen timestamptz,
  policy_class public.policy_class, policy_rule_lineage_id uuid, policy_rule_name text, mixed_versions boolean,
  product_key text, spellings bigint,
  vulns bigint, vulns_critical bigint, vulns_high bigint, vulns_kev bigint, vulns_possible bigint, max_cvss numeric,
  vulns_medium bigint, vulns_low bigint, vuln_top jsonb,
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
      pk.product_key,
      mode() within group (order by m.title_id) as title_id,
      count(distinct m.title_id) as spellings,
      count(distinct m.computer_id) as computers,
      count(distinct m.version) as versions,
      (array_agg(m.version order by public.version_key(m.version) desc))[1] as latest_version,
      min(m.valid_from) as first_seen,
      max(tvp.class) as policy_class,
      (array_agg(tvp.rule_id order by tvp.class desc nulls last))[1] as policy_rule_id,
      count(distinct tvp.class) > 1 as mixed_versions
    from matched m
    join public.software_titles t on t.id = m.title_id
    join public.title_products pk on pk.title_id = t.id
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
    group by pk.product_key
    having p_policy is null or cardinality(p_policy) = 0 or max(tvp.class) = any (p_policy)
  ),
  -- One row per product and CVE among the listed installed versions; uncertain only when no version is
  -- certainly affected. rn ranks the CVEs for the tooltip (known exploited first, then the score).
  vuln_rows as (
    select x.*, row_number() over (partition by x.product_key order by x.uncertain, x.kev desc, x.cvss_score desc nulls last, x.vuln_id) as rn
    from (
      select pk.product_key, v.vuln_id, c.severity, c.cvss_score, c.kev_added is not null as kev, bool_and(v.uncertain) as uncertain
      from (select distinct m.tenant_id, m.title_id, coalesce(m.version, '') as version from matched m) p
      join public.title_products pk on pk.title_id = p.title_id
      join public.title_version_vulns v on v.tenant_id = p.tenant_id and v.title_id = p.title_id and v.version = p.version
      join public.vuln_cache c on c.product_key = v.product_key and c.vuln_id = v.vuln_id
      group by pk.product_key, v.vuln_id, c.severity, c.cvss_score, c.kev_added
    ) x
  ),
  vulns as (
    select r.product_key,
      count(*) filter (where not r.uncertain) as vulns,
      count(*) filter (where not r.uncertain and r.severity = 'CRITICAL') as critical,
      count(*) filter (where not r.uncertain and r.severity = 'HIGH') as high,
      count(*) filter (where not r.uncertain and r.severity = 'MEDIUM') as medium,
      count(*) filter (where not r.uncertain and r.severity = 'LOW') as low,
      count(*) filter (where not r.uncertain and r.kev) as kev,
      count(*) filter (where r.uncertain) as possible,
      max(r.cvss_score) filter (where not r.uncertain) as max_cvss,
      jsonb_agg(jsonb_build_object('id', r.vuln_id, 'severity', r.severity, 'score', r.cvss_score, 'kev', r.kev, 'uncertain', r.uncertain)
        order by r.rn) filter (where r.rn <= 8) as top
    from vuln_rows r
    group by r.product_key
  )
  select g.title_id, t.kind, t.source, public.product_name(t.canonical_name), t.vendor, t.external_id,
    tc.category_slug, tc.level1_name, tc.level2_name, tc.attention_level, tc.origin, tc.method, tc.confidence,
    g.computers, g.versions, g.latest_version, g.first_seen,
    g.policy_class, pr.lineage_id, pr.name, g.mixed_versions,
    g.product_key, g.spellings,
    coalesce(vu.vulns, 0), coalesce(vu.critical, 0), coalesce(vu.high, 0), coalesce(vu.kev, 0), coalesce(vu.possible, 0), vu.max_cvss,
    coalesce(vu.medium, 0), coalesce(vu.low, 0), coalesce(vu.top, '[]'),
    count(*) over () as total_count
  from grouped g
  join public.software_titles t on t.id = g.title_id
  left join public.title_classification tc on tc.title_id = g.title_id
  left join public.policy_rules pr on pr.id = g.policy_rule_id
  left join vulns vu on vu.product_key = g.product_key
  where p_vuln is null or p_vuln = ''
    or (p_vuln = 'any' and coalesce(vu.vulns, 0) > 0)
    or (p_vuln = 'kev' and coalesce(vu.kev, 0) > 0)
    or (p_vuln = 'critical' and coalesce(vu.critical, 0) > 0)
    or (p_vuln = 'high' and coalesce(vu.critical, 0) + coalesce(vu.high, 0) > 0)
  order by
    case when p_sort = 'computers' and p_desc then g.computers end desc nulls last,
    case when p_sort = 'computers' and not p_desc then g.computers end asc nulls last,
    case when p_sort = 'versions' and p_desc then g.versions end desc nulls last,
    case when p_sort = 'versions' and not p_desc then g.versions end asc nulls last,
    case when p_sort = 'first_seen' and p_desc then g.first_seen end desc nulls last,
    case when p_sort = 'first_seen' and not p_desc then g.first_seen end asc nulls last,
    -- Vulnerabilities: known exploited first, then the highest CVSS, then the count.
    case when p_sort = 'vulns' and p_desc then least(coalesce(vu.kev, 0), 1) * 100000 + coalesce(vu.max_cvss, 0) * 1000 + least(coalesce(vu.vulns, 0), 999) end desc nulls last,
    case when p_sort = 'vulns' and not p_desc then least(coalesce(vu.kev, 0), 1) * 100000 + coalesce(vu.max_cvss, 0) * 1000 + least(coalesce(vu.vulns, 0), 999) end asc nulls last,
    case when p_sort = 'canonical_name' and p_desc then lower(public.product_name(t.canonical_name)) end desc,
    case when p_sort = 'canonical_name' and not p_desc then lower(public.product_name(t.canonical_name)) end asc,
    lower(public.product_name(t.canonical_name)), g.title_id
  limit least(greatest(p_limit, 1), 100001)
  offset greatest(p_offset, 0);
$$;

-- 2. Computers --------------------------------------------------------------------------------------------

-- attention: one item per attention category with the installed titles in it (up to 10). vulns: distinct
-- CVEs of the installed versions by severity (certain matches), known exploited, may apply, and the top 8.
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
  coalesce(vv.summary, '{"critical": 0, "high": 0, "medium": 0, "low": 0, "kev": 0, "possible": 0, "top": []}'::jsonb) as vulns
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
      where i.computer_id = c.id and i.valid_to is null
      group by v.vuln_id, vc.severity, vc.cvss_score, vc.kev_added
    ) y
  ) x
  having count(*) > 0
) vv on true;

do $$
declare
  f text;
begin
  foreach f in array array[
    'search_titles(uuid, text, public.title_kind, text, public.attention_level[], text, public.platform, text, text, timestamptz, text, boolean, integer, integer, public.policy_class[], text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
