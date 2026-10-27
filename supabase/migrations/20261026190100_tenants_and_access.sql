-- Phase 1: Sophos tenants and per-tenant access.
-- Global admins (profiles.role = 'admin') see and manage every tenant. Analysts and viewers see
-- only the tenants listed for them in tenant_members, with the role set there.

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  sophos_tenant_id text not null unique,
  name text not null,
  id_type text not null check (id_type in ('tenant', 'partner', 'organization')),
  data_region_host text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger tenants_touch_updated_at
  before update on public.tenants
  for each row execute function public.touch_updated_at();

create table public.tenant_members (
  user_id uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  role public.app_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

create index tenant_members_tenant_id_idx on public.tenant_members (tenant_id);

-- Effective role per visible tenant for the calling user. Policies use it as a set
-- (tenant_id in (select ...)), so Postgres evaluates it once per query, not once per row.
create or replace function public.my_tenant_roles()
returns table (tenant_id uuid, role public.app_role)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, 'admin'::public.app_role
  from public.tenants t
  where public.is_admin()
  union all
  select m.tenant_id, m.role
  from public.tenant_members m
  where m.user_id = auth.uid() and not public.is_admin();
$$;

revoke all on function public.my_tenant_roles() from public, anon;
grant execute on function public.my_tenant_roles() to authenticated;

-- Policy patterns used by every tenant-scoped table:
--   read:                 tenant_id in (select r.tenant_id from public.my_tenant_roles() r)
--   read with usernames:  ... where r.role in ('admin', 'analyst')
--   admin write:          ... where r.role = 'admin'

alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;

create policy "Members read their tenants"
  on public.tenants for select
  to authenticated
  using (id in (select r.tenant_id from public.my_tenant_roles() r));

create policy "Users read their memberships; admins read all"
  on public.tenant_members for select
  to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy "Admins add members"
  on public.tenant_members for insert
  to authenticated
  with check ((select public.is_admin()));

create policy "Admins change members"
  on public.tenant_members for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Admins remove members"
  on public.tenant_members for delete
  to authenticated
  using ((select public.is_admin()));

revoke all on table public.tenants, public.tenant_members from anon, authenticated;
grant select on table public.tenants to authenticated;
grant select, insert, update, delete on table public.tenant_members to authenticated;
