-- Phase 10a: product grouping (with Hub phase H6). Titles whose names differ only by version, architecture
-- or vendor spelling ("7-Zip 23.01 (x64)" from programs v1, "7-Zip" from v2) are one product: Software
-- shows one row with every version, and a title without its own dictionary entry takes the classification
-- of its product. Inventory history is untouched: titles stay as they are; the product is a layer on top.
-- product_name() and vendor_key() are the Hub's functions (hub/supabase/migrations/20261029120000_products.sql)
-- with the same test vectors: change both together.

create or replace function public.product_name(p_name text)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_current text := btrim(coalesce(p_name, ''));
  v_previous text;
begin
  loop
    v_previous := v_current;
    v_current := regexp_replace(v_current,
      '\s*\((?:\s*(?:x64|x86|x86_64|amd64|arm64|aarch64|64-bit|32-bit|64 bit|32 bit|v?\d+(?:\.\d+)+),?\s*)+\)', '', 'gi');
    v_current := regexp_replace(v_current, '\s+-\s+v?\d+(?:\.\d+)+\S*$', '', 'i');
    v_current := regexp_replace(v_current, '\s+(?:v?\d+(?:\.\d+)+[\w.+-]*|x64|x86|amd64|arm64)$', '', 'i');
    -- Dotted package-style names: "Microsoft.UI.Xaml.2.8", "WindowsAppRuntime.2".
    v_current := regexp_replace(v_current, '(?<=[[:alpha:]])\.\d+(?:\.\d+)*$', '');
    v_current := btrim(v_current);
    exit when v_current = v_previous;
  end loop;
  return case when v_current = '' then btrim(coalesce(p_name, '')) else v_current end;
end;
$$;

create or replace function public.vendor_key(p_vendor text)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_key text := btrim(regexp_replace(lower(coalesce(p_vendor, '')), '[^[:alnum:]]+', ' ', 'g'));
  v_previous text;
begin
  loop
    v_previous := v_key;
    v_key := btrim(regexp_replace(v_key,
      '\s(?:inc|incorporated|corp|corporation|co|company|ltd|limited|llc|gmbh|ag|ab|sa|srl|sarl|bv|oy|plc|pty|kk)$', ''));
    exit when v_key = v_previous;
  end loop;
  return v_key;
end;
$$;

-- vendor key | product name; the kind is added when keys are compared (an enum cast is not immutable).
alter table public.software_titles
  add column product_base text generated always as (public.vendor_key(vendor) || '|' || lower(public.product_name(canonical_name))) stored;
create index software_titles_product_idx on public.software_titles (kind, product_base);

-- The Hub's product key of a dictionary entry (kind | vendor | name, with the Hub's vendor aliases).
alter table public.dictionary_cache add column product_key text;
create index dictionary_cache_product_idx on public.dictionary_cache (product_key);

-- apply_dictionary_changes keeps the product key; a full re-sync fills it for entries already cached
-- (same revision, so the upsert rewrites them).
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'apply_dictionary_changes';
  if position('confidence, method, revision, status, hub_seq, synced_at' in v_def) = 0
     or position('coalesce((e ->> ''seq'')::bigint, 0), now()' in v_def) = 0
     or position('      hub_seq = excluded.hub_seq,' in v_def) = 0 then
    raise exception 'apply_dictionary_changes has changed: update this migration';
  end if;
  v_def := replace(v_def, 'confidence, method, revision, status, hub_seq, synced_at', 'confidence, method, revision, status, hub_seq, synced_at, product_key');
  v_def := replace(v_def, 'coalesce((e ->> ''seq'')::bigint, 0), now()', 'coalesce((e ->> ''seq'')::bigint, 0), now(), nullif(e ->> ''product_key'', '''')');
  v_def := replace(v_def, '      hub_seq = excluded.hub_seq,', '      hub_seq = excluded.hub_seq,
      product_key = excluded.product_key,');
  execute v_def;
end;
$$;

update public.hub_connection set last_seq = 0 where id = 1;

-- The product of each title: the Hub's key when its own dictionary entry has one, else the local key.
create view public.title_products
with (security_invoker = true)
as
select t.id as title_id, coalesce(d.product_key, t.kind::text || '|' || t.product_base) as product_key
from public.software_titles t
left join public.dictionary_cache d on d.kind = t.kind and d.source = t.source and d.match_key = t.match_key and d.status = 'published';

revoke all on table public.title_products from anon, authenticated;
grant select on table public.title_products to authenticated;

-- Classification: local override > the title's own dictionary entry > another entry of the same product
-- (so a new spelling is classified before the Hub answers) > unclassified. Same columns as before.
create or replace view public.title_classification
with (security_invoker = true)
as
select
  t.id as title_id,
  c.slug as category_slug,
  l1.name as level1_name,
  c.name as level2_name,
  case
    when o.title_id is not null then coalesce(o.attention_level, c.attention_level)
    when d.kind is not null then d.attention_level
    when f.kind is not null then f.attention_level
  end as attention_level,
  case
    when o.title_id is not null then 'local_override'
    when d.kind is not null or f.kind is not null then 'hub'
    else 'unclassified'
  end as origin,
  case when o.title_id is null then coalesce(d.method, f.method) end as method,
  case when o.title_id is null then coalesce(d.confidence, f.confidence) end as confidence
from public.software_titles t
left join public.local_overrides o on o.title_id = t.id
left join public.dictionary_cache d
  on d.kind = t.kind and d.source = t.source and d.match_key = t.match_key and d.status = 'published'
left join lateral (
  select x.* from public.dictionary_cache x
  where d.kind is null and o.title_id is null and x.status = 'published' and x.kind = t.kind
    and x.product_key = t.kind::text || '|' || t.product_base
  order by x.hub_seq desc
  limit 1
) f on true
left join public.categories_cache c on c.slug = coalesce(o.category_slug, d.category_slug, f.category_slug)
left join public.categories_cache l1 on l1.slug = c.parent_slug;

-- Every title of a product (title page: versions, computers and changes of all spellings).
create or replace function public.title_group_ids(p_title_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(p.title_id), array[p_title_id])
  from public.title_products p
  where p.product_key = (select x.product_key from public.title_products x where x.title_id = p_title_id);
$$;

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
  where i.title_id = any (public.title_group_ids(p_title_id)) and i.valid_to is null and (p_tenant_id is null or i.tenant_id = p_tenant_id)
  group by i.version
  order by public.version_key(i.version) desc;
$$;

-- Software: one row per product. The row links to the spelling with the most installations; the name is
-- the product name; spellings counts the titles grouped in the row.
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
  p_policy public.policy_class[] default null
)
returns table (
  title_id uuid, kind public.title_kind, source text, canonical_name text, vendor text, external_id text,
  category_slug text, level1_name text, level2_name text, attention_level public.attention_level, origin text,
  method text, confidence numeric, computers bigint, versions bigint, latest_version text, first_seen timestamptz,
  policy_class public.policy_class, policy_rule_lineage_id uuid, policy_rule_name text, mixed_versions boolean,
  product_key text, spellings bigint,
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
  )
  select g.title_id, t.kind, t.source, public.product_name(t.canonical_name), t.vendor, t.external_id,
    tc.category_slug, tc.level1_name, tc.level2_name, tc.attention_level, tc.origin, tc.method, tc.confidence,
    g.computers, g.versions, g.latest_version, g.first_seen,
    g.policy_class, pr.lineage_id, pr.name, g.mixed_versions,
    g.product_key, g.spellings,
    count(*) over () as total_count
  from grouped g
  join public.software_titles t on t.id = g.title_id
  left join public.title_classification tc on tc.title_id = g.title_id
  left join public.policy_rules pr on pr.id = g.policy_rule_id
  order by
    case when p_sort = 'computers' and p_desc then g.computers end desc nulls last,
    case when p_sort = 'computers' and not p_desc then g.computers end asc nulls last,
    case when p_sort = 'versions' and p_desc then g.versions end desc nulls last,
    case when p_sort = 'versions' and not p_desc then g.versions end asc nulls last,
    case when p_sort = 'first_seen' and p_desc then g.first_seen end desc nulls last,
    case when p_sort = 'first_seen' and not p_desc then g.first_seen end asc nulls last,
    case when p_sort = 'canonical_name' and p_desc then lower(public.product_name(t.canonical_name)) end desc,
    case when p_sort = 'canonical_name' and not p_desc then lower(public.product_name(t.canonical_name)) end asc,
    lower(public.product_name(t.canonical_name)), g.title_id
  limit least(greatest(p_limit, 1), 100001)
  offset greatest(p_offset, 0);
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'title_group_ids(uuid)', 'title_versions(uuid, uuid)', 'product_name(text)', 'vendor_key(text)',
    'search_titles(uuid, text, public.title_kind, text, public.attention_level[], text, public.platform, text, text, timestamptz, text, boolean, integer, integer, public.policy_class[])'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
