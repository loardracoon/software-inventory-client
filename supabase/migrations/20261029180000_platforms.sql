-- Operating systems (with Hub H7 ranges and titles-submit).
--  A. The Hub sends the OS of each affected version range (null = every OS). The matcher evaluates each OS of
--     an installed (title, version) with the ranges for that OS; title_version_vulns.platforms keeps the OS
--     where the match holds (null = all the pair's computers). Screens count a match only on computers with
--     that OS.
--  B. The client sends, with each shared title, the OS families where it is installed (titles-submit field
--     platforms; never versions, hosts or counts) and sends a title again when that list grows.

-- A. Matches by OS ---------------------------------------------------------------------------------------------

alter table public.title_version_vulns add column platforms text[];

drop function public.vuln_eval_inputs(uuid, uuid, text, integer);

-- Pages (keyset on title_id, version) through the tenant's current (title, version) pairs whose product
-- has CVEs in the cache, with the OS of the computers where each pair is installed.
create function public.vuln_eval_inputs(
  p_tenant_id uuid,
  p_after_title uuid default null,
  p_after_version text default null,
  p_limit integer default 1000
)
returns table (title_id uuid, version text, product_key text, platforms text[])
language sql
stable
security definer
set search_path = ''
as $$
  with pairs as (
    select i.title_id, coalesce(i.version, '') as version, array_agg(distinct c.platform::text order by c.platform::text) as platforms
    from public.installations i
    join public.computers c on c.id = i.computer_id and c.retired_at is null
    where i.tenant_id = p_tenant_id and i.valid_to is null
    group by i.title_id, coalesce(i.version, '')
  )
  select p.title_id, p.version, tp.product_key, p.platforms
  from pairs p
  join public.title_products tp on tp.title_id = p.title_id
  where exists (select 1 from public.vuln_cache v where v.product_key = tp.product_key)
    and (p_after_title is null or (p.title_id, p.version) > (p_after_title, coalesce(p_after_version, '')))
  order by p.title_id, p.version
  limit least(greatest(p_limit, 1), 5000);
$$;

-- vuln_store_matches takes the OS list of each match.
do $$
declare
  v_def text;
  v_parts text[][] := array[
    array['coalesce(m.uncertain, false) as uncertain, m.fixed_in', 'coalesce(m.uncertain, false) as uncertain, m.fixed_in, m.platforms'],
    array['uncertain boolean, fixed_in text)', 'uncertain boolean, fixed_in text, platforms text[])'],
    array['vuln_id, uncertain, fixed_in, run_id)', 'vuln_id, uncertain, fixed_in, run_id, platforms)'],
    array['p.uncertain, p.fixed_in, p_run_id', 'p.uncertain, p.fixed_in, p_run_id, p.platforms'],
    array['fixed_in = excluded.fixed_in, run_id = excluded.run_id', 'fixed_in = excluded.fixed_in, run_id = excluded.run_id, platforms = excluded.platforms']
  ];
  i integer;
begin
  select pg_get_functiondef('public.vuln_store_matches'::regproc) into v_def;
  for i in 1 .. array_length(v_parts, 1) loop
    if (length(v_def) - length(replace(v_def, v_parts[i][1], ''))) / length(v_parts[i][1]) <> 1 then
      raise exception 'vuln_store_matches has changed (part %): update this migration', i;
    end if;
    v_def := replace(v_def, v_parts[i][1], v_parts[i][2]);
  end loop;
  execute v_def;
end;
$$;

create or replace view public.v_installation_details
with (security_barrier = true)
as
select
  vi.*,
  t.kind, t.source, t.canonical_name, t.vendor, t.external_id,
  tc.category_slug, tc.level1_name, tc.level2_name, tc.attention_level, tc.origin, tc.method, tc.confidence,
  c.hostname, c.platform,
  tvp.class as policy_class,
  vv.vulns, vv.vulns_kev, vv.max_cvss, vv.vulns_possible
from public.v_installations vi
join public.software_titles t on t.id = vi.title_id
join public.computers c on c.id = vi.computer_id
left join public.title_classification tc on tc.title_id = t.id
left join public.title_version_policy tvp
  on tvp.tenant_id = vi.tenant_id and tvp.title_id = vi.title_id and tvp.version = coalesce(vi.version, '')
left join lateral (
  select
    count(*) filter (where not v.uncertain) as vulns,
    count(*) filter (where not v.uncertain and vc.kev_added is not null) as vulns_kev,
    max(vc.cvss_score) filter (where not v.uncertain) as max_cvss,
    count(*) filter (where v.uncertain) as vulns_possible
  from public.title_version_vulns v
  join public.vuln_cache vc on vc.product_key = v.product_key and vc.vuln_id = v.vuln_id
  where v.tenant_id = vi.tenant_id and v.title_id = vi.title_id and v.version = coalesce(vi.version, '')
    and (v.platforms is null or c.platform::text = any (v.platforms))
) vv on true;

drop function public.title_vulns(uuid, uuid);

-- The CVEs of a title's product (every spelling) that affect installed versions, with the affected installed
-- versions, their computers (of the match's OS) and the OS list (null = every OS).
create function public.title_vulns(p_title_id uuid, p_tenant_id uuid default null)
returns table (
  vuln_id text, aliases text[], summary text, published timestamptz, cvss_score numeric, cvss_version text, severity text,
  cvss_vector text, cwe text[], refs text[], kev_added date, kev_due date, kev_ransomware text, epss numeric, epss_percentile numeric,
  uncertain boolean, versions text[], fixed_in text, computers bigint, platforms text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.vuln_id, c.aliases, c.summary, c.published, c.cvss_score, c.cvss_version, c.severity, c.cvss_vector, c.cwe, c.refs,
    c.kev_added, c.kev_due, c.kev_ransomware, c.epss, c.epss_percentile,
    bool_and(v.uncertain),
    array_agg(distinct v.version order by v.version),
    max(v.fixed_in),
    (select count(distinct i.computer_id)
     from public.installations i
     join public.computers cp on cp.id = i.computer_id and cp.retired_at is null
     join public.title_version_vulns x on x.tenant_id = i.tenant_id and x.title_id = i.title_id and x.version = coalesce(i.version, '') and x.vuln_id = c.vuln_id
     where i.title_id = any (public.title_group_ids(p_title_id)) and i.valid_to is null
       and (x.platforms is null or cp.platform::text = any (x.platforms))
       and i.tenant_id in (select r.tenant_id from public.my_tenant_roles() r)
       and (p_tenant_id is null or i.tenant_id = p_tenant_id)),
    case when bool_or(v.platforms is null) then null else (select array_agg(distinct p order by p) from unnest(string_to_array(string_agg(array_to_string(v.platforms, ','), ','), ',')) p) end
  from public.title_version_vulns v
  join public.vuln_cache c on c.product_key = v.product_key and c.vuln_id = v.vuln_id
  where v.title_id = any (public.title_group_ids(p_title_id))
    and v.tenant_id in (select r.tenant_id from public.my_tenant_roles() r)
    and (p_tenant_id is null or v.tenant_id = p_tenant_id)
  group by c.product_key, c.vuln_id
  order by bool_and(v.uncertain), (c.kev_added is not null) desc, c.cvss_score desc nulls last, c.published desc nulls last, c.vuln_id;
$$;

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
      where i.computer_id = c.id and i.valid_to is null and (v.platforms is null or c.platform::text = any (v.platforms))
      group by v.vuln_id, vc.severity, vc.cvss_score, vc.kev_added
    ) y
  ) x
  having count(*) > 0
) vv on true;

create or replace function public.vuln_overview(p_tenant_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with visible as (
    select r.tenant_id from public.my_tenant_roles() r where p_tenant_id is null or r.tenant_id = p_tenant_id
  ),
  all_matches as (
    select v.tenant_id, v.title_id, v.version, v.vuln_id, v.uncertain, v.platforms, c.severity, c.kev_added
    from public.title_version_vulns v
    join visible on visible.tenant_id = v.tenant_id
    join public.vuln_cache c on c.product_key = v.product_key and c.vuln_id = v.vuln_id
  ),
  m as (select * from all_matches where not uncertain),
  -- CVEs with no certain match anywhere in the visible tenants.
  p as (select * from all_matches a where a.uncertain and not exists (select 1 from m where m.vuln_id = a.vuln_id)),
  kev_installs as (
    select i.id, i.computer_id
    from public.installations i
    join public.computers cp on cp.id = i.computer_id and cp.retired_at is null
    where i.valid_to is null and exists (
      select 1 from m where m.kev_added is not null and m.tenant_id = i.tenant_id and m.title_id = i.title_id and m.version = coalesce(i.version, '')
        and (m.platforms is null or cp.platform::text = any (m.platforms)))
  )
  select jsonb_build_object(
    'vulns', (select count(distinct vuln_id) from m),
    'critical', (select count(distinct vuln_id) from m where severity = 'CRITICAL'),
    'high', (select count(distinct vuln_id) from m where severity = 'HIGH'),
    'kev', (select count(distinct vuln_id) from m where kev_added is not null),
    'titles', (select count(distinct title_id) from m),
    'kev_installations', (select count(*) from kev_installs),
    'kev_computers', (select count(distinct computer_id) from kev_installs),
    'possible', (select count(distinct vuln_id) from p),
    'possible_titles', (select count(distinct title_id) from p),
    'cached', (select count(*) from public.vuln_cache),
    'synced_at', (select max(synced_at) from public.vuln_cache),
    'evaluated_at', (select max(s.evaluated_at) from public.vuln_eval_state s join visible on visible.tenant_id = s.tenant_id)
  );
$$;

-- search_titles: a match with an OS counts only for listed installations on that OS.
do $$
declare
  v_def text;
  v_parts text[][] := array[
    array['select i.tenant_id, i.title_id, i.computer_id, i.version, i.valid_from', 'select i.tenant_id, i.title_id, i.computer_id, i.version, i.valid_from, c.platform'],
    array['from (select distinct m.tenant_id, m.title_id, coalesce(m.version, '''') as version from matched m) p',
      'from (select distinct m.tenant_id, m.title_id, coalesce(m.version, '''') as version, m.platform from matched m) p'],
    array['v.title_id = p.title_id and v.version = p.version', 'v.title_id = p.title_id and v.version = p.version and (v.platforms is null or p.platform::text = any (v.platforms))']
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
  execute v_def;
end;
$$;

-- B. OS of the shared titles ----------------------------------------------------------------------------------

alter table public.hub_submissions add column platforms_sent text[];

-- Titles to send to the Hub: never sent, or installed on an OS not sent yet. platforms: the OS families of
-- the computers (not retired) where the title is installed now, all tenants together.
create or replace function public.hub_submissions_due(p_limit integer default 500)
returns table (id uuid, kind public.title_kind, source text, match_key text, name text, vendor text, description text, platforms text[])
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.kind, s.source, s.match_key, s.name, s.vendor, s.description, os.platforms
  from public.hub_submissions s
  left join lateral (
    select array_agg(distinct c.platform::text order by c.platform::text) as platforms
    from public.software_titles t
    join public.installations i on i.title_id = t.id and i.valid_to is null
    join public.computers c on c.id = i.computer_id and c.retired_at is null
    where t.kind = s.kind and t.source = s.source and t.match_key = s.match_key
  ) os on true
  where s.sent_at is null or (os.platforms is not null and not (os.platforms <@ coalesce(s.platforms_sent, '{}')))
  order by s.sent_at nulls first, s.first_seen
  limit least(greatest(p_limit, 1), 500);
$$;

-- After a send: when, and which OS families went with each title (p_items: [{ id, platforms }]).
create or replace function public.hub_submissions_sent(p_items jsonb)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with done as (
    update public.hub_submissions s
    set sent_at = now(),
      platforms_sent = (select array_agg(distinct p order by p) from unnest(coalesce(s.platforms_sent, '{}') || coalesce(x.platforms, '{}')) p)
    from jsonb_to_recordset(coalesce(p_items, '[]')) as x (id uuid, platforms text[])
    where s.id = x.id
    returning 1
  )
  select count(*)::integer from done;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['title_vulns(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['vuln_eval_inputs(uuid, uuid, text, integer)', 'hub_submissions_due(integer)', 'hub_submissions_sent(jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;
