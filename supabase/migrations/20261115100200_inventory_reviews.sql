-- Periodic inventory review (PCI DSS 12.5.1, ISO 27001 A.5.9): a tenant admin attests that the inventory was reviewed,
-- against an evidence package of the last 7 days. An overdue review raises an alert.
alter table public.scan_settings
  add column review_every_days integer not null default 90 check (review_every_days between 7 and 366);

create table public.inventory_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  report_id uuid not null references public.audit_reports (id) on delete restrict,
  -- No foreign key: the reviewer id stays when a user is removed (the table is append-only).
  reviewed_by uuid not null,
  reviewer_email text not null,
  reviewed_at timestamptz not null default now(),
  outcome text not null check (outcome in ('accurate', 'accurate_with_changes')),
  statement text not null check (char_length(statement) between 20 and 2000),
  notes text check (char_length(notes) <= 4000)
);
create index inventory_reviews_tenant_idx on public.inventory_reviews (tenant_id, reviewed_at desc);

alter table public.inventory_reviews enable row level security;
create policy "Tenant members read inventory reviews"
  on public.inventory_reviews for select
  to authenticated
  using (tenant_id in (select r.tenant_id from public.my_tenant_roles() r));
revoke all on table public.inventory_reviews from anon, authenticated, service_role;
grant select on table public.inventory_reviews to authenticated;

create function public.inventory_reviews_block_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Inventory reviews cannot be changed' using errcode = '42501';
end;
$$;
create trigger inventory_reviews_block_change before update or delete on public.inventory_reviews
  for each row execute function public.inventory_reviews_block_change();

create function public.record_inventory_review(p_report_id uuid, p_outcome text, p_statement text, p_notes text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_generated timestamptz;
  v_email text;
  v_id uuid;
begin
  select a.tenant_id, a.generated_at into v_tenant, v_generated from public.audit_reports a where a.id = p_report_id;
  -- An unknown package and a package of another tenant look the same.
  if v_tenant is null or not exists (select 1 from public.my_tenant_roles() r where r.tenant_id = v_tenant and r.role = 'admin') then
    raise exception 'Only tenant admins can record inventory reviews' using errcode = '42501';
  end if;
  if v_generated <= now() - interval '7 days' then
    raise exception 'Generate a new evidence package first (the last one is older than 7 days)' using errcode = '22023';
  end if;
  select p.email into v_email from public.profiles p where p.id = auth.uid();
  insert into public.inventory_reviews (tenant_id, report_id, reviewed_by, reviewer_email, outcome, statement, notes)
  values (v_tenant, p_report_id, auth.uid(), coalesce(v_email, ''), p_outcome, p_statement, p_notes)
  returning id into v_id;
  insert into public.audit_log (user_id, action, target, data)
  values (auth.uid(), 'inventory_review', v_tenant::text, jsonb_build_object('id', v_id, 'report_id', p_report_id, 'outcome', p_outcome));
  return v_id;
end;
$$;

create function public.inventory_review_status(p_tenant_id uuid)
returns table (last_reviewed_at timestamptz, last_reviewer text, due_at timestamptz, overdue boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select l.reviewed_at, l.reviewer_email,
    coalesce(l.reviewed_at, t.created_at) + make_interval(days => coalesce(s.review_every_days, 90)),
    coalesce(l.reviewed_at, t.created_at) + make_interval(days => coalesce(s.review_every_days, 90)) < now()
  from public.tenants t
  left join public.scan_settings s on s.tenant_id = t.id
  left join lateral (
    select r.reviewed_at, r.reviewer_email from public.inventory_reviews r where r.tenant_id = t.id order by r.reviewed_at desc limit 1
  ) l on true
  where t.id = p_tenant_id and exists (select 1 from public.my_tenant_roles() m where m.tenant_id = t.id);
$$;

revoke all on function public.inventory_reviews_block_change() from public, anon, authenticated;
revoke all on function public.record_inventory_review(uuid, text, text, text), public.inventory_review_status(uuid) from public, anon;
grant execute on function public.record_inventory_review(uuid, text, text, text), public.inventory_review_status(uuid) to authenticated;

alter table public.alerts drop constraint alerts_kind_check;
alter table public.alerts add constraint alerts_kind_check
  check (kind in ('coverage_low', 'query_error', 'collector_stale', 'test', 'policy_unsanctioned', 'vuln_kev', 'review_overdue'));

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

  -- Inventory review overdue, one alert per tenant and due date (a new review moves the date).
  insert into public.alerts (kind, dedupe_key, tenant_id, title, body, data)
  select 'review_overdue', 'review_overdue:' || d.tenant_id || ':' || d.due_day, d.tenant_id,
    format('Inventory review overdue in %s', d.name),
    format('Inventory review overdue since %s. Generate an evidence package and record the review on the Reports page.', d.due_day),
    jsonb_build_object('due_at', d.due_at)
  from (
    select t.id as tenant_id, t.name,
      coalesce((select max(r.reviewed_at) from public.inventory_reviews r where r.tenant_id = t.id), t.created_at)
        + make_interval(days => coalesce(ss.review_every_days, 90)) as due_at,
      to_char((coalesce((select max(r.reviewed_at) from public.inventory_reviews r where r.tenant_id = t.id), t.created_at)
        + make_interval(days => coalesce(ss.review_every_days, 90))) at time zone 'UTC', 'YYYY-MM-DD') as due_day
    from public.tenants t
    left join public.scan_settings ss on ss.tenant_id = t.id
  ) d
  where d.due_at < now()
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  v_added := v_added + v_n;

  return v_added;
end;
$$;

