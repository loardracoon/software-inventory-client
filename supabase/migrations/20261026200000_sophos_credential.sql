-- Sophos Central API credential, entered by an admin in Settings.
-- One credential per installation. A partner or organization credential covers all its tenants
-- (Phase 2 lists them through whoami). The client secret lives in Supabase Vault and is write-only
-- from the browser: no function returns it to authenticated users. Edge Functions read it with the
-- service role through get_sophos_credential().

create table public.sophos_connection (
  id smallint primary key default 1 check (id = 1),
  client_id text not null,
  secret_id uuid not null,
  configured_at timestamptz not null default now(),
  configured_by uuid references auth.users (id) on delete set null,
  -- Filled by "Test connection" and the computer sync (Phase 2).
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_message text,
  id_type text check (id_type in ('tenant', 'partner', 'organization')),
  data_region_host text
);

alter table public.sophos_connection enable row level security;
-- No policies: the browser goes through the functions below only.
revoke all on table public.sophos_connection from anon, authenticated;

-- Status for the Settings card. Admins get details; other users only learn whether it is set.
create or replace function public.get_sophos_connection_status()
returns table (
  configured boolean,
  client_id_hint text,
  configured_at timestamptz,
  configured_by_email text,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_message text,
  id_type text,
  data_region_host text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id is not null,
    case when public.is_admin() then '••••' || right(c.client_id, 4) end,
    case when public.is_admin() then c.configured_at end,
    case when public.is_admin() then p.email end,
    c.last_test_at,
    c.last_test_ok,
    case when public.is_admin() then c.last_test_message end,
    c.id_type,
    case when public.is_admin() then c.data_region_host end
  from (select 1) as one
  left join public.sophos_connection c on c.id = 1
  left join public.profiles p on p.id = c.configured_by;
$$;

create or replace function public.set_sophos_credential(p_client_id text, p_client_secret text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_client_id text := btrim(coalesce(p_client_id, ''));
  v_secret text := btrim(coalesce(p_client_secret, ''));
  v_secret_id uuid;
  v_replaced boolean;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change the Sophos Central credential' using errcode = '42501';
  end if;
  if char_length(v_client_id) not between 8 and 200 or v_client_id ~ '\s' then
    raise exception 'Client ID is not valid' using errcode = '22023';
  end if;
  if char_length(v_secret) not between 16 and 1000 or v_secret ~ '\s' then
    raise exception 'Client secret is not valid' using errcode = '22023';
  end if;

  select secret_id into v_secret_id from public.sophos_connection where id = 1 for update;
  v_replaced := v_secret_id is not null;

  if v_replaced then
    perform vault.update_secret(v_secret_id, v_secret);
  else
    v_secret_id := vault.create_secret(v_secret, 'sophos_client_secret', 'Sophos Central API client secret');
  end if;

  insert into public.sophos_connection (id, client_id, secret_id, configured_at, configured_by)
  values (1, v_client_id, v_secret_id, now(), auth.uid())
  on conflict (id) do update set
    client_id = excluded.client_id,
    secret_id = excluded.secret_id,
    configured_at = excluded.configured_at,
    configured_by = excluded.configured_by,
    last_test_at = null,
    last_test_ok = null,
    last_test_message = null,
    id_type = null,
    data_region_host = null;

  -- Never the secret, and only the end of the client ID.
  insert into public.audit_log (user_id, action, target, data)
  values (
    auth.uid(),
    case when v_replaced then 'replace sophos_credential' else 'set sophos_credential' end,
    'sophos_connection',
    jsonb_build_object('client_id_hint', '••••' || right(v_client_id, 4))
  );
end;
$$;

create or replace function public.clear_sophos_credential()
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
    raise exception 'Only admins can change the Sophos Central credential' using errcode = '42501';
  end if;

  delete from public.sophos_connection where id = 1 returning secret_id into v_secret_id;
  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
    insert into public.audit_log (user_id, action, target, data)
    values (auth.uid(), 'remove sophos_credential', 'sophos_connection', null);
  end if;
end;
$$;

-- Server side only (Edge Functions with the service role).
create or replace function public.get_sophos_credential()
returns table (client_id text, client_secret text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.client_id, s.decrypted_secret
  from public.sophos_connection c
  join vault.decrypted_secrets s on s.id = c.secret_id
  where c.id = 1;
$$;

revoke all on function public.get_sophos_connection_status() from public, anon;
revoke all on function public.set_sophos_credential(text, text) from public, anon;
revoke all on function public.clear_sophos_credential() from public, anon;
revoke all on function public.get_sophos_credential() from public, anon, authenticated;

grant execute on function public.get_sophos_connection_status() to authenticated;
grant execute on function public.set_sophos_credential(text, text) to authenticated;
grant execute on function public.clear_sophos_credential() to authenticated;
grant execute on function public.get_sophos_credential() to service_role;
