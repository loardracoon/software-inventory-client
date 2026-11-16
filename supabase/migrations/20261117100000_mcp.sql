-- Phase 11 M1: MCP server settings, personal tokens and audit (docs/phases/client-11-mcp.md).
-- The mcp Edge Function resolves a personal token (service role), signs a 5-minute JWT for its user and calls
-- PostgREST with it, so RLS, my_tenant_roles() and masking apply. Nothing here returns a token after creation.

create type public.mcp_scope as enum ('read', 'policy_draft');

-- Settings (one row) -------------------------------------------------------------------------------------

create table public.mcp_settings (
  id smallint primary key default 1 check (id = 1),
  -- Off by default: MCP results go to the model provider of the user's assistant.
  enabled boolean not null default false,
  -- Off by default: usernames, user scope and user folders stay masked in MCP results, admins included.
  show_usernames boolean not null default false,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.mcp_settings (id) values (1);

alter table public.mcp_settings enable row level security;
revoke all on table public.mcp_settings from anon, authenticated;

create or replace function public.get_mcp_settings()
returns table (enabled boolean, show_usernames boolean, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.enabled, s.show_usernames, s.updated_at
  from public.mcp_settings s
  where s.id = 1 and auth.uid() is not null;
$$;

create or replace function public.set_mcp_settings(p_enabled boolean, p_show_usernames boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change the AI assistant settings' using errcode = '42501';
  end if;
  if p_enabled is null or p_show_usernames is null then
    raise exception 'Choose on or off' using errcode = '22023';
  end if;
  update public.mcp_settings
  set enabled = p_enabled, show_usernames = p_show_usernames, updated_by = auth.uid(), updated_at = now()
  where id = 1;
  insert into public.audit_log (user_id, action, target, data)
  values (auth.uid(), 'set mcp_settings', 'mcp_settings',
          jsonb_build_object('enabled', p_enabled, 'show_usernames', p_show_usernames));
end;
$$;

-- Personal tokens ---------------------------------------------------------------------------------------

create table public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- sha256 of the whole token; the token itself is never stored.
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  -- Last 4 characters, to tell tokens apart in the list.
  token_hint text not null check (char_length(token_hint) = 4),
  scope public.mcp_scope not null default 'read',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  check (expires_at > created_at and expires_at <= created_at + interval '90 days')
);

create index mcp_tokens_user_idx on public.mcp_tokens (user_id);

alter table public.mcp_tokens enable row level security;
revoke all on table public.mcp_tokens from anon, authenticated;

-- The list never returns the hash. Users see their own tokens; admins see everyone's.
create or replace function public.mcp_token_list()
returns table (id uuid, user_id uuid, email text, name text, token_hint text, scope public.mcp_scope,
               created_at timestamptz, expires_at timestamptz, last_used_at timestamptz, revoked_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.user_id, p.email, t.name, t.token_hint, t.scope, t.created_at, t.expires_at, t.last_used_at,
         t.revoked_at
  from public.mcp_tokens t
  left join public.profiles p on p.id = t.user_id
  where auth.uid() is not null and (t.user_id = auth.uid() or public.is_admin())
  order by t.created_at desc;
$$;

-- Returns the token once. policy_draft only for global admins or admins of at least one tenant (the policy
-- RPCs still check the tenant on every call).
create or replace function public.mcp_token_create(p_name text, p_scope public.mcp_scope, p_days integer default 30)
returns table (id uuid, token text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_scope is null or p_name is null or char_length(btrim(p_name)) not between 1 and 80 then
    raise exception 'Give the token a name (1 to 80 characters) and a scope' using errcode = '22023';
  end if;
  if p_days is null or p_days not between 1 and 90 then
    raise exception 'A token lasts 1 to 90 days' using errcode = '22023';
  end if;
  if p_scope = 'policy_draft' and not public.is_admin()
     and not exists (select 1 from public.my_tenant_roles() r where r.role = 'admin') then
    raise exception 'Only admins can create tokens that change policy drafts' using errcode = '42501';
  end if;
  v_token := 'eimcp_' || translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
  v_expires := now() + make_interval(days => p_days);
  insert into public.mcp_tokens (user_id, name, token_hash, token_hint, scope, expires_at)
  values (auth.uid(), btrim(p_name), extensions.digest(v_token, 'sha256'), right(v_token, 4), p_scope, v_expires)
  returning mcp_tokens.id into v_id;
  insert into public.audit_log (user_id, action, target, data)
  values (auth.uid(), 'create mcp_token', 'mcp_tokens',
          jsonb_build_object('id', v_id, 'name', btrim(p_name), 'scope', p_scope, 'expires_at', v_expires));
  return query select v_id, v_token, v_expires;
end;
$$;

create or replace function public.mcp_token_revoke(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select t.user_id into v_owner from public.mcp_tokens t where t.id = p_id;
  if v_owner is null or auth.uid() is null or (v_owner <> auth.uid() and not public.is_admin()) then
    raise exception 'Token not found' using errcode = 'P0002';
  end if;
  update public.mcp_tokens set revoked_at = now(), revoked_by = auth.uid()
  where id = p_id and revoked_at is null;
  insert into public.audit_log (user_id, action, target, data)
  values (auth.uid(), 'revoke mcp_token', 'mcp_tokens', jsonb_build_object('id', p_id, 'owner', v_owner));
end;
$$;

-- Service role only: the mcp function passes sha256(token). Returns nothing for unknown, revoked or expired
-- tokens, or while the MCP switch is off (enabled = false is returned so the function can say why).
create or replace function public.mcp_token_resolve(p_hash bytea)
returns table (token_id uuid, user_id uuid, scope public.mcp_scope, enabled boolean, show_usernames boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
  update public.mcp_tokens t set last_used_at = now()
  from public.mcp_settings s
  where t.token_hash = p_hash and t.revoked_at is null and t.expires_at > now() and s.id = 1
    and exists (select 1 from auth.users u where u.id = t.user_id)
  returning t.id, t.user_id, t.scope, s.enabled, s.show_usernames;
end;
$$;

-- Audit of tool calls -----------------------------------------------------------------------------------

create table public.mcp_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  token_id uuid references public.mcp_tokens (id) on delete set null,
  method text not null check (char_length(method) <= 80),
  tool text check (char_length(tool) <= 80),
  -- Arguments only (never results); the function drops anything that looks like a secret.
  arguments jsonb check (octet_length(arguments::text) <= 8192),
  tenant_id uuid,
  row_count integer,
  duration_ms integer,
  outcome text not null check (outcome in ('ok', 'denied', 'error', 'disabled')),
  error text check (char_length(error) <= 500)
);

create index mcp_audit_at_idx on public.mcp_audit (at desc);
create index mcp_audit_user_idx on public.mcp_audit (user_id, at desc);

alter table public.mcp_audit enable row level security;
revoke all on table public.mcp_audit from anon, authenticated;
grant select on table public.mcp_audit to authenticated;
grant insert on table public.mcp_audit to service_role;

create policy mcp_audit_admin_read on public.mcp_audit
  for select to authenticated
  using (public.is_admin());

create or replace function public.purge_mcp_audit(p_days integer default 180)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  delete from public.mcp_audit where at < now() - make_interval(days => greatest(p_days, 30));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

select cron.schedule('mcp-audit-retention', '45 4 * * *', 'select public.purge_mcp_audit(180)');

-- Grants ------------------------------------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'get_mcp_settings()', 'set_mcp_settings(boolean, boolean)', 'mcp_token_list()',
    'mcp_token_create(text, public.mcp_scope, integer)', 'mcp_token_revoke(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['mcp_token_resolve(bytea)', 'purge_mcp_audit(integer)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;
