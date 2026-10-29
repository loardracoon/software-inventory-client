-- Phase 10b: known vulnerabilities (with Hub H7).
--
-- The Hub maps products to CVEs (NVD, OSV, CISA KEV, FIRST EPSS) and serves, per product, each CVE with
-- its affected version ranges (GET vulnerability-changes). The client keeps them in vuln_cache and
-- compares its own installed versions (supabase/functions/_shared/vuln-match.ts): nothing about the
-- computers goes to the Hub. Matches are stored per installed (title, version) in title_version_vulns,
-- like the policy classes, and feed the screens, the policy fields cvss / kev / epss and the KEV alert.
--
-- A match is "uncertain" (may be affected) when the installation reports no usable version or the CVE
-- names no version bound. Uncertain matches show on the screens but do not count in the policy fields,
-- the Changes list or the alert.

-- 1. Cache of the Hub feed ------------------------------------------------------------------------------

create table public.vuln_cache (
  product_key text not null,
  vuln_id text not null check (char_length(vuln_id) between 3 and 100),
  aliases text[] not null default '{}',
  published timestamptz,
  modified timestamptz,
  summary text,
  cvss_version text,
  cvss_score numeric(3, 1) check (cvss_score between 0 and 10),
  severity text check (severity in ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE')),
  cvss_vector text,
  cwe text[] not null default '{}',
  refs text[] not null default '{}',
  kev_added date,
  kev_due date,
  kev_ransomware text,
  epss numeric(6, 5),
  epss_percentile numeric(6, 5),
  -- [{ version_start, start_inclusive, version_end, end_inclusive, exact_version, source }]
  ranges jsonb not null default '[]' check (jsonb_typeof(ranges) = 'array'),
  hub_seq bigint not null default 0,
  synced_at timestamptz not null default now(),
  primary key (product_key, vuln_id)
);

create index vuln_cache_vuln_idx on public.vuln_cache (vuln_id);

alter table public.vuln_cache enable row level security;

create policy "Signed-in users read vulnerabilities"
  on public.vuln_cache for select
  to authenticated
  using (true);

revoke all on table public.vuln_cache from anon, authenticated;
grant select on table public.vuln_cache to authenticated;

alter table public.hub_connection add column vuln_last_seq bigint not null default 0;

-- Another hub means another vulnerability sequence too.
do $$
declare
  v_def text;
  v_line text := '    last_seq = case when v_old.url is distinct from v_url then 0 else last_seq end,';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'set_hub_connection';
  if position(v_line in v_def) = 0 then
    raise exception 'set_hub_connection has changed: update this migration';
  end if;
  execute replace(v_def, v_line, v_line || '
    vuln_last_seq = case when v_old.url is distinct from v_url then 0 else vuln_last_seq end,');
end;
$$;

-- One page of the feed in one transaction: removed pairs go, the others are upserted. Items without a
-- product key are skipped. Any change stamps maintenance_state 'vulns_changed' so the matcher runs.
create or replace function public.apply_vulnerability_changes(p_items jsonb, p_next_seq bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_upserted integer := 0;
  v_removed integer := 0;
  v_skipped integer := 0;
begin
  select count(*) into v_skipped
  from jsonb_array_elements(coalesce(p_items, '[]')) e
  where nullif(e ->> 'product_key', '') is null or nullif(e ->> 'vuln_id', '') is null;

  delete from public.vuln_cache c
  using jsonb_array_elements(coalesce(p_items, '[]')) e
  where coalesce((e ->> 'removed')::boolean, false)
    and c.product_key = e ->> 'product_key' and c.vuln_id = e ->> 'vuln_id';
  get diagnostics v_removed = row_count;

  insert into public.vuln_cache (product_key, vuln_id, aliases, published, modified, summary, cvss_version, cvss_score, severity,
    cvss_vector, cwe, refs, kev_added, kev_due, kev_ransomware, epss, epss_percentile, ranges, hub_seq, synced_at)
  select e ->> 'product_key', e ->> 'vuln_id',
    coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(e -> 'aliases') = 'array' then e -> 'aliases' end)), '{}'),
    (e ->> 'published')::timestamptz, (e ->> 'modified')::timestamptz, left(e ->> 'summary', 2000),
    e ->> 'cvss_version', (e ->> 'cvss_score')::numeric,
    case when upper(e ->> 'severity') in ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE') then upper(e ->> 'severity') end,
    e ->> 'cvss_vector',
    coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(e -> 'cwe') = 'array' then e -> 'cwe' end)), '{}'),
    coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(e -> 'references') = 'array' then e -> 'references' end)), '{}'),
    (e ->> 'kev_added')::date, (e ->> 'kev_due')::date, e ->> 'kev_ransomware',
    (e ->> 'epss')::numeric, (e ->> 'epss_percentile')::numeric,
    case when jsonb_typeof(e -> 'ranges') = 'array' then e -> 'ranges' else '[]' end,
    coalesce((e ->> 'seq')::bigint, 0), now()
  from jsonb_array_elements(coalesce(p_items, '[]')) e
  where not coalesce((e ->> 'removed')::boolean, false)
    and nullif(e ->> 'product_key', '') is not null and nullif(e ->> 'vuln_id', '') is not null
  on conflict (product_key, vuln_id) do update set
    aliases = excluded.aliases, published = excluded.published, modified = excluded.modified, summary = excluded.summary,
    cvss_version = excluded.cvss_version, cvss_score = excluded.cvss_score, severity = excluded.severity,
    cvss_vector = excluded.cvss_vector, cwe = excluded.cwe, refs = excluded.refs, kev_added = excluded.kev_added,
    kev_due = excluded.kev_due, kev_ransomware = excluded.kev_ransomware, epss = excluded.epss,
    epss_percentile = excluded.epss_percentile, ranges = excluded.ranges, hub_seq = excluded.hub_seq, synced_at = excluded.synced_at;
  get diagnostics v_upserted = row_count;

  update public.hub_connection set vuln_last_seq = greatest(vuln_last_seq, coalesce(p_next_seq, 0)) where id = 1;

  if v_upserted + v_removed > 0 then
    insert into public.maintenance_state (key, at) values ('vulns_changed', now())
    on conflict (key) do update set at = excluded.at;
  end if;

  return jsonb_build_object('upserted', v_upserted, 'removed', v_removed, 'skipped', v_skipped);
end;
$$;

-- 2. Matches of the installed versions --------------------------------------------------------------------

-- One row per tenant, installed (title, version) and CVE. version '' = no version reported. A CVE that
-- leaves the cache removes its matches (cascade).
create table public.title_version_vulns (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  title_id uuid not null references public.software_titles (id) on delete cascade,
  version text not null default '',
  product_key text not null,
  vuln_id text not null,
  uncertain boolean not null default false,
  fixed_in text,
  first_seen_at timestamptz not null default now(),
  run_id uuid not null,
  kev_alerted boolean not null default false,
  primary key (tenant_id, title_id, version, vuln_id),
  foreign key (product_key, vuln_id) references public.vuln_cache (product_key, vuln_id) on delete cascade
);

create index title_version_vulns_vuln_idx on public.title_version_vulns (product_key, vuln_id);
create index title_version_vulns_run_idx on public.title_version_vulns (tenant_id, run_id);

-- "New CVE affects installed software" for the Changes screen (certain matches only).
create table public.vuln_match_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  title_id uuid not null references public.software_titles (id) on delete cascade,
  version text not null,
  product_key text not null,
  vuln_id text not null,
  detected_at timestamptz not null default now()
);

create index vuln_match_events_tenant_idx on public.vuln_match_events (tenant_id, detected_at desc);
create index vuln_match_events_title_idx on public.vuln_match_events (title_id, detected_at desc);

-- evaluated_at: last full match run; changed_at: last run that changed matches or read changed CVE data
-- (the policy re-evaluates the tenant after it).
create table public.vuln_eval_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  evaluated_at timestamptz,
  changed_at timestamptz
);

-- New inventory since the last match run makes a tenant due.
create index snapshots_tenant_applied_idx on public.snapshots (tenant_id, applied_at);

alter table public.title_version_vulns enable row level security;
alter table public.vuln_match_events enable row level security;
alter table public.vuln_eval_state enable row level security;

create policy "Tenant members read vulnerability matches"
  on public.title_version_vulns for select
  to authenticated
  using (tenant_id in (select r.tenant_id from public.my_tenant_roles() r));

create policy "Tenant members read vulnerability events"
  on public.vuln_match_events for select
  to authenticated
  using (tenant_id in (select r.tenant_id from public.my_tenant_roles() r));

revoke all on table public.title_version_vulns, public.vuln_match_events, public.vuln_eval_state from anon, authenticated;
grant select on table public.title_version_vulns, public.vuln_match_events to authenticated;

alter table public.alerts drop constraint alerts_kind_check;
alter table public.alerts add constraint alerts_kind_check
  check (kind in ('coverage_low', 'query_error', 'collector_stale', 'test', 'policy_unsanctioned', 'vuln_kev'));

-- 3. Matcher RPCs (service role) ----------------------------------------------------------------------------

-- Tenants to match: never matched, CVE data changed since, or new inventory since. Nothing to do while
-- the cache is empty and the tenant has no matches.
create or replace function public.vuln_due_tenants()
returns table (tenant_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id
  from public.tenants t
  left join public.vuln_eval_state s on s.tenant_id = t.id
  where (exists (select 1 from public.vuln_cache) or exists (select 1 from public.title_version_vulns v where v.tenant_id = t.id))
    and (s.evaluated_at is null
      or s.evaluated_at < coalesce((select m.at from public.maintenance_state m where m.key = 'vulns_changed'), '-infinity')
      or s.evaluated_at < coalesce((select m.at from public.maintenance_state m where m.key = 'dictionary_changed'), '-infinity')
      or exists (select 1 from public.snapshots sn where sn.tenant_id = t.id and sn.applied_at > s.evaluated_at))
  order by t.id;
$$;

-- Pages (keyset on title_id, version) through the tenant's current (title, version) pairs whose product
-- has CVEs in the cache.
create or replace function public.vuln_eval_inputs(
  p_tenant_id uuid,
  p_after_title uuid default null,
  p_after_version text default null,
  p_limit integer default 1000
)
returns table (title_id uuid, version text, product_key text)
language sql
stable
security definer
set search_path = ''
as $$
  with pairs as (
    select distinct i.title_id, coalesce(i.version, '') as version
    from public.installations i
    join public.computers c on c.id = i.computer_id and c.retired_at is null
    where i.tenant_id = p_tenant_id and i.valid_to is null
  )
  select p.title_id, p.version, tp.product_key
  from pairs p
  join public.title_products tp on tp.title_id = p.title_id
  where exists (select 1 from public.vuln_cache v where v.product_key = tp.product_key)
    and (p_after_title is null or (p.title_id, p.version) > (p_after_title, coalesce(p_after_version, '')))
  order by p.title_id, p.version
  limit least(greatest(p_limit, 1), 5000);
$$;

-- The CVEs and ranges of some products, for the matcher.
create or replace function public.vuln_product_ranges(p_product_keys text[])
returns table (product_key text, vuln_id text, ranges jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select v.product_key, v.vuln_id, v.ranges from public.vuln_cache v where v.product_key = any (p_product_keys)
  order by v.product_key, v.vuln_id;
$$;

-- Stores one page of matches of the run p_run_id: new certain matches go to vuln_match_events, then the
-- matches are upserted with the run id, then one alert per new known exploited CVE of the tenant.
-- p_matches: [{ title_id, version, product_key, vuln_id, uncertain, fixed_in }]
create or replace function public.vuln_store_matches(p_tenant_id uuid, p_run_id uuid, p_matches jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_new integer := 0;
  v_stored integer := 0;
  v_alerts integer := 0;
begin
  -- One statement: the event insert sees the matches as they were before the upsert.
  with page as (
    select distinct on (m.title_id, coalesce(m.version, ''), m.vuln_id)
      m.title_id, coalesce(m.version, '') as version, m.product_key, m.vuln_id, coalesce(m.uncertain, false) as uncertain, m.fixed_in
    from jsonb_to_recordset(coalesce(p_matches, '[]')) as m (title_id uuid, version text, product_key text, vuln_id text, uncertain boolean, fixed_in text)
    join public.vuln_cache c on c.product_key = m.product_key and c.vuln_id = m.vuln_id
    order by m.title_id, coalesce(m.version, ''), m.vuln_id, coalesce(m.uncertain, false)
  ),
  events as (
    insert into public.vuln_match_events (tenant_id, title_id, version, product_key, vuln_id)
    select p_tenant_id, p.title_id, p.version, p.product_key, p.vuln_id
    from page p
    where not p.uncertain and not exists (
      select 1 from public.title_version_vulns v
      where v.tenant_id = p_tenant_id and v.title_id = p.title_id and v.version = p.version and v.vuln_id = p.vuln_id and not v.uncertain)
    returning 1
  ),
  stored as (
    insert into public.title_version_vulns (tenant_id, title_id, version, product_key, vuln_id, uncertain, fixed_in, run_id)
    select p_tenant_id, p.title_id, p.version, p.product_key, p.vuln_id, p.uncertain, p.fixed_in, p_run_id
    from page p
    on conflict (tenant_id, title_id, version, vuln_id) do update set
      product_key = excluded.product_key, uncertain = excluded.uncertain, fixed_in = excluded.fixed_in, run_id = excluded.run_id
    returning 1
  )
  select (select count(*) from events), (select count(*) from stored) into v_new, v_stored;

  -- KEV: one alert per tenant and CVE (dedupe), for certain matches not alerted yet. Rows are marked
  -- even when alerts are off, so turning them on does not send old CVEs.
  if exists (select 1 from public.alert_settings s where s.id = 1 and s.enabled) then
    insert into public.alerts (kind, dedupe_key, tenant_id, title, body, data)
    select 'vuln_kev', 'vuln_kev:' || p_tenant_id || ':' || k.vuln_id, p_tenant_id,
      format('Known exploited vulnerability in %s: %s', tn.name, k.vuln_id),
      format('%s is in the CISA Known Exploited Vulnerabilities catalog (added %s%s) and affects installed software: %s.%s',
        k.vuln_id, k.kev_added, coalesce(', remediation due ' || k.kev_due, ''), k.titles,
        coalesce(' Fixed in ' || k.fixed_in || '.', '')),
      jsonb_build_object('vuln_id', k.vuln_id, 'title_ids', k.title_ids, 'kev_added', k.kev_added, 'cvss_score', k.cvss_score)
    from (
      select v.vuln_id, c.kev_added, c.kev_due, c.cvss_score,
        string_agg(distinct t.canonical_name || coalesce(' ' || nullif(v.version, ''), ''), ', ') as titles,
        jsonb_agg(distinct v.title_id) as title_ids,
        min(v.fixed_in) as fixed_in
      from public.title_version_vulns v
      join public.vuln_cache c on c.product_key = v.product_key and c.vuln_id = v.vuln_id and c.kev_added is not null
      join public.software_titles t on t.id = v.title_id
      where v.tenant_id = p_tenant_id and v.run_id = p_run_id and not v.uncertain and not v.kev_alerted
      group by v.vuln_id, c.kev_added, c.kev_due, c.cvss_score
    ) k
    join public.tenants tn on tn.id = p_tenant_id
    on conflict (dedupe_key) do nothing;
    get diagnostics v_alerts = row_count;
  end if;

  update public.title_version_vulns v set kev_alerted = true
  from public.vuln_cache c
  where v.tenant_id = p_tenant_id and v.run_id = p_run_id and not v.uncertain and not v.kev_alerted
    and c.product_key = v.product_key and c.vuln_id = v.vuln_id and c.kev_added is not null;

  return jsonb_build_object('stored', v_stored, 'new', v_new, 'alerts', v_alerts);
end;
$$;

-- A full run finished: matches the run did not store go, and the state records the run. p_changed (new
-- matches in the run) or removed matches or CVE data read since the last run mark the tenant changed,
-- so the policy evaluates it again.
create or replace function public.vuln_finish_eval(p_tenant_id uuid, p_run_id uuid, p_changed boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_removed integer := 0;
  v_last timestamptz;
  v_changed boolean;
begin
  delete from public.title_version_vulns where tenant_id = p_tenant_id and run_id <> p_run_id;
  get diagnostics v_removed = row_count;

  select evaluated_at into v_last from public.vuln_eval_state where tenant_id = p_tenant_id;
  v_changed := coalesce(p_changed, false) or v_removed > 0
    or v_last is null
    or v_last < coalesce((select m.at from public.maintenance_state m where m.key = 'vulns_changed'), '-infinity');

  insert into public.vuln_eval_state (tenant_id, evaluated_at, changed_at)
  values (p_tenant_id, now(), case when v_changed then now() end)
  on conflict (tenant_id) do update set
    evaluated_at = excluded.evaluated_at,
    changed_at = case when v_changed then excluded.evaluated_at else public.vuln_eval_state.changed_at end;

  return jsonb_build_object('removed', v_removed, 'changed', v_changed);
end;
$$;

-- 4. Policy fields cvss / kev / epss -----------------------------------------------------------------------

alter table public.policy_conditions drop constraint policy_conditions_check;
alter table public.policy_conditions add constraint policy_conditions_check check (case
  when field in ('category', 'subcategory') then operator in ('equals', 'not_equals', 'in', 'not_in')
  when field = 'version' then operator in ('equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'between', 'regex')
  when field in ('cvss', 'epss') then operator in ('equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'between')
  when field = 'kev' then operator in ('equals', 'not_equals')
  else operator in ('equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'regex', 'in', 'not_in')
end);

-- The vulnerability inputs of one installed (title, version): highest CVSS (0 = none), known exploited,
-- highest EPSS (0 = none). Certain matches only.
create or replace function public.title_version_vuln_inputs(p_tenant_id uuid, p_title_id uuid, p_version text)
returns table (max_cvss numeric, kev boolean, max_epss numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(c.cvss_score), 0), coalesce(bool_or(c.kev_added is not null), false), coalesce(max(c.epss), 0)
  from public.title_version_vulns v
  join public.vuln_cache c on c.product_key = v.product_key and c.vuln_id = v.vuln_id
  where v.tenant_id = p_tenant_id and v.title_id = p_title_id and v.version = coalesce(p_version, '') and not v.uncertain;
$$;

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
  max_cvss numeric, kev boolean, max_epss numeric
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
    vi.max_cvss, vi.kev, vi.max_epss
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

drop function public.policy_preview_inputs(uuid);

create function public.policy_preview_inputs(p_tenant_id uuid)
returns table (
  title_id uuid, version text, kind public.title_kind, name text, vendor text, external_id text,
  category_slug text, category_name text, subcategory_slug text, subcategory_name text,
  computers bigint, installations bigint, current_class public.policy_class, current_rule_id uuid,
  max_cvss numeric, kev boolean, max_epss numeric
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
    vi.max_cvss, vi.kev, vi.max_epss
  from pairs p
  join public.software_titles t on t.id = p.title_id
  left join public.title_classification tc on tc.title_id = t.id
  left join public.categories_cache cat on cat.slug = tc.category_slug
  left join public.title_version_policy v on v.tenant_id = p_tenant_id and v.title_id = p.title_id and v.version = p.version
  cross join lateral public.title_version_vuln_inputs(p_tenant_id, p.title_id, p.version) vi
  order by p.computers desc, t.canonical_name, p.version
  limit 20001;
$$;

-- A vulnerability run that changed something makes the policy evaluate the tenant fully again.
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
  from public.policies p
  where p.status = 'published';
$$;

-- 5. Screens ---------------------------------------------------------------------------------------------

-- Computers and installations: CVE counts of the installation's (title, version) at the end.
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
) vv on true;

-- The CVEs of a title's product (every spelling) that affect installed versions, newest first, with the
-- affected installed versions and their computers.
create or replace function public.title_vulns(p_title_id uuid, p_tenant_id uuid default null)
returns table (
  vuln_id text, aliases text[], summary text, published timestamptz, cvss_score numeric, cvss_version text, severity text,
  cvss_vector text, cwe text[], refs text[], kev_added date, kev_due date, kev_ransomware text, epss numeric, epss_percentile numeric,
  uncertain boolean, versions text[], fixed_in text, computers bigint
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
       and i.tenant_id in (select r.tenant_id from public.my_tenant_roles() r)
       and (p_tenant_id is null or i.tenant_id = p_tenant_id))
  from public.title_version_vulns v
  join public.vuln_cache c on c.product_key = v.product_key and c.vuln_id = v.vuln_id
  where v.title_id = any (public.title_group_ids(p_title_id))
    and v.tenant_id in (select r.tenant_id from public.my_tenant_roles() r)
    and (p_tenant_id is null or v.tenant_id = p_tenant_id)
  group by c.product_key, c.vuln_id
  order by bool_and(v.uncertain), (c.kev_added is not null) desc, c.cvss_score desc nulls last, c.published desc nulls last, c.vuln_id;
$$;

-- Overview card: installations and computers with known exploited CVEs, distinct CVEs by severity,
-- affected titles, and when the CVE data was last read.
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
  m as (
    select v.tenant_id, v.title_id, v.version, v.vuln_id, c.severity, c.kev_added
    from public.title_version_vulns v
    join visible on visible.tenant_id = v.tenant_id
    join public.vuln_cache c on c.product_key = v.product_key and c.vuln_id = v.vuln_id
    where not v.uncertain
  ),
  kev_installs as (
    select i.id, i.computer_id
    from public.installations i
    join public.computers cp on cp.id = i.computer_id and cp.retired_at is null
    where i.valid_to is null and exists (
      select 1 from m where m.kev_added is not null and m.tenant_id = i.tenant_id and m.title_id = i.title_id and m.version = coalesce(i.version, ''))
  )
  select jsonb_build_object(
    'vulns', (select count(distinct vuln_id) from m),
    'critical', (select count(distinct vuln_id) from m where severity = 'CRITICAL'),
    'high', (select count(distinct vuln_id) from m where severity = 'HIGH'),
    'kev', (select count(distinct vuln_id) from m where kev_added is not null),
    'titles', (select count(distinct title_id) from m),
    'kev_installations', (select count(*) from kev_installs),
    'kev_computers', (select count(distinct computer_id) from kev_installs),
    'cached', (select count(*) from public.vuln_cache),
    'synced_at', (select max(synced_at) from public.vuln_cache),
    'evaluated_at', (select max(s.evaluated_at) from public.vuln_eval_state s join visible on visible.tenant_id = s.tenant_id)
  );
$$;

-- Changes: new CVEs that affect installed software.
create view public.v_vuln_events
with (security_barrier = true)
as
select e.id, e.tenant_id, e.title_id, t.kind, t.canonical_name, t.vendor, e.version, e.vuln_id,
  c.severity, c.cvss_score, c.kev_added, c.epss, c.summary, e.detected_at
from public.vuln_match_events e
join public.my_tenant_roles() r on r.tenant_id = e.tenant_id
join public.software_titles t on t.id = e.title_id
left join public.vuln_cache c on c.product_key = e.product_key and c.vuln_id = e.vuln_id;

revoke all on table public.v_vuln_events from anon, authenticated;
grant select on table public.v_vuln_events to authenticated;

-- Software: CVE counts per product row and the Vulnerabilities filter (p_vuln: any | kev | critical | high).
drop function public.search_titles(uuid, text, public.title_kind, text, public.attention_level[], text, public.platform, text, text,
  timestamptz, text, boolean, integer, integer, public.policy_class[]);

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
  vulns as (
    select pk.product_key,
      count(distinct v.vuln_id) filter (where not v.uncertain) as vulns,
      count(distinct v.vuln_id) filter (where not v.uncertain and c.severity = 'CRITICAL') as critical,
      count(distinct v.vuln_id) filter (where not v.uncertain and c.severity = 'HIGH') as high,
      count(distinct v.vuln_id) filter (where not v.uncertain and c.kev_added is not null) as kev,
      count(distinct v.vuln_id) filter (where v.uncertain) as possible,
      max(c.cvss_score) filter (where not v.uncertain) as max_cvss
    from (select distinct m.tenant_id, m.title_id, coalesce(m.version, '') as version from matched m) p
    join public.title_products pk on pk.title_id = p.title_id
    join public.title_version_vulns v on v.tenant_id = p.tenant_id and v.title_id = p.title_id and v.version = p.version
    join public.vuln_cache c on c.product_key = v.product_key and c.vuln_id = v.vuln_id
    group by pk.product_key
  )
  select g.title_id, t.kind, t.source, public.product_name(t.canonical_name), t.vendor, t.external_id,
    tc.category_slug, tc.level1_name, tc.level2_name, tc.attention_level, tc.origin, tc.method, tc.confidence,
    g.computers, g.versions, g.latest_version, g.first_seen,
    g.policy_class, pr.lineage_id, pr.name, g.mixed_versions,
    g.product_key, g.spellings,
    coalesce(vu.vulns, 0), coalesce(vu.critical, 0), coalesce(vu.high, 0), coalesce(vu.kev, 0), coalesce(vu.possible, 0), vu.max_cvss,
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

-- The software export takes the same Vulnerabilities filter.
do $$
declare
  v_def text;
  v_line text := '        p_limit => c_max + 1';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'export_csv';
  if (length(v_def) - length(replace(v_def, v_line, ''))) / length(v_line) <> 1 then
    raise exception 'export_csv has changed: update this migration';
  end if;
  execute replace(v_def, v_line, '        p_vuln => nullif(f ->> ''vuln'', ''''),
' || v_line);
end;
$$;

-- Grants ---------------------------------------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'title_vulns(uuid, uuid)', 'vuln_overview(uuid)', 'policy_preview_inputs(uuid)',
    'search_titles(uuid, text, public.title_kind, text, public.attention_level[], text, public.platform, text, text, timestamptz, text, boolean, integer, integer, public.policy_class[], text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;

  foreach f in array array[
    'apply_vulnerability_changes(jsonb, bigint)', 'vuln_due_tenants()', 'vuln_eval_inputs(uuid, uuid, text, integer)',
    'vuln_product_ranges(text[])', 'vuln_store_matches(uuid, uuid, jsonb)', 'vuln_finish_eval(uuid, uuid, boolean)',
    'title_version_vuln_inputs(uuid, uuid, text)', 'policy_eval_inputs(uuid, boolean, uuid, text, integer)', 'policy_due_tenants()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;
