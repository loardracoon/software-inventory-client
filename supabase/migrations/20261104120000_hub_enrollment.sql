-- Phase 10c: an admin asks the Sophizo Hub (https://mcs.sophizo.com.br) for a client key from Settings › Dictionary
-- hub, after agreeing that title metadata is sent to the Hub and processed by third-party AI models. The Edge
-- Function hub-enroll makes the key, keeps it in the Vault from the first moment and sends the Hub only its hash.
-- The collector reads the request status with the key; on approval the same Vault secret becomes the Hub connection
-- key (it is never copied or shown). Connecting another Hub with a key typed by hand stays as it is.

create table public.hub_enrollment (
  id integer primary key default 1 check (id = 1),
  status text not null default 'none'
    check (status in ('none', 'requesting', 'unverified', 'pending', 'approved', 'rejected', 'expired', 'cancelled', 'unknown')),
  hub_url text,
  key_secret_id uuid,
  key_hint text,
  name text,
  organization text,
  contact_email text,
  reason text,
  -- What the admin agreed to: the version of the consent text, who and when.
  consent_version text,
  consented_by uuid references auth.users (id) on delete set null,
  consented_at timestamptz,
  requested_at timestamptz,
  last_checked_at timestamptz,
  next_check_at timestamptz,
  note text,
  last_error text
);
insert into public.hub_enrollment (id) values (1);
alter table public.hub_enrollment enable row level security;
revoke all on table public.hub_enrollment from anon, authenticated;

-- Settings card (admins): everything but the key.
create or replace function public.get_hub_enrollment()
returns table (
  status text, hub_url text, key_hint text, name text, organization text, contact_email text, reason text,
  consent_version text, consented_at timestamptz, requested_at timestamptz, last_checked_at timestamptz,
  next_check_at timestamptz, note text, last_error text
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.status, e.hub_url, e.key_hint, e.name, e.organization, e.contact_email, e.reason, e.consent_version,
    e.consented_at, e.requested_at, e.last_checked_at, e.next_check_at, e.note, e.last_error
  from public.hub_enrollment e
  where e.id = 1 and public.is_admin();
$$;

-- hub-enroll (service role) ------------------------------------------------------------------------------------
-- A new request: refused while a Hub is connected or another request is open. Keeps the key in the Vault.
create or replace function public.hub_enrollment_start(p jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  e public.hub_enrollment;
  v_key text := p ->> 'key';
begin
  if exists (select 1 from public.hub_connection where id = 1 and url is not null) then
    raise exception 'A Dictionary Hub is already connected; remove it first' using errcode = '22023';
  end if;
  select * into e from public.hub_enrollment where id = 1 for update;
  if e.status in ('requesting', 'unverified', 'pending') then
    raise exception 'An access request is already open' using errcode = '22023';
  end if;
  if v_key !~ '^hubk_[0-9a-f]{64}$' then
    raise exception 'Not a client key' using errcode = '22023';
  end if;
  if e.key_secret_id is not null then
    delete from vault.secrets where id = e.key_secret_id;
  end if;
  update public.hub_enrollment set
    status = 'requesting', hub_url = p ->> 'hub_url',
    key_secret_id = vault.create_secret(v_key, 'hub_enrollment_key_' || gen_random_uuid(), 'Dictionary Hub client key (access request)'),
    key_hint = '••••' || right(v_key, 4), name = p ->> 'name', organization = p ->> 'organization', contact_email = p ->> 'contact_email',
    reason = p ->> 'reason', consent_version = p ->> 'consent_version', consented_by = (p ->> 'user_id')::uuid, consented_at = now(),
    requested_at = now(), last_checked_at = null, next_check_at = null, note = null, last_error = null
  where id = 1;
  insert into public.audit_log (user_id, action, target, data)
  values ((p ->> 'user_id')::uuid, 'request hub access', 'hub_enrollment',
    jsonb_build_object('hub_url', p ->> 'hub_url', 'contact_email', p ->> 'contact_email', 'consent_version', p ->> 'consent_version'));
end;
$$;

-- The key of the open request (service role only: hub-enroll and the collector).
create or replace function public.hub_enrollment_key()
returns table (hub_url text, key text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.hub_url, s.decrypted_secret, e.status
  from public.hub_enrollment e
  join vault.decrypted_secrets s on s.id = e.key_secret_id
  where e.id = 1;
$$;

-- A new status from the Hub. Final states other than approved delete the key.
create or replace function public.hub_enrollment_update(p_status text, p_note text, p_error text, p_next_check_at timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  e public.hub_enrollment;
begin
  select * into e from public.hub_enrollment where id = 1 for update;
  if p_status in ('none', 'rejected', 'expired', 'cancelled', 'unknown') and e.key_secret_id is not null then
    delete from vault.secrets where id = e.key_secret_id;
    e.key_secret_id := null;
  end if;
  update public.hub_enrollment set status = coalesce(p_status, status), note = coalesce(left(p_note, 500), note), last_error = left(p_error, 500),
    last_checked_at = now(), next_check_at = p_next_check_at, key_secret_id = e.key_secret_id,
    key_hint = case when e.key_secret_id is null then null else key_hint end
  where id = 1;
end;
$$;

-- Approved: the same Vault secret becomes the Hub connection key, and the sync starts.
create or replace function public.hub_enrollment_activate()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  e public.hub_enrollment;
  v_old uuid;
begin
  select * into e from public.hub_enrollment where id = 1 for update;
  if e.key_secret_id is null or e.hub_url is null then
    raise exception 'No access request with a key' using errcode = '22023';
  end if;
  select key_secret_id into v_old from public.hub_connection where id = 1 and url is not null for update;
  -- An admin connected a Hub by hand while the request was open: keep that connection, drop the requested key.
  if v_old is not null then
    delete from vault.secrets where id = e.key_secret_id;
    update public.hub_enrollment set status = 'approved', key_secret_id = null, key_hint = null, last_checked_at = now(), next_check_at = null,
      note = 'Approved, but a Hub was connected by hand meanwhile: the requested key was discarded'
    where id = 1;
    return;
  end if;
  update public.hub_connection set
    url = e.hub_url, key_secret_id = e.key_secret_id, key_hint = e.key_hint, configured_at = now(), configured_by = e.consented_by,
    last_seq = 0, vuln_last_seq = 0, last_error = null, failures = 0, next_attempt_at = now()
  where id = 1;
  update public.hub_enrollment set status = 'approved', key_secret_id = null, last_checked_at = now(), next_check_at = null, last_error = null
  where id = 1;
  insert into public.audit_log (user_id, action, target, data)
  values (e.consented_by, 'set hub_connection', 'hub_connection',
    jsonb_build_object('url', e.hub_url, 'key_hint', e.key_hint, 'via', 'access request'));
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['hub_enrollment_start(jsonb)', 'hub_enrollment_key()', 'hub_enrollment_update(text, text, text, timestamptz)', 'hub_enrollment_activate()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;
revoke all on function public.get_hub_enrollment() from public, anon;
grant execute on function public.get_hub_enrollment() to authenticated;

-- A Hub URL typed by hand must use https://, except local and in-cluster hosts (development, Docker, Kubernetes).
do $$
declare
  v_def text;
  v_line text := '  if v_url !~ ''^https?://[^\s/?#]+(/[^\s?#]*)?$'' or char_length(v_url) > 300 then';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'set_hub_connection';
  if position(v_line in v_def) = 0 then
    raise exception 'set_hub_connection has changed: update this migration';
  end if;
  execute replace(v_def, v_line, '  if v_url ~* ''^http://'' and v_url !~* ''^http://(localhost|127\.0\.0\.1|host\.docker\.internal|kong|[a-z0-9-]+(\.[a-z0-9-]+)*\.svc\.cluster\.local)(:[0-9]+)?(/|$)'' then
    raise exception ''Hub URL must use https:// (plain http only for local or in-cluster hosts)'' using errcode = ''22023'';
  end if;
' || v_line);
end;
$$;
