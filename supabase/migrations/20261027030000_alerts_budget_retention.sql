-- Phase 8: alerts (webhook + email), the API budget panel and raw_results retention.

-- Alert settings ------------------------------------------------------------------------------------
-- One row. The webhook URL (it often carries a token) and the Resend API key live in Vault and are
-- write-only from the browser.

create table public.alert_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default true,
  webhook_secret_id uuid,
  webhook_hint text,
  resend_secret_id uuid,
  email_from text,
  email_to text[] not null default '{}',
  coverage_threshold numeric(5, 2) not null default 90 check (coverage_threshold between 1 and 100),
  stale_minutes integer not null default 30 check (stale_minutes between 10 and 1440),
  updated_at timestamptz,
  updated_by uuid references auth.users (id) on delete set null
);

insert into public.alert_settings (id) values (1);

alter table public.alert_settings enable row level security;
revoke all on table public.alert_settings from anon, authenticated;

-- Detected alerts; dedupe_key makes detection idempotent.
create table public.alerts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('coverage_low', 'query_error', 'collector_stale', 'test')),
  dedupe_key text not null unique,
  tenant_id uuid references public.tenants (id) on delete cascade,
  title text not null,
  body text not null,
  data jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0,
  last_error text
);

create index alerts_pending_idx on public.alerts (created_at) where sent_at is null;

alter table public.alerts enable row level security;

create policy "Admins read alerts"
  on public.alerts for select
  to authenticated
  using ((select public.is_admin()));

revoke all on table public.alerts from anon, authenticated;
grant select on table public.alerts to authenticated;

-- Admins change the settings. null keeps a value; secrets are never returned or audited.
create or replace function public.set_alert_settings(
  p_webhook_url text default null,
  p_resend_key text default null,
  p_email_from text default null,
  p_email_to text[] default null,
  p_coverage_threshold numeric default null,
  p_stale_minutes integer default null,
  p_enabled boolean default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.alert_settings;
  v_url text := nullif(btrim(coalesce(p_webhook_url, '')), '');
  v_key text := nullif(btrim(coalesce(p_resend_key, '')), '');
  v_to text[];
begin
  if not public.is_admin() then
    raise exception 'Only admins can change alerts' using errcode = '42501';
  end if;
  if v_url is not null and (v_url !~ '^https?://[^\s/?#]+' or char_length(v_url) > 2000) then
    raise exception 'Webhook URL is not valid' using errcode = '22023';
  end if;
  if v_key is not null and (char_length(v_key) not between 10 and 300 or v_key ~ '\s') then
    raise exception 'Resend API key is not valid' using errcode = '22023';
  end if;
  if p_email_from is not null and btrim(p_email_from) <> '' and btrim(p_email_from) !~ '^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$' then
    raise exception 'Sender address is not valid' using errcode = '22023';
  end if;
  if p_email_to is not null then
    select coalesce(array_agg(distinct lower(btrim(e))), '{}') into v_to from unnest(p_email_to) e where btrim(e) <> '';
    if cardinality(v_to) > 20 or exists (select 1 from unnest(v_to) e where e !~ '^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$') then
      raise exception 'Recipients must be up to 20 valid email addresses' using errcode = '22023';
    end if;
  end if;

  select * into s from public.alert_settings where id = 1 for update;
  if v_url is not null then
    if s.webhook_secret_id is null then
      s.webhook_secret_id := vault.create_secret(v_url, 'alert_webhook_url', 'Alert webhook URL');
    else
      perform vault.update_secret(s.webhook_secret_id, v_url);
    end if;
  end if;
  if v_key is not null then
    if s.resend_secret_id is null then
      s.resend_secret_id := vault.create_secret(v_key, 'alert_resend_key', 'Resend API key for alert emails');
    else
      perform vault.update_secret(s.resend_secret_id, v_key);
    end if;
  end if;

  update public.alert_settings set
    webhook_secret_id = s.webhook_secret_id,
    -- Scheme and host only: the path and query often hold the token.
    webhook_hint = case when v_url is not null then substring(v_url from '^https?://[^/?#]+') || '/••••' else webhook_hint end,
    resend_secret_id = s.resend_secret_id,
    email_from = case when p_email_from is not null then nullif(btrim(p_email_from), '') else email_from end,
    email_to = coalesce(v_to, email_to),
    coverage_threshold = coalesce(p_coverage_threshold, coverage_threshold),
    stale_minutes = coalesce(p_stale_minutes, stale_minutes),
    enabled = coalesce(p_enabled, enabled),
    updated_at = now(),
    updated_by = auth.uid()
  where id = 1;

  insert into public.audit_log (user_id, action, target, data)
  values (auth.uid(), 'set alert_settings', 'alert_settings', jsonb_build_object(
    'webhook_changed', v_url is not null, 'resend_key_changed', v_key is not null,
    'recipients', cardinality(coalesce(v_to, s.email_to)), 'coverage_threshold', coalesce(p_coverage_threshold, s.coverage_threshold),
    'stale_minutes', coalesce(p_stale_minutes, s.stale_minutes), 'enabled', coalesce(p_enabled, s.enabled)));
end;
$$;

create or replace function public.clear_alert_channel(p_channel text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change alerts' using errcode = '42501';
  end if;
  if p_channel = 'webhook' then
    select webhook_secret_id into v_id from public.alert_settings where id = 1 for update;
    update public.alert_settings set webhook_secret_id = null, webhook_hint = null, updated_at = now(), updated_by = auth.uid() where id = 1;
  elsif p_channel = 'email' then
    select resend_secret_id into v_id from public.alert_settings where id = 1 for update;
    update public.alert_settings set resend_secret_id = null, email_from = null, email_to = '{}', updated_at = now(), updated_by = auth.uid() where id = 1;
  else
    raise exception 'Unknown channel %', p_channel using errcode = '22023';
  end if;
  delete from vault.secrets where id = v_id;
  insert into public.audit_log (user_id, action, target, data)
  values (auth.uid(), 'remove alert_' || p_channel, 'alert_settings', null);
end;
$$;

create or replace function public.get_alert_status()
returns table (
  enabled boolean,
  webhook_configured boolean,
  webhook_hint text,
  email_configured boolean,
  email_from text,
  email_to text[],
  coverage_threshold numeric,
  stale_minutes integer,
  updated_at timestamptz,
  pending bigint,
  last_sent_at timestamptz,
  last_error text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.enabled,
    s.webhook_secret_id is not null,
    case when public.is_admin() then s.webhook_hint end,
    s.resend_secret_id is not null and s.email_from is not null and cardinality(s.email_to) > 0,
    case when public.is_admin() then s.email_from end,
    case when public.is_admin() then s.email_to end,
    s.coverage_threshold,
    s.stale_minutes,
    s.updated_at,
    (select count(*) from public.alerts a where a.sent_at is null and a.attempts < 5),
    (select max(a.sent_at) from public.alerts a),
    case when public.is_admin() then (select a.last_error from public.alerts a where a.last_error is not null order by a.id desc limit 1) end
  from public.alert_settings s
  where s.id = 1;
$$;

-- Server side only.
create or replace function public.get_alert_secrets()
returns table (enabled boolean, webhook_url text, resend_key text, email_from text, email_to text[])
language sql
stable
security definer
set search_path = ''
as $$
  select s.enabled, w.decrypted_secret, r.decrypted_secret, s.email_from, s.email_to
  from public.alert_settings s
  left join vault.decrypted_secrets w on w.id = s.webhook_secret_id
  left join vault.decrypted_secrets r on r.id = s.resend_secret_id
  where s.id = 1;
$$;

-- Records new alerts; running it again adds nothing for the same condition.
create or replace function public.detect_alerts()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.alert_settings;
  v_added integer := 0;
  v_n integer;
  v_last timestamptz;
begin
  select * into s from public.alert_settings where id = 1;
  if not s.enabled then
    return 0;
  end if;

  -- A cycle closed below the coverage threshold.
  insert into public.alerts (kind, dedupe_key, tenant_id, title, body, data)
  select 'coverage_low', 'coverage:' || c.id, c.tenant_id,
    format('Coverage %s%% in %s', c.coverage_pct, t.name),
    format('The scan cycle of %s that opened %s closed at %s%% coverage (threshold %s%%). Check the Scans page for computers that did not answer.',
      t.name, to_char(c.opened_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'), c.coverage_pct, s.coverage_threshold),
    jsonb_build_object('cycle_id', c.id, 'coverage_pct', c.coverage_pct, 'threshold', s.coverage_threshold)
  from public.scan_cycles c
  join public.tenants t on t.id = c.tenant_id
  where c.status in ('closed', 'complete')
    and c.closed_at > now() - interval '7 days'
    and c.coverage_pct < s.coverage_threshold
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  v_added := v_added + v_n;

  -- Query errors, one alert per tenant and day.
  insert into public.alerts (kind, dedupe_key, tenant_id, title, body, data)
  select 'query_error', 'query_error:' || l.tenant_id || ':' || l.day, l.tenant_id,
    format('%s query error(s) in %s', l.errors, t.name),
    format('Live Discover returned %s query error(s) for %s on %s. First: %s', l.errors, t.name, l.day, l.first_message),
    jsonb_build_object('errors', l.errors, 'day', l.day)
  from (
    select g.tenant_id, (g.created_at at time zone 'UTC')::date as day, count(*) as errors,
      (array_agg(left(g.message, 300) order by g.created_at))[1] as first_message
    from public.collector_logs g
    where g.data ->> 'step' = 'query_error' and g.created_at > now() - interval '2 days' and g.tenant_id is not null
    group by 1, 2
  ) l
  join public.tenants t on t.id = l.tenant_id
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  v_added := v_added + v_n;

  -- The collector stopped: it is switched on (Vault) and its last log is too old.
  if exists (select 1 from vault.decrypted_secrets where name = 'collector_url') then
    select max(created_at) into v_last from public.collector_logs where step = 'collector';
    if v_last is not null and v_last < now() - make_interval(mins => s.stale_minutes) then
      insert into public.alerts (kind, dedupe_key, title, body, data)
      values ('collector_stale', 'stale:' || v_last,
        'The collector has not run',
        format('No collector tick since %s (more than %s minutes). Check pg_cron (collector-tick), the Edge Function logs and the collector secret.',
          to_char(v_last at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'), s.stale_minutes),
        jsonb_build_object('last_tick', v_last, 'stale_minutes', s.stale_minutes))
      on conflict (dedupe_key) do nothing;
      get diagnostics v_n = row_count;
      v_added := v_added + v_n;
    end if;
  end if;

  return v_added;
end;
$$;

-- pg_cron → alerts Edge Function, apart from the collector so a stopped collector is still reported.
-- Reuses the collector's Vault secrets; the URL is the collector's with /alerts at the end.
create or replace function public.invoke_alerts()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'collector_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'collector_secret';
  if v_url is null or v_secret is null then
    return null;
  end if;
  return net.http_post(
    url := regexp_replace(v_url, '/collector/?$', '/alerts'),
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-collector-secret', v_secret),
    timeout_milliseconds := 60000
  );
end;
$$;

-- API budget panel ------------------------------------------------------------------------------------

create or replace function public.budget_overview(p_tenant_id uuid default null)
returns table (
  tenant_id uuid,
  tenant_name text,
  runs_this_minute integer,
  runs_per_minute integer,
  runs_today integer,
  daily_run_limit integer,
  reserve_pct integer,
  normal_left integer,
  reserve_left integer,
  active_runs integer,
  max_active_runs integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.name, b.runs_this_minute, s.runs_per_minute, b.runs_today, s.daily_run_limit, s.reserve_pct,
    greatest(0, (s.daily_run_limit * (100 - s.reserve_pct)) / 100 - b.runs_today),
    greatest(0, s.daily_run_limit - greatest(b.runs_today, (s.daily_run_limit * (100 - s.reserve_pct)) / 100)),
    b.active_runs, s.max_active_runs
  from public.tenants t
  join public.scan_settings s on s.tenant_id = t.id
  cross join lateral public.budget_snapshot(t.id) b
  where t.id in (select r.tenant_id from public.my_tenant_roles() r)
    and (p_tenant_id is null or t.id = p_tenant_id)
  order by t.name;
$$;

-- Retention -------------------------------------------------------------------------------------------
-- Raw results are only needed until they are ingested; keep 90 days for troubleshooting. Snapshots keep
-- their rows (raw_result_id becomes null); everything else is kept.

create or replace function public.purge_raw_results(p_days integer default 90)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  delete from public.raw_results
  where received_at < now() - make_interval(days => greatest(p_days, 7))
    and (ingested_at is not null or ingest_error is not null);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Grants and schedules ----------------------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'set_alert_settings(text, text, text, text[], numeric, integer, boolean)', 'clear_alert_channel(text)',
    'get_alert_status()', 'budget_overview(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['get_alert_secrets()', 'detect_alerts()', 'purge_raw_results(integer)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;

revoke all on function public.invoke_alerts() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('alerts-tick', 'raw-results-retention');
select cron.schedule('alerts-tick', '*/5 * * * *', 'select public.invoke_alerts()');
select cron.schedule('raw-results-retention', '30 3 * * *', 'select public.purge_raw_results(90)');
