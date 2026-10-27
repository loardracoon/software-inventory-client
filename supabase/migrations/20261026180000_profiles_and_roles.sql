-- Phase 0: user profiles and app roles.
-- Roles: admin (configures and triggers scans), analyst (reads everything and exports),
-- viewer (reads without usernames). Per-tenant membership arrives in Phase 1 (tenant_members).

create type public.app_role as enum ('admin', 'analyst', 'viewer');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  role public.app_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'One row per signed-in user. Role changes are admin-only and audited from Phase 1 on.';

alter table public.profiles enable row level security;

-- Role of the calling user. SECURITY DEFINER so policies on profiles can call it without recursion.
create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() = 'admin', false);
$$;

revoke all on function public.current_app_role() from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_admin() to authenticated;

create policy "Users read their own profile"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

create policy "Admins read every profile"
  on public.profiles for select
  to authenticated
  using ((select public.is_admin()));

create policy "Admins update profiles"
  on public.profiles for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- No insert or delete policies: rows are created by the auth trigger below and removed by the
-- auth.users cascade. Users cannot change their own role.

revoke all on table public.profiles from anon;
grant select, update on table public.profiles to authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Create a profile for every new auth user. The first user of a fresh project becomes admin
-- (bootstrap); everyone after starts as viewer and an admin promotes them.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_user boolean;
begin
  perform pg_advisory_xact_lock(hashtext('public.handle_new_user'));
  select not exists (select 1 from public.profiles) into first_user;

  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    case when first_user then 'admin'::public.app_role else 'viewer'::public.app_role end
  );
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
