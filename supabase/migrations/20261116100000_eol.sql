-- Stage 3: end-of-life. The Hub publishes release cycles per product (endoflife.date); this app keeps them in a
-- cache and matches its own installed versions and OS builds locally (Edge Function code in _shared/eol-match.ts,
-- eol-run.ts). Versions never leave this app. These objects store the cache and the results.

alter table public.hub_connection add column eol_last_seq bigint not null default 0;

-- product_key is the Hub's key (os:windows and os:macos for the operating systems).
create table public.eol_cache (
  product_key text primary key,
  slug text not null,
  -- [{ name, label, is_eol, eol_from, latest_name }]
  releases jsonb not null default '[]' check (jsonb_typeof(releases) = 'array'),
  hub_seq bigint not null default 0,
  synced_at timestamptz not null default now()
);

-- Results per tenant: one row per installed (title, version) whose release is known.
create table public.title_version_eol (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  title_id uuid not null references public.software_titles (id) on delete cascade,
  version text not null default '',
  product_key text not null,
  release text not null,
  eol_from date,
  status text not null check (status in ('supported', 'ending_soon', 'eol')),
  computed_at timestamptz not null default now(),
  primary key (tenant_id, title_id, version)
);
create index title_version_eol_status_idx on public.title_version_eol (tenant_id, status);

alter table public.computers
  add column os_eol_release text,
  add column os_eol_from date,
  add column os_eol_status text check (os_eol_status in ('supported', 'ending_soon', 'eol'));

create table public.eol_eval_state (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  evaluated_at timestamptz not null default now()
);

-- Hub feed page (service role): items { product_key, slug, seq, releases }.
create or replace function public.apply_eol_changes(p_items jsonb, p_next_since bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_skipped integer;
  v_upserted integer;
begin
  select count(*) into v_skipped from jsonb_array_elements(coalesce(p_items, '[]')) e
  where nullif(e ->> 'product_key', '') is null or nullif(e ->> 'slug', '') is null;

  with up as (
    insert into public.eol_cache (product_key, slug, releases, hub_seq, synced_at)
    select e ->> 'product_key', e ->> 'slug',
      case when jsonb_typeof(e -> 'releases') = 'array' then e -> 'releases' else '[]'::jsonb end,
      coalesce((e ->> 'seq')::bigint, 0), now()
    from jsonb_array_elements(coalesce(p_items, '[]')) e
    where nullif(e ->> 'product_key', '') is not null and nullif(e ->> 'slug', '') is not null
    on conflict (product_key) do update set slug = excluded.slug, releases = excluded.releases, hub_seq = excluded.hub_seq, synced_at = now()
    returning 1
  )
  select count(*) into v_upserted from up;
  update public.hub_connection set eol_last_seq = greatest(eol_last_seq, coalesce(p_next_since, 0)) where id = 1;
  return jsonb_build_object('upserted', v_upserted, 'skipped', v_skipped);
end;
$$;

-- Pages (keyset on title_id, version) through the tenant's current (title, version) pairs whose product has a cache entry.
create or replace function public.eol_inputs(p_tenant_id uuid, p_after_title uuid default null, p_after_version text default null, p_limit integer default 1000)
returns table (title_id uuid, version text, product_key text)
language sql
stable
security definer
set search_path = ''
as $$
  with pairs as (
    select i.title_id, coalesce(i.version, '') as version
    from public.installations i
    join public.computers c on c.id = i.computer_id and c.retired_at is null
    where i.tenant_id = p_tenant_id and i.valid_to is null
    group by i.title_id, coalesce(i.version, '')
  )
  select p.title_id, p.version, tp.product_key
  from pairs p
  join public.title_products tp on tp.title_id = p.title_id
  where exists (select 1 from public.eol_cache e where e.product_key = tp.product_key)
    and (p_after_title is null or (p.title_id, p.version) > (p_after_title, coalesce(p_after_version, '')))
  order by p.title_id, p.version
  limit least(greatest(p_limit, 1), 5000);
$$;

create or replace function public.eol_cache_get(p_product_keys text[])
returns table (product_key text, releases jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select e.product_key, e.releases from public.eol_cache e where e.product_key = any (p_product_keys);
$$;

create or replace function public.eol_os_inputs(p_tenant_id uuid)
returns table (computer_id uuid, platform public.platform, os_name text, os_version text, os_build text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.platform, c.os_name, c.os_version, c.os_build
  from public.computers c where c.tenant_id = p_tenant_id and c.retired_at is null;
$$;

-- One tenant, one full run: titles [{ title_id, version, product_key, release, eol_from, status }] and
-- computers [{ computer_id, release, eol_from, status }]. Computers not listed have no match (unknown).
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
begin
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

  insert into public.eol_eval_state (tenant_id, evaluated_at) values (p_tenant_id, now())
  on conflict (tenant_id) do update set evaluated_at = now();
  return jsonb_build_object('titles', v_titles, 'computers', v_computers);
end;
$$;

-- Tenants to match: never matched, cache changed since, new inventory since, or matched on an earlier day (the
-- support dates move with the calendar).
create or replace function public.eol_due_tenants()
returns table (tenant_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id
  from public.tenants t
  left join public.eol_eval_state s on s.tenant_id = t.id
  where s.tenant_id is null
    or s.evaluated_at::date < current_date
    or exists (select 1 from public.eol_cache e where e.synced_at > s.evaluated_at)
    or exists (select 1 from public.snapshots n where n.tenant_id = t.id and n.applied_at > s.evaluated_at);
$$;

alter table public.eol_cache enable row level security;
alter table public.title_version_eol enable row level security;
alter table public.eol_eval_state enable row level security;

create policy "Signed-in users read end-of-life releases" on public.eol_cache for select to authenticated using (true);
create policy "Tenant members read end-of-life matches" on public.title_version_eol for select to authenticated
  using (tenant_id in (select r.tenant_id from public.my_tenant_roles() r));

revoke all on table public.eol_cache, public.title_version_eol, public.eol_eval_state from anon, authenticated;
grant select on table public.eol_cache, public.title_version_eol to authenticated;

do $$
declare
  f text;
begin
  foreach f in array array['apply_eol_changes(jsonb, bigint)', 'eol_inputs(uuid, uuid, text, integer)', 'eol_os_inputs(uuid)', 'eol_cache_get(text[])',
                           'eol_replace(uuid, jsonb, jsonb)', 'eol_due_tenants()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;
