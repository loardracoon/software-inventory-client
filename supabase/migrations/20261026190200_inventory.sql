-- Phase 1: computers and versioned inventory (SCD type 2).
-- History is never deleted: rows are closed with valid_to, foreign keys to computers restrict
-- deletes, and no table here has a DELETE policy. Every per-computer table carries tenant_id with a
-- composite foreign key to computers, so RLS can filter by tenant without a join.

create table public.computers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  sophos_endpoint_id text not null unique,
  hostname text not null,
  platform public.platform not null,
  os_name text,
  os_version text,
  os_build text,
  associated_user text,
  health text,
  last_seen_at timestamptz,
  last_collected_at timestamptz,
  retired_at timestamptz,
  missing_syncs integer not null default 0 check (missing_syncs >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id)
);

create index computers_tenant_id_idx on public.computers (tenant_id);
create index computers_hostname_trgm_idx on public.computers using gin (hostname extensions.gin_trgm_ops);

create trigger computers_touch_updated_at
  before update on public.computers
  for each row execute function public.touch_updated_at();

-- One successful collection of one domain on one computer. scan_task_id gets its foreign key in the
-- collection migration (scan_tasks is created there).
create table public.snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  computer_id uuid not null,
  domain public.inventory_domain not null,
  scan_task_id uuid,
  query_version integer not null check (query_version > 0),
  collected_at timestamptz not null,
  row_count integer not null check (row_count >= 0),
  content_hash text not null,
  is_baseline boolean not null default false,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (computer_id, tenant_id) references public.computers (id, tenant_id) on delete restrict
);

create index snapshots_computer_domain_idx on public.snapshots (computer_id, domain, collected_at desc);
create index snapshots_tenant_id_idx on public.snapshots (tenant_id);

-- Hardware state over time: one 'hardware' row per computer (item_key '') and one 'disks' row per
-- device_id.
create table public.hardware_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  computer_id uuid not null,
  domain public.inventory_domain not null check (domain in ('hardware', 'disks')),
  item_key text not null default '',
  attrs jsonb not null,
  row_hash text not null,
  snapshot_id uuid references public.snapshots (id) on delete restrict,
  valid_from timestamptz not null,
  valid_to timestamptz,
  check (valid_to is null or valid_to >= valid_from),
  foreign key (computer_id, tenant_id) references public.computers (id, tenant_id) on delete restrict
);

create unique index hardware_versions_one_open_idx
  on public.hardware_versions (computer_id, domain, item_key) where valid_to is null;
create index hardware_versions_validity_idx on public.hardware_versions (computer_id, valid_from, valid_to);
create index hardware_versions_tenant_id_idx on public.hardware_versions (tenant_id);

create table public.software_titles (
  id uuid primary key default gen_random_uuid(),
  kind public.title_kind not null,
  source text not null,
  match_key text not null,
  canonical_name text not null,
  vendor text,
  external_id text,
  first_seen_at timestamptz not null default now(),
  unique (kind, source, match_key)
);

comment on column public.software_titles.source is
  'programs, apps, deb, rpm; chrome, edge, firefox… (browser_type); vscode; npm, chocolatey, pip, homebrew.';
comment on column public.software_titles.match_key is
  'Same key as the Dictionary Hub (kind, source, match_key). Built by the Phase 5 normalizer: '
  'extension = identifier; ide_extension = lower(publisher.name); package = lower(name); '
  'program = lower(trim(name)) || ''|'' || lower(trim(publisher)).';

create index software_titles_name_trgm_idx on public.software_titles using gin (canonical_name extensions.gin_trgm_ops);
create index software_titles_vendor_trgm_idx on public.software_titles using gin (vendor extensions.gin_trgm_ops);
create index software_titles_external_id_trgm_idx on public.software_titles using gin (external_id extensions.gin_trgm_ops);

-- A title on a computer within a scope (user, browser profile, package path) during a period.
-- username is its own column so the viewer views can mask it; attrs must never hold usernames.
create table public.installations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  computer_id uuid not null,
  title_id uuid not null references public.software_titles (id) on delete restrict,
  domain public.inventory_domain not null check (domain in ('programs', 'extensions', 'ide_extensions', 'packages')),
  scope_key text not null default '',
  username text,
  version text,
  path text,
  attrs jsonb not null default '{}',
  row_hash text not null,
  valid_from timestamptz not null,
  valid_to timestamptz,
  first_seen_snapshot uuid references public.snapshots (id) on delete restrict,
  last_seen_snapshot uuid references public.snapshots (id) on delete restrict,
  check (valid_to is null or valid_to >= valid_from),
  foreign key (computer_id, tenant_id) references public.computers (id, tenant_id) on delete restrict
);

create unique index installations_one_open_idx
  on public.installations (computer_id, title_id, scope_key) where valid_to is null;
create index installations_open_by_computer_idx on public.installations (computer_id) where valid_to is null;
create index installations_open_by_title_idx on public.installations (title_id) where valid_to is null;
create index installations_validity_idx on public.installations (valid_from, valid_to);
create index installations_title_history_idx on public.installations (title_id, valid_from);
create index installations_tenant_id_idx on public.installations (tenant_id);

create table public.change_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  computer_id uuid not null,
  title_id uuid not null references public.software_titles (id) on delete restrict,
  installation_id uuid references public.installations (id) on delete restrict,
  domain public.inventory_domain not null,
  change public.change_type not null,
  from_version text,
  to_version text,
  snapshot_id uuid not null references public.snapshots (id) on delete restrict,
  detected_at timestamptz not null default now(),
  foreign key (computer_id, tenant_id) references public.computers (id, tenant_id) on delete restrict
);

create index change_events_detected_at_idx on public.change_events (detected_at desc);
create index change_events_computer_idx on public.change_events (computer_id, detected_at desc);
create index change_events_title_idx on public.change_events (title_id, detected_at desc);
create index change_events_tenant_idx on public.change_events (tenant_id, detected_at desc);

-- RLS. No INSERT, UPDATE or DELETE policies: Edge Functions and SECURITY DEFINER functions write.
alter table public.computers enable row level security;
alter table public.snapshots enable row level security;
alter table public.hardware_versions enable row level security;
alter table public.software_titles enable row level security;
alter table public.installations enable row level security;
alter table public.change_events enable row level security;

-- computers and installations hold usernames: direct reads are for admins and analysts. Viewers
-- read v_computers and v_installations, which mask them.
create policy "Admins and analysts read computers"
  on public.computers for select
  to authenticated
  using (tenant_id in (select r.tenant_id from public.my_tenant_roles() r where r.role in ('admin', 'analyst')));

create policy "Admins and analysts read installations"
  on public.installations for select
  to authenticated
  using (tenant_id in (select r.tenant_id from public.my_tenant_roles() r where r.role in ('admin', 'analyst')));

create policy "Members read snapshots"
  on public.snapshots for select
  to authenticated
  using (tenant_id in (select r.tenant_id from public.my_tenant_roles() r));

create policy "Members read hardware"
  on public.hardware_versions for select
  to authenticated
  using (tenant_id in (select r.tenant_id from public.my_tenant_roles() r));

create policy "Members read change events"
  on public.change_events for select
  to authenticated
  using (tenant_id in (select r.tenant_id from public.my_tenant_roles() r));

-- Title metadata only (the same fields that may go to the Hub); install data lives in installations.
create policy "Signed-in users read software titles"
  on public.software_titles for select
  to authenticated
  using (true);

revoke all on table
  public.computers, public.snapshots, public.hardware_versions,
  public.software_titles, public.installations, public.change_events
  from anon, authenticated;
grant select on table
  public.computers, public.snapshots, public.hardware_versions,
  public.software_titles, public.installations, public.change_events
  to authenticated;
