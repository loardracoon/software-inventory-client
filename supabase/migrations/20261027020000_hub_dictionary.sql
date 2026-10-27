-- Phase 7: Dictionary Hub connection and sync state, dictionary changes, reclassification requests,
-- saved searches and server-side CSV exports.

-- Hub connection ------------------------------------------------------------------------------------
-- One row. The client key lives in Vault and is write-only from the browser (same pattern as
-- sophos_connection). The row always exists so the sync state is kept even when the Edge Functions
-- fall back to the HUB_URL / HUB_CLIENT_KEY secrets.

create table public.hub_connection (
  id smallint primary key default 1 check (id = 1),
  url text,
  key_secret_id uuid,
  key_hint text,
  configured_at timestamptz,
  configured_by uuid references auth.users (id) on delete set null,
  share_unknown_titles boolean not null default true,
  last_seq bigint not null default 0,
  synced_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  failures integer not null default 0,
  next_attempt_at timestamptz
);

insert into public.hub_connection (id) values (1);

alter table public.hub_connection enable row level security;
revoke all on table public.hub_connection from anon, authenticated;

create or replace function public.get_hub_status()
returns table (
  configured boolean,
  url text,
  key_hint text,
  configured_at timestamptz,
  share_unknown_titles boolean,
  last_seq bigint,
  synced_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  next_attempt_at timestamptz,
  delayed boolean,
  pending_submissions bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    h.url is not null,
    case when public.is_admin() then h.url end,
    case when public.is_admin() then h.key_hint end,
    h.configured_at,
    h.share_unknown_titles,
    h.last_seq,
    h.synced_at,
    h.last_attempt_at,
    case when public.is_admin() then h.last_error end,
    h.next_attempt_at,
    -- Delayed: the last attempt failed, or nothing succeeded for 12 hours once a sync was expected.
    (h.last_error is not null
      or (coalesce(h.synced_at, h.configured_at, h.last_attempt_at) is not null
          and coalesce(h.synced_at, '-infinity') < now() - interval '12 hours'
          and coalesce(h.configured_at, h.last_attempt_at) < now() - interval '12 hours')),
    (select count(*) from public.hub_submissions s where s.sent_at is null)
  from public.hub_connection h
  where h.id = 1;
$$;

create or replace function public.set_hub_connection(p_url text, p_key text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_url text := rtrim(btrim(coalesce(p_url, '')), '/');
  v_key text := btrim(coalesce(p_key, ''));
  v_old public.hub_connection;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change the Dictionary Hub connection' using errcode = '42501';
  end if;
  if v_url !~ '^https?://[^\s/?#]+(/[^\s?#]*)?$' or char_length(v_url) > 300 then
    raise exception 'Hub URL is not valid' using errcode = '22023';
  end if;
  if char_length(v_key) not between 16 and 500 or v_key ~ '\s' then
    raise exception 'Client key is not valid' using errcode = '22023';
  end if;

  select * into v_old from public.hub_connection where id = 1 for update;
  if v_old.key_secret_id is not null then
    perform vault.update_secret(v_old.key_secret_id, v_key);
  else
    v_old.key_secret_id := vault.create_secret(v_key, 'hub_client_key', 'Dictionary Hub client key');
  end if;

  update public.hub_connection set
    url = v_url,
    key_secret_id = v_old.key_secret_id,
    key_hint = '••••' || right(v_key, 4),
    configured_at = now(),
    configured_by = auth.uid(),
    -- Another hub means another sequence: start over.
    last_seq = case when v_old.url is distinct from v_url then 0 else last_seq end,
    last_error = null,
    failures = 0,
    next_attempt_at = now()
  where id = 1;

  insert into public.audit_log (user_id, action, target, data)
  values (
    auth.uid(),
    case when v_old.url is null then 'set hub_connection' else 'replace hub_connection' end,
    'hub_connection',
    jsonb_build_object('url', v_url, 'key_hint', '••••' || right(v_key, 4))
  );
end;
$$;

create or replace function public.clear_hub_connection()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change the Dictionary Hub connection' using errcode = '42501';
  end if;

  select key_secret_id into v_secret_id from public.hub_connection where id = 1 for update;
  update public.hub_connection set
    url = null, key_secret_id = null, key_hint = null, configured_at = null, configured_by = null,
    last_error = null, failures = 0, next_attempt_at = null
  where id = 1;
  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
    insert into public.audit_log (user_id, action, target, data)
    values (auth.uid(), 'remove hub_connection', 'hub_connection', null);
  end if;
end;
$$;

create or replace function public.set_hub_sharing(p_share boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change the Dictionary Hub settings' using errcode = '42501';
  end if;
  if p_share is null then
    raise exception 'Choose on or off' using errcode = '22023';
  end if;
  update public.hub_connection set share_unknown_titles = p_share where id = 1;
  insert into public.audit_log (user_id, action, target, data)
  values (auth.uid(), 'set hub_sharing', 'hub_connection', jsonb_build_object('share_unknown_titles', p_share));
end;
$$;

-- Server side only. url/key are null when Settings has none (the Edge Functions then use the secrets).
create or replace function public.get_hub_credential()
returns table (url text, client_key text, share_unknown_titles boolean, last_seq bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select h.url, s.decrypted_secret, h.share_unknown_titles, h.last_seq
  from public.hub_connection h
  left join vault.decrypted_secrets s on s.id = h.key_secret_id
  where h.id = 1;
$$;

-- Success: next sync in 6 hours. Failure: exponential backoff from 5 minutes, at most 6 hours.
create or replace function public.hub_sync_finished(p_ok boolean, p_error text default null)
returns timestamptz
language sql
volatile
security definer
set search_path = ''
as $$
  update public.hub_connection set
    last_attempt_at = now(),
    synced_at = case when p_ok then now() else synced_at end,
    last_error = case when p_ok then null else left(coalesce(p_error, 'Unknown error'), 500) end,
    failures = case when p_ok then 0 else failures + 1 end,
    next_attempt_at = now() + case
      when p_ok then interval '6 hours'
      else least(interval '5 minutes' * power(2, least(failures, 10)), interval '6 hours')
    end
  where id = 1
  returning next_attempt_at;
$$;

-- Dictionary changes ----------------------------------------------------------------------------------
-- One page of GET dictionary-changes in one transaction. Categories match by slug (slugs never
-- change) and learn their hub_id; entries point at categories by hub id. Deprecated entries are
-- dropped, so their titles fall back to "Unclassified". Classification is a view, so the titles
-- follow on the next read; title_summary is refreshed by refresh_title_summary_if_due().

create or replace function public.apply_dictionary_changes(p_categories jsonb, p_entries jsonb, p_next_seq bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c jsonb;
  e jsonb;
  v_parent text;
  v_slug text;
  v_attention public.attention_level;
  v_categories integer := 0;
  v_upserted integer := 0;
  v_dropped integer := 0;
  v_skipped integer := 0;
  v_n integer;
begin
  -- Level 1 first, so level 2 rows find their parent.
  for c in
    select x from jsonb_array_elements(coalesce(p_categories, '[]')) x
    order by (x ->> 'parent_id') is not null, (x ->> 'seq')::bigint nulls first
  loop
    v_parent := null;
    if c ->> 'parent_id' is not null then
      select slug into v_parent from public.categories_cache where hub_id = (c ->> 'parent_id')::uuid;
      if v_parent is null then
        v_skipped := v_skipped + 1;
        continue;
      end if;
    end if;
    insert into public.categories_cache as cc (
      slug, hub_id, parent_slug, name, description, attention_level, sophos_firewall_category, revision, seq, deprecated, synced_at
    )
    values (
      c ->> 'slug', (c ->> 'id')::uuid, v_parent, c ->> 'name', c ->> 'description',
      case when v_parent is null then null else coalesce((c ->> 'attention_level')::public.attention_level, 'info') end,
      c ->> 'sophos_firewall_category', coalesce((c ->> 'revision')::integer, 0), coalesce((c ->> 'seq')::bigint, 0),
      coalesce((c ->> 'deprecated')::boolean, false), now()
    )
    on conflict (slug) do update set
      hub_id = excluded.hub_id,
      parent_slug = excluded.parent_slug,
      name = excluded.name,
      description = excluded.description,
      attention_level = excluded.attention_level,
      sophos_firewall_category = excluded.sophos_firewall_category,
      revision = excluded.revision,
      seq = excluded.seq,
      deprecated = excluded.deprecated,
      synced_at = excluded.synced_at;
    v_categories := v_categories + 1;
  end loop;

  for e in select x from jsonb_array_elements(coalesce(p_entries, '[]')) x loop
    if coalesce(e ->> 'status', 'published') <> 'published' then
      delete from public.dictionary_cache
      where kind = (e ->> 'kind')::public.title_kind and source = e ->> 'source' and match_key = e ->> 'match_key';
      get diagnostics v_n = row_count;
      v_dropped := v_dropped + v_n;
      continue;
    end if;

    select slug, attention_level into v_slug, v_attention
    from public.categories_cache
    where hub_id = (e ->> 'category_id')::uuid and parent_slug is not null;
    if v_slug is null or coalesce(e ->> 'method', '') not in ('rule', 'jev', 'jev_auto', 'manual') then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.dictionary_cache as d (
      kind, source, match_key, canonical_name, vendor, description, category_slug, attention_level,
      confidence, method, revision, status, hub_seq, synced_at
    )
    values (
      (e ->> 'kind')::public.title_kind, e ->> 'source', e ->> 'match_key', e ->> 'canonical_name', e ->> 'vendor',
      left(e ->> 'description', 1000), v_slug, coalesce((e ->> 'attention_level')::public.attention_level, v_attention),
      (e ->> 'confidence')::numeric, e ->> 'method', coalesce((e ->> 'revision')::integer, 1), 'published',
      coalesce((e ->> 'seq')::bigint, 0), now()
    )
    on conflict (kind, source, match_key) do update set
      canonical_name = excluded.canonical_name,
      vendor = excluded.vendor,
      description = excluded.description,
      category_slug = excluded.category_slug,
      attention_level = excluded.attention_level,
      confidence = excluded.confidence,
      method = excluded.method,
      revision = excluded.revision,
      hub_seq = excluded.hub_seq,
      synced_at = excluded.synced_at
    where d.revision <= excluded.revision;
    get diagnostics v_n = row_count;
    v_upserted := v_upserted + v_n;
  end loop;

  update public.hub_connection set last_seq = greatest(last_seq, coalesce(p_next_seq, last_seq)) where id = 1;
  if v_categories + v_upserted + v_dropped > 0 then
    insert into public.maintenance_state (key, at) values ('dictionary_changed', now())
    on conflict (key) do update set at = excluded.at;
  end if;

  return jsonb_build_object('categories', v_categories, 'upserted', v_upserted, 'dropped', v_dropped, 'skipped', v_skipped);
end;
$$;

-- Also refresh after a dictionary change (the summary stores each title's category).
create or replace function public.refresh_title_summary_if_due()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_last_refresh timestamptz;
  v_last_change timestamptz;
begin
  select at into v_last_refresh from public.maintenance_state where key = 'title_summary_refreshed';
  select greatest(
    (select max(applied_at) from public.snapshots),
    (select at from public.maintenance_state where key = 'dictionary_changed')
  ) into v_last_change;
  if v_last_change is null
     or (v_last_refresh is not null and (v_last_change <= v_last_refresh or now() - v_last_refresh < interval '5 minutes')) then
    return false;
  end if;
  refresh materialized view concurrently public.title_summary;
  insert into public.maintenance_state (key, at) values ('title_summary_refreshed', now())
  on conflict (key) do update set at = excluded.at;
  return true;
end;
$$;

-- Reclassification requests ---------------------------------------------------------------------------
-- Written by the hub-reclassify and hub-sync Edge Functions; everyone signed in reads them.

create table public.reclassification_requests (
  id uuid primary key default gen_random_uuid(),
  hub_request_id text not null unique,
  title_id uuid not null references public.software_titles (id) on delete cascade,
  current_category_slug text,
  suggested_category_slug text references public.categories_cache (slug) on update cascade on delete set null,
  reason text not null check (char_length(reason) between 1 and 500),
  evidence_url text check (char_length(evidence_url) <= 500),
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected', 'superseded')),
  admin_note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reclassification_requests_title_idx on public.reclassification_requests (title_id, created_at desc);
create index reclassification_requests_open_idx on public.reclassification_requests (created_at) where status = 'open';

alter table public.reclassification_requests enable row level security;

create policy "Signed-in users read reclassification requests"
  on public.reclassification_requests for select
  to authenticated
  using (true);

revoke all on table public.reclassification_requests from anon, authenticated;
grant select on table public.reclassification_requests to authenticated;

-- Saved searches --------------------------------------------------------------------------------------
-- Personal (owner_id = the user) or shared (owner_id null, admins only). params holds the /software
-- URL parameters, so opening a saved search is just a link.

create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  params jsonb not null default '{}' check (jsonb_typeof(params) = 'object'),
  owner_id uuid references auth.users (id) on delete cascade,
  pinned boolean not null default true,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index saved_searches_owner_idx on public.saved_searches (owner_id, name);

alter table public.saved_searches enable row level security;

create policy "Users read their own and shared saved searches"
  on public.saved_searches for select
  to authenticated
  using (owner_id = (select auth.uid()) or owner_id is null);

create policy "Users save searches; admins share them"
  on public.saved_searches for insert
  to authenticated
  with check (owner_id = (select auth.uid()) or (owner_id is null and (select public.is_admin())));

create policy "Users change their searches; admins change shared ones"
  on public.saved_searches for update
  to authenticated
  using (owner_id = (select auth.uid()) or (owner_id is null and (select public.is_admin())))
  with check (owner_id = (select auth.uid()) or (owner_id is null and (select public.is_admin())));

create policy "Users remove their searches; admins remove shared ones"
  on public.saved_searches for delete
  to authenticated
  using (owner_id = (select auth.uid()) or (owner_id is null and (select public.is_admin())));

revoke all on table public.saved_searches from anon, authenticated;
grant select, insert, update, delete on table public.saved_searches to authenticated;

insert into public.saved_searches (name, params, owner_id, pinned, created_by)
values ('Remote access & tunnels', '{"category": "remote-access,proxy-and-tunnel"}', null, true, null);

-- search_titles: p_category takes a comma-separated list of slugs (the seeded search needs two), and
-- export_csv reads up to 100,000 rows (+1 to detect overflow) through it.

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
      and (p_category is null or p_category = '' or exists (
        select 1 from unnest(string_to_array(p_category, ',')) as s (slug)
        where btrim(s.slug) <> '' and (tc.category_slug = btrim(s.slug) or tc.category_slug like btrim(s.slug) || '/%')))
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
  limit least(greatest(p_limit, 1), 100001)
  offset greatest(p_offset, 0);
$$;

-- CSV exports -----------------------------------------------------------------------------------------

-- Admins and analysts (of any tenant) export and request reclassification; viewers do not.
create or replace function public.can_contribute()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or exists (select 1 from public.my_tenant_roles() r where r.role in ('admin', 'analyst'));
$$;

-- Always quoted. Titles, paths and descriptions come from endpoints, so a leading = + - @ (or tab/CR)
-- gets a ' to stop spreadsheets from running it as a formula.
create or replace function public.csv_field(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when p_value is null then ''
    else '"' || replace(case when p_value ~ '^[=+\-@\t\r]' then '''' || p_value else p_value end, '"', '""') || '"'
  end;
$$;

create or replace function public.csv_time(p_value timestamptz)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select to_char(p_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
$$;

-- Search text for ilike: % and _ are literal.
create or replace function public.like_contains(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select '%' || replace(replace(replace(btrim(p_text), '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

-- p_filters mirrors the screen filters in src/features/inventory/api.ts. Rows are read through the
-- same views and RPCs as the screens, so tenant access and user masking are the reader's.
create or replace function public.export_csv(p_dataset text, p_filters jsonb default '{}')
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
    raise exception 'Only admins and analysts can export' using errcode = '42501';
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
    v_header := 'Title,Vendor,Kind,Source,ID,Category,Subcategory,Attention,Classification,Computers,Versions,Newest version,First seen';
    select count(*), string_agg(line, E'\r\n' order by ord) into v_count, v_body
    from (
      select concat_ws(',',
          public.csv_field(s.canonical_name), public.csv_field(s.vendor), public.csv_field(s.kind::text), public.csv_field(s.source),
          public.csv_field(s.external_id), public.csv_field(s.level1_name), public.csv_field(s.level2_name),
          public.csv_field(s.attention_level::text), public.csv_field(s.origin), s.computers, s.versions,
          public.csv_field(s.latest_version), public.csv_time(s.first_seen)) as line,
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
$$;

-- Grants ----------------------------------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'get_hub_status()', 'set_hub_connection(text, text)', 'clear_hub_connection()', 'set_hub_sharing(boolean)',
    'can_contribute()', 'export_csv(text, jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array[
    'get_hub_credential()', 'hub_sync_finished(boolean, text)', 'apply_dictionary_changes(jsonb, jsonb, bigint)',
    'refresh_title_summary_if_due()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['csv_field(text)', 'csv_time(timestamptz)', 'like_contains(text)'] loop
    execute format('revoke all on function public.%s from anon', f);
  end loop;
end;
$$;
