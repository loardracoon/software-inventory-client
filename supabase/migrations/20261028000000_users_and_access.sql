-- Users and access.
-- Roles: admin (changes everything), operator (reads everything, exports, requests reclassification and
-- runs Scan now; does not change Settings), viewer (reads without usernames and searches).
-- Access rules decide who may get an account: an email rule (any role, set by an admin, usually with a
-- one-click invitation from the manage-users Edge Function) or a domain rule (anyone with that email
-- domain signs in as viewer or operator). Auth refuses every other new account (trigger below).

-- 1. analyst becomes operator --------------------------------------------------------------------
-- The enum value keeps its OID, so stored policies follow; function bodies hold the text, so rewrite them.
alter type public.app_role rename value 'analyst' to 'operator';

do $$
declare
  f record;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc like '%analyst%'
  loop
    execute replace(pg_get_functiondef(f.oid), 'analyst', 'operator');
  end loop;
end;
$$;

alter policy "Admins and analysts read computers" on public.computers rename to "Admins and operators read computers";
alter policy "Admins and analysts read installations" on public.installations rename to "Admins and operators read installations";

-- 2. The profile role applies to every tenant ------------------------------------------------------
-- Admins: every tenant as admin. Others: their tenant_members rows when they have any, otherwise every
-- tenant with their profile role.
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
  where m.user_id = auth.uid() and not public.is_admin()
  union all
  select t.id, p.role
  from public.tenants t
  join public.profiles p on p.id = auth.uid()
  where not public.is_admin()
    and not exists (select 1 from public.tenant_members m where m.user_id = auth.uid());
$$;

-- 3. Operators run Scan now -------------------------------------------------------------------------
create or replace function public.scan_now(p_computer_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_cycle uuid;
  v_rows integer;
begin
  select tenant_id into v_tenant from public.computers where id = p_computer_id and retired_at is null;
  if v_tenant is null
     or not exists (select 1 from public.my_tenant_roles() r where r.tenant_id = v_tenant and r.role in ('admin', 'operator')) then
    raise exception 'Only admins and operators of this computer''s tenant can scan it' using errcode = '42501';
  end if;

  select id into v_cycle from public.scan_cycles where tenant_id = v_tenant and status = 'open';
  if v_cycle is null then
    raise exception 'There is no open scan cycle for this tenant yet' using errcode = '55000';
  end if;

  perform public.insert_cycle_tasks(v_cycle, p_computer_id);

  update public.scan_tasks
  set priority = true, status = 'pending', next_attempt_at = now(), last_error = null, claimed_at = null
  where cycle_id = v_cycle and computer_id = p_computer_id and status not in ('dispatched', 'skipped');
  get diagnostics v_rows = row_count;

  insert into public.audit_log (user_id, action, target, data)
  values (auth.uid(), 'scan now', 'computers:' || p_computer_id, jsonb_build_object('tasks', v_rows));
  return v_rows;
end;
$$;

create or replace function public.can_scan()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.my_tenant_roles() r where r.role in ('admin', 'operator'));
$$;

-- 4. Access rules ------------------------------------------------------------------------------------
create table public.access_rules (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('email', 'domain')),
  value text not null,
  role public.app_role not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (kind, value),
  -- A domain never grants admin.
  check (kind = 'email' or role in ('viewer', 'operator')),
  check (value = lower(btrim(value))),
  check (
    (kind = 'email' and value ~ '^[^@[:space:]]+@[a-z0-9.-]+\.[a-z]{2,}$')
    or (kind = 'domain' and value ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')
  )
);

comment on table public.access_rules is 'Who may get an account: an exact email (any role) or an email domain (viewer or operator).';

alter table public.access_rules enable row level security;
create policy "Admins read access rules" on public.access_rules for select to authenticated using ((select public.is_admin()));
revoke all on table public.access_rules from anon, authenticated;
grant select on table public.access_rules to authenticated;

-- The role a new account with this email gets: the email rule first, then the domain rule; null = no access.
create or replace function public.access_role_for(p_email text)
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select r.role from public.access_rules r where r.kind = 'email' and r.value = lower(btrim(p_email))),
    (select r.role from public.access_rules r where r.kind = 'domain' and r.value = split_part(lower(btrim(p_email)), '@', 2))
  );
$$;

-- Accounts created by Auth (GoTrue connects as supabase_auth_admin) need a rule, except the very first
-- account of a fresh project (it becomes admin). Accounts inserted by database roles (tests, scripts) pass.
create or replace function public.check_new_user_allowed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if session_user = 'supabase_auth_admin'
     and exists (select 1 from public.profiles)
     and public.access_role_for(new.email) is null then
    raise exception 'No access for %: ask an admin to add your email or your domain', new.email using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.check_new_user_allowed() from public, anon, authenticated;

create trigger before_auth_user_created
  before insert on auth.users
  for each row execute function public.check_new_user_allowed();

-- New profiles take the rule's role (first account: admin; no rule: viewer, for accounts made by scripts).
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
    case when first_user then 'admin'::public.app_role
         else coalesce(public.access_role_for(new.email), 'viewer'::public.app_role) end
  );
  return new;
end;
$$;

-- 5. Admin RPCs (audited) ------------------------------------------------------------------------------
create or replace function public.list_users()
returns table (id uuid, email text, display_name text, role public.app_role, created_at timestamptz, last_sign_in_at timestamptz, access text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins manage users' using errcode = '42501';
  end if;
  return query
    select p.id, p.email, p.display_name, p.role, p.created_at, u.last_sign_in_at,
      case
        when exists (select 1 from public.access_rules r where r.kind = 'email' and r.value = lower(p.email)) then 'email'
        when exists (select 1 from public.access_rules r where r.kind = 'domain' and r.value = split_part(lower(p.email), '@', 2)) then 'domain'
        else 'account'
      end
    from public.profiles p
    left join auth.users u on u.id = p.id
    order by p.email;
end;
$$;

create or replace function public.set_user_role(p_user_id uuid, p_role public.app_role)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_old public.app_role;
begin
  if not public.is_admin() then
    raise exception 'Only admins manage users' using errcode = '42501';
  end if;
  select email, role into v_email, v_old from public.profiles where id = p_user_id for update;
  if v_email is null then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  if v_old = 'admin' and p_role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'Keep at least one admin' using errcode = '22023';
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  -- An email rule for this user follows the change, so a removed and re-invited account gets it back.
  update public.access_rules set role = p_role where kind = 'email' and value = lower(v_email);
  insert into public.audit_log (user_id, action, target, data)
  values (auth.uid(), 'set user role', 'profiles:' || p_user_id, jsonb_build_object('email', v_email, 'from', v_old, 'to', p_role));
end;
$$;

-- Deletes the account (profile and memberships cascade) and its email rule. A domain rule still lets
-- the person sign in again as its role; remove the domain too to block them.
create or replace function public.remove_user(p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_role public.app_role;
begin
  if not public.is_admin() then
    raise exception 'Only admins manage users' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot remove yourself' using errcode = '22023';
  end if;
  select email, role into v_email, v_role from public.profiles where id = p_user_id;
  if v_email is null then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  if v_role = 'admin' and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'Keep at least one admin' using errcode = '22023';
  end if;
  delete from public.access_rules where kind = 'email' and value = lower(v_email);
  delete from auth.users where id = p_user_id;
  insert into public.audit_log (user_id, action, target, data)
  values (auth.uid(), 'remove user', 'profiles:' || p_user_id, jsonb_build_object('email', v_email, 'role', v_role));
end;
$$;

-- Email rules are written by manage-users together with the invitation; this RPC writes domain rules
-- (and email rules, for scripts).
create or replace function public.add_access_rule(p_kind text, p_value text, p_role public.app_role)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_value text := lower(btrim(coalesce(p_value, '')));
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins manage access' using errcode = '42501';
  end if;
  if p_kind = 'domain' then
    v_value := ltrim(v_value, '@');
  end if;
  insert into public.access_rules (kind, value, role, created_by)
  values (p_kind, v_value, p_role, auth.uid())
  on conflict (kind, value) do update set role = excluded.role
  returning id into v_id;
  insert into public.audit_log (user_id, action, target, data)
  values (auth.uid(), 'add access rule', 'access_rules:' || v_id, jsonb_build_object('kind', p_kind, 'value', v_value, 'role', p_role));
  return v_id;
end;
$$;

create or replace function public.delete_access_rule(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_rule public.access_rules;
begin
  if not public.is_admin() then
    raise exception 'Only admins manage access' using errcode = '42501';
  end if;
  delete from public.access_rules where id = p_id returning * into v_rule;
  if v_rule.id is null then
    raise exception 'Rule not found' using errcode = 'P0002';
  end if;
  insert into public.audit_log (user_id, action, target, data)
  values (auth.uid(), 'delete access rule', 'access_rules:' || p_id, jsonb_build_object('kind', v_rule.kind, 'value', v_rule.value, 'role', v_rule.role));
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'can_scan()', 'list_users()', 'set_user_role(uuid, public.app_role)', 'remove_user(uuid)',
    'add_access_rule(text, text, public.app_role)', 'delete_access_rule(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  revoke all on function public.access_role_for(text) from public, anon, authenticated;
  grant execute on function public.access_role_for(text) to service_role;
end;
$$;
