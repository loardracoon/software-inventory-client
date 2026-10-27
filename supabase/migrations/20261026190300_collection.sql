-- Phase 1: weekly cycle, scan tasks, query catalog, Sophos runs, raw results, API budget and
-- collector logs. The collector (Phase 4) writes with the service role; the browser only reads,
-- except scan_settings, which tenant admins edit.

create table public.scan_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  -- ISO weekday: 1 = Monday ... 7 = Sunday, in the tenant time zone.
  cycle_weekday smallint not null default 1 check (cycle_weekday between 1 and 7),
  cycle_time time not null default '10:00',
  retry_time time not null default '11:00',
  timezone text not null default 'America/Sao_Paulo',
  batch_size integer not null default 50 check (batch_size between 1 and 500),
  max_active_runs integer not null default 4 check (max_active_runs between 1 and 4),
  runs_per_minute integer not null default 10 check (runs_per_minute between 1 and 10),
  daily_run_limit integer not null default 1000 check (daily_run_limit between 1 and 1000),
  reserve_pct integer not null default 20 check (reserve_pct between 0 and 90),
  run_grace_minutes integer not null default 10 check (run_grace_minutes between 1 and 60),
  provider public.query_provider not null default 'live_endpoint_search',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create or replace function public.validate_scan_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown time zone: %', new.timezone using errcode = '22023';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger scan_settings_validate
  before insert or update on public.scan_settings
  for each row execute function public.validate_scan_settings();

-- Every tenant starts with the default schedule.
create or replace function public.create_default_scan_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.scan_settings (tenant_id) values (new.id) on conflict (tenant_id) do nothing;
  return new;
end;
$$;

revoke all on function public.create_default_scan_settings() from public, anon, authenticated;

create trigger tenants_default_scan_settings
  after insert on public.tenants
  for each row execute function public.create_default_scan_settings();

create table public.scan_cycles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  opened_at timestamptz not null default now(),
  closes_at timestamptz not null,
  closed_at timestamptz,
  status public.cycle_status not null default 'open',
  coverage_pct numeric(5, 2) check (coverage_pct between 0 and 100),
  unique (id, tenant_id),
  check (closes_at > opened_at)
);

create unique index scan_cycles_one_open_idx on public.scan_cycles (tenant_id) where status = 'open';
create index scan_cycles_tenant_opened_idx on public.scan_cycles (tenant_id, opened_at desc);

-- Versioned osquery packs, changed only by migration (no write policy). Seeded in Phase 3.
create table public.query_catalog (
  id uuid primary key default gen_random_uuid(),
  domain public.inventory_domain not null,
  platform public.platform not null,
  version integer not null check (version > 0),
  name text not null,
  sql text not null,
  required_tables text[] not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (platform, name, version)
);

comment on column public.query_catalog.name is 'Query name without version, e.g. inv.extensions or inv.programs.deb.';

create table public.platform_capabilities (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  platform public.platform not null,
  osquery_tables text[] not null default '{}',
  probed_at timestamptz not null default now(),
  primary key (tenant_id, platform)
);

create table public.query_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  sophos_run_id text,
  provider public.query_provider not null,
  domain public.inventory_domain not null,
  platform public.platform not null,
  query_id uuid references public.query_catalog (id) on delete restrict,
  query_version integer not null check (query_version > 0),
  -- Sophos endpoint IDs sent in this run (computers.sophos_endpoint_id).
  endpoint_ids text[] not null default '{}',
  priority boolean not null default false,
  status public.run_status not null default 'running',
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  cancelled boolean not null default false,
  unique (provider, sophos_run_id)
);

create index query_runs_tenant_started_idx on public.query_runs (tenant_id, started_at desc);
create index query_runs_active_idx on public.query_runs (tenant_id) where status = 'running';

create table public.scan_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  cycle_id uuid not null,
  computer_id uuid not null,
  domain public.inventory_domain not null,
  status public.task_status not null default 'pending',
  priority boolean not null default false,
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_run_id uuid references public.query_runs (id) on delete restrict,
  last_error text,
  updated_at timestamptz not null default now(),
  unique (cycle_id, computer_id, domain),
  foreign key (cycle_id, tenant_id) references public.scan_cycles (id, tenant_id) on delete restrict,
  foreign key (computer_id, tenant_id) references public.computers (id, tenant_id) on delete restrict
);

create index scan_tasks_due_idx on public.scan_tasks (status, next_attempt_at);
create index scan_tasks_computer_idx on public.scan_tasks (computer_id);
create index scan_tasks_tenant_idx on public.scan_tasks (tenant_id);
create index scan_tasks_last_run_idx on public.scan_tasks (last_run_id);

create trigger scan_tasks_touch_updated_at
  before update on public.scan_tasks
  for each row execute function public.touch_updated_at();

alter table public.snapshots
  add constraint snapshots_scan_task_id_fkey
  foreign key (scan_task_id) references public.scan_tasks (id) on delete restrict;
create index snapshots_scan_task_idx on public.snapshots (scan_task_id);

-- Raw rows returned by one computer in one run. Kept 90 days (retention job, Phase 8).
create table public.raw_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  run_id uuid not null references public.query_runs (id) on delete restrict,
  computer_id uuid not null,
  rows jsonb not null,
  row_count integer not null check (row_count >= 0),
  received_at timestamptz not null default now(),
  unique (run_id, computer_id),
  foreign key (computer_id, tenant_id) references public.computers (id, tenant_id) on delete restrict
);

create index raw_results_received_at_idx on public.raw_results (received_at);
create index raw_results_computer_idx on public.raw_results (computer_id);

create table public.api_budget (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  minute timestamptz not null check (minute = date_trunc('minute', minute)),
  runs integer not null default 0 check (runs >= 0),
  primary key (tenant_id, minute)
);

create table public.collector_logs (
  id bigint generated always as identity primary key,
  step text not null,
  tenant_id uuid references public.tenants (id) on delete set null,
  level text not null default 'info' check (level in ('debug', 'info', 'warn', 'error')),
  message text not null,
  data jsonb,
  created_at timestamptz not null default now()
);

create index collector_logs_created_at_idx on public.collector_logs (created_at desc);
create index collector_logs_tenant_idx on public.collector_logs (tenant_id, created_at desc);

-- RLS
alter table public.scan_settings enable row level security;
alter table public.scan_cycles enable row level security;
alter table public.query_catalog enable row level security;
alter table public.platform_capabilities enable row level security;
alter table public.query_runs enable row level security;
alter table public.scan_tasks enable row level security;
alter table public.raw_results enable row level security;
alter table public.api_budget enable row level security;
alter table public.collector_logs enable row level security;

create policy "Members read scan settings"
  on public.scan_settings for select
  to authenticated
  using (tenant_id in (select r.tenant_id from public.my_tenant_roles() r));

create policy "Tenant admins create scan settings"
  on public.scan_settings for insert
  to authenticated
  with check (tenant_id in (select r.tenant_id from public.my_tenant_roles() r where r.role = 'admin'));

create policy "Tenant admins change scan settings"
  on public.scan_settings for update
  to authenticated
  using (tenant_id in (select r.tenant_id from public.my_tenant_roles() r where r.role = 'admin'))
  with check (tenant_id in (select r.tenant_id from public.my_tenant_roles() r where r.role = 'admin'));

create policy "Members read scan cycles"
  on public.scan_cycles for select
  to authenticated
  using (tenant_id in (select r.tenant_id from public.my_tenant_roles() r));

create policy "Signed-in users read the query catalog"
  on public.query_catalog for select
  to authenticated
  using (true);

create policy "Members read platform capabilities"
  on public.platform_capabilities for select
  to authenticated
  using (tenant_id in (select r.tenant_id from public.my_tenant_roles() r));

create policy "Members read query runs"
  on public.query_runs for select
  to authenticated
  using (tenant_id in (select r.tenant_id from public.my_tenant_roles() r));

create policy "Members read scan tasks"
  on public.scan_tasks for select
  to authenticated
  using (tenant_id in (select r.tenant_id from public.my_tenant_roles() r));

create policy "Admins read raw results"
  on public.raw_results for select
  to authenticated
  using ((select public.is_admin()));

create policy "Admins read the API budget"
  on public.api_budget for select
  to authenticated
  using ((select public.is_admin()));

create policy "Admins read collector logs"
  on public.collector_logs for select
  to authenticated
  using ((select public.is_admin()));

revoke all on table
  public.scan_settings, public.scan_cycles, public.query_catalog, public.platform_capabilities,
  public.query_runs, public.scan_tasks, public.raw_results, public.api_budget, public.collector_logs
  from anon, authenticated;
grant select on table
  public.scan_settings, public.scan_cycles, public.query_catalog, public.platform_capabilities,
  public.query_runs, public.scan_tasks, public.raw_results, public.api_budget, public.collector_logs
  to authenticated;
grant insert, update on table public.scan_settings to authenticated;
