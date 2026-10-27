-- Phase 4: weekly cycle, dispatch, poll and daily retry. The collector Edge Function (service role)
-- drives these functions every 5 minutes; each one is a short transaction, so a tick can stop at any
-- point and the next tick continues. Nothing here deletes inventory: a cycle that closes marks
-- unfinished tasks as missed and keeps the previous inventory.
--
-- One task per (cycle, computer, query): Linux programs has two queries (deb and rpm) and every
-- Sophos run executes one query. raw_results keep the rows until Phase 5 ingests them
-- (ingested_at is null).

alter table public.scan_tasks
  add column query_id uuid references public.query_catalog (id) on delete restrict,
  add column claimed_at timestamptz;
update public.scan_tasks set query_id = (select id from public.query_catalog limit 1) where query_id is null;
alter table public.scan_tasks
  alter column query_id set not null,
  drop constraint scan_tasks_cycle_id_computer_id_domain_key,
  add constraint scan_tasks_one_per_query unique (cycle_id, computer_id, query_id);
create index scan_tasks_query_due_idx on public.scan_tasks (tenant_id, query_id, status, next_attempt_at);

alter table public.raw_results
  add column scan_task_id uuid references public.scan_tasks (id) on delete restrict,
  add column query_id uuid references public.query_catalog (id) on delete restrict,
  add column ingested_at timestamptz;
create index raw_results_pending_ingest_idx on public.raw_results (received_at) where ingested_at is null;
create index raw_results_scan_task_idx on public.raw_results (scan_task_id);

alter table public.query_runs add column max_duration_seconds integer not null default 600 check (max_duration_seconds > 0);

-- One collector tick at a time (Edge Functions cannot hold a database session between calls).
create table public.collector_lease (
  id smallint primary key default 1 check (id = 1),
  holder text,
  expires_at timestamptz
);
alter table public.collector_lease enable row level security;
revoke all on table public.collector_lease from anon, authenticated;

create or replace function public.acquire_collector_lease(p_holder text, p_ttl_seconds integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  insert into public.collector_lease (id, holder, expires_at)
  values (1, p_holder, now() + make_interval(secs => p_ttl_seconds))
  on conflict (id) do update set holder = excluded.holder, expires_at = excluded.expires_at
  where public.collector_lease.expires_at < now() or public.collector_lease.holder = excluded.holder;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function public.release_collector_lease(p_holder text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.collector_lease set expires_at = now() where id = 1 and holder = p_holder;
$$;

-- Latest enabled version of each query name, per platform.
create or replace function public.current_queries()
returns setof public.query_catalog
language sql
stable
set search_path = ''
as $$
  select q.*
  from public.query_catalog q
  where q.enabled
    and q.version = (
      select max(q2.version) from public.query_catalog q2
      where q2.platform = q.platform and q2.name = q.name and q2.enabled
    );
$$;

-- Tasks for active computers of a tenant (all, or one computer) in a cycle. Queries whose tables
-- the platform lacks are skipped; queries of a platform not probed yet wait as pending.
create or replace function public.insert_cycle_tasks(p_cycle_id uuid, p_computer_id uuid default null)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_rows integer;
begin
  select tenant_id into v_tenant from public.scan_cycles where id = p_cycle_id;

  insert into public.scan_tasks (tenant_id, cycle_id, computer_id, domain, query_id, status, next_attempt_at, last_error)
  select
    c.tenant_id, p_cycle_id, c.id, q.domain, q.id,
    case when cardinality(m.missing) > 0 then 'skipped'::public.task_status else 'pending'::public.task_status end,
    now(),
    case when cardinality(m.missing) > 0 then 'Skipped: missing osquery tables ' || array_to_string(m.missing, ', ') end
  from public.computers c
  join public.current_queries() q on q.platform = c.platform
  cross join lateral (select public.missing_tables(v_tenant, q.id) as missing) m
  where c.tenant_id = v_tenant
    and c.retired_at is null
    and (p_computer_id is null or c.id = p_computer_id)
  on conflict (cycle_id, computer_id, query_id) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- Closes a cycle: unfinished tasks become missed (the previous inventory stays as is).
create or replace function public.close_cycle(p_cycle_id uuid, p_status public.cycle_status default 'closed')
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.scan_tasks
  set status = 'missed', claimed_at = null
  where cycle_id = p_cycle_id and status in ('pending', 'dispatched', 'no_response', 'retry_scheduled');

  update public.scan_cycles cy
  set status = p_status,
      closed_at = now(),
      coverage_pct = (
        select round(100.0 * count(*) filter (where t.status = 'collected')
                     / nullif(count(*) filter (where t.status <> 'skipped'), 0), 2)
        from public.scan_tasks t where t.cycle_id = cy.id
      )
  where cy.id = p_cycle_id and cy.status = 'open';
end;
$$;

-- Opens the cycle of the period that starts at p_period_start, closing the previous open cycle.
-- Returns null when this period already has a cycle (open, closed or complete).
create or replace function public.open_cycle(p_tenant_id uuid, p_period_start timestamptz, p_closes_at timestamptz)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cycle uuid;
  v_previous uuid;
begin
  perform pg_advisory_xact_lock(hashtext('open_cycle:' || p_tenant_id::text));

  if exists (select 1 from public.scan_cycles where tenant_id = p_tenant_id and opened_at >= p_period_start) then
    return null;
  end if;

  select id into v_previous from public.scan_cycles where tenant_id = p_tenant_id and status = 'open';
  if v_previous is not null then
    perform public.close_cycle(v_previous, 'closed');
  end if;

  insert into public.scan_cycles (tenant_id, opened_at, closes_at)
  values (p_tenant_id, greatest(now(), p_period_start), p_closes_at)
  returning id into v_cycle;

  perform public.insert_cycle_tasks(v_cycle);
  return v_cycle;
end;
$$;

-- Computers first seen after the cycle opened.
create or replace function public.add_new_computer_tasks(p_cycle_id uuid)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  select public.insert_cycle_tasks(p_cycle_id);
$$;

-- After a probe: pending tasks whose query cannot run become skipped, and skipped tasks whose
-- tables are now present return to pending (open cycles only).
create or replace function public.refresh_skipped_tasks(p_tenant_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_skipped integer;
  v_restored integer;
begin
  with m as (
    select q.id as query_id, public.missing_tables(p_tenant_id, q.id) as missing
    from public.query_catalog q
  )
  update public.scan_tasks t
  set status = 'skipped', last_error = 'Skipped: missing osquery tables ' || array_to_string(m.missing, ', ')
  from m, public.scan_cycles cy
  where t.query_id = m.query_id and cy.id = t.cycle_id and cy.status = 'open'
    and t.tenant_id = p_tenant_id and t.status = 'pending' and cardinality(m.missing) > 0;
  get diagnostics v_skipped = row_count;

  with m as (
    select q.id as query_id, public.missing_tables(p_tenant_id, q.id) as missing
    from public.query_catalog q
  )
  update public.scan_tasks t
  set status = 'pending', last_error = null, next_attempt_at = now()
  from m, public.scan_cycles cy
  where t.query_id = m.query_id and cy.id = t.cycle_id and cy.status = 'open'
    and t.tenant_id = p_tenant_id and t.status = 'skipped' and m.missing = '{}';
  get diagnostics v_restored = row_count;

  return v_skipped + v_restored;
end;
$$;

-- Runs counted against the Sophos limits. A run is active until started_at + max duration + 2 min,
-- whatever Sophos reports (lab: expired runs stay "started").
create or replace function public.budget_snapshot(p_tenant_id uuid)
returns table (runs_this_minute integer, runs_today integer, active_runs integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select sum(b.runs) from public.api_budget b
              where b.tenant_id = p_tenant_id and b.minute = date_trunc('minute', now())), 0)::integer,
    coalesce((select sum(b.runs) from public.api_budget b
              where b.tenant_id = p_tenant_id and b.minute >= date_trunc('day', now(), 'UTC')), 0)::integer,
    (select count(*) from public.query_runs r
     where r.tenant_id = p_tenant_id and r.status = 'running'
       and r.started_at + make_interval(secs => r.max_duration_seconds + 120) > now())::integer;
$$;

-- Queries with due tasks in the tenant's open cycle, runnable on their platform.
create or replace function public.due_task_groups(p_tenant_id uuid)
returns table (query_id uuid, name text, version integer, platform public.platform, sql text, due integer, due_priority integer)
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, q.name, q.version, q.platform, q.sql,
         count(*)::integer,
         count(*) filter (where t.priority or t.status = 'retry_scheduled')::integer
  from public.scan_tasks t
  join public.scan_cycles cy on cy.id = t.cycle_id and cy.status = 'open'
  join public.query_catalog q on q.id = t.query_id
  where t.tenant_id = p_tenant_id
    and t.status in ('pending', 'retry_scheduled')
    and t.next_attempt_at <= now()
    and public.missing_tables(p_tenant_id, q.id) = '{}'
  group by q.id
  order by count(*) filter (where t.priority) desc, min(t.next_attempt_at);
$$;

-- Locks and marks due tasks as dispatched (SKIP LOCKED: concurrent callers never get the same task).
-- p_reserve_only: only Scan now (priority) and retry tasks, which may use the reserved budget.
create or replace function public.claim_dispatch_batch(p_tenant_id uuid, p_query_id uuid, p_limit integer, p_reserve_only boolean default false)
returns table (task_id uuid, computer_id uuid, sophos_endpoint_id text, priority boolean)
language sql
volatile
security definer
set search_path = ''
as $$
  with picked as (
    select t.id
    from public.scan_tasks t
    join public.scan_cycles cy on cy.id = t.cycle_id and cy.status = 'open'
    where t.tenant_id = p_tenant_id
      and t.query_id = p_query_id
      and t.status in ('pending', 'retry_scheduled')
      and t.next_attempt_at <= now()
      and (not p_reserve_only or t.priority or t.status = 'retry_scheduled')
    order by t.priority desc, t.next_attempt_at, t.id
    limit greatest(p_limit, 0)
    for update of t skip locked
  )
  update public.scan_tasks t
  set status = 'dispatched', claimed_at = now()
  from picked p, public.computers c
  where t.id = p.id and c.id = t.computer_id
  returning t.id, t.computer_id, c.sophos_endpoint_id, t.priority;
$$;

-- Records a started Sophos run for claimed tasks and counts it in api_budget.
create or replace function public.record_dispatch(
  p_task_ids uuid[], p_tenant_id uuid, p_query_id uuid, p_provider public.query_provider,
  p_sophos_run_id text, p_endpoint_ids text[], p_priority boolean)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_run uuid;
begin
  insert into public.query_runs (tenant_id, sophos_run_id, provider, domain, platform, query_id, query_version, endpoint_ids, priority, status)
  select p_tenant_id, p_sophos_run_id, p_provider, q.domain, q.platform, q.id, q.version, p_endpoint_ids, p_priority, 'running'
  from public.query_catalog q where q.id = p_query_id
  returning id into v_run;

  update public.scan_tasks set last_run_id = v_run where id = any (p_task_ids);
  perform public.record_api_run(p_tenant_id);
  return v_run;
end;
$$;

-- Returns claimed tasks to the queue when the run could not start.
create or replace function public.release_tasks(p_task_ids uuid[], p_error text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.scan_tasks
  set status = case when attempts > 0 then 'retry_scheduled'::public.task_status else 'pending'::public.task_status end,
      claimed_at = null,
      last_error = left(p_error, 1000),
      next_attempt_at = now() + interval '5 minutes'
  where id = any (p_task_ids) and status = 'dispatched';
$$;

-- Stores one computer's rows from a run (idempotent) and marks its task collected.
-- Returns false when these rows were already stored.
create or replace function public.store_endpoint_result(p_run_id uuid, p_sophos_endpoint_id text, p_rows jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_run public.query_runs;
  v_computer uuid;
  v_task uuid;
  v_inserted integer;
begin
  select * into v_run from public.query_runs where id = p_run_id;
  select id into v_computer from public.computers
  where sophos_endpoint_id = p_sophos_endpoint_id and tenant_id = v_run.tenant_id;
  if v_computer is null then
    return false;
  end if;
  select id into v_task from public.scan_tasks where last_run_id = p_run_id and computer_id = v_computer;

  insert into public.raw_results (tenant_id, run_id, computer_id, rows, row_count, scan_task_id, query_id)
  values (v_run.tenant_id, p_run_id, v_computer, coalesce(p_rows, '[]'::jsonb),
          jsonb_array_length(coalesce(p_rows, '[]'::jsonb)), v_task, v_run.query_id)
  on conflict (run_id, computer_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return false;
  end if;

  update public.scan_tasks set status = 'collected', last_error = null, claimed_at = null
  where id = v_task and status = 'dispatched';
  update public.computers set last_collected_at = now() where id = v_computer;
  return true;
end;
$$;

-- error = query error on the computer (alert, no retry); no_response = it did not answer.
create or replace function public.set_task_outcome(p_run_id uuid, p_sophos_endpoint_id text, p_status public.task_status, p_error text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_status not in ('error', 'no_response') then
    raise exception 'Unsupported outcome %', p_status using errcode = '22023';
  end if;
  update public.scan_tasks t
  set status = p_status, last_error = left(p_error, 1000), claimed_at = null
  from public.computers c
  where c.id = t.computer_id and c.sophos_endpoint_id = p_sophos_endpoint_id
    and t.last_run_id = p_run_id and t.status = 'dispatched';
end;
$$;

-- Closes a run; tasks still waiting on it get no_response.
create or replace function public.finish_run(p_run_id uuid, p_status public.run_status, p_cancelled boolean, p_error text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.query_runs
  set status = p_status, finished_at = now(), cancelled = p_cancelled, error = left(p_error, 1000)
  where id = p_run_id and status = 'running';

  update public.scan_tasks
  set status = 'no_response', last_error = 'No answer before the run ended', claimed_at = null
  where last_run_id = p_run_id and status = 'dispatched';
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- no_response becomes retry_scheduled at the next daily retry window (computed by the collector in
-- the tenant time zone).
create or replace function public.schedule_retries(p_tenant_id uuid, p_next_at timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.scan_tasks t
  set status = 'retry_scheduled', attempts = t.attempts + 1, next_attempt_at = p_next_at, claimed_at = null
  from public.scan_cycles cy
  where cy.id = t.cycle_id and cy.status = 'open' and t.tenant_id = p_tenant_id and t.status = 'no_response';
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- An open cycle whose tasks are all collected, error or skipped closes early as complete.
create or replace function public.complete_cycles(p_tenant_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cycle uuid;
  v_count integer := 0;
begin
  for v_cycle in
    select cy.id from public.scan_cycles cy
    where cy.tenant_id = p_tenant_id and cy.status = 'open'
      and exists (select 1 from public.scan_tasks t where t.cycle_id = cy.id)
      and not exists (
        select 1 from public.scan_tasks t
        where t.cycle_id = cy.id and t.status in ('pending', 'dispatched', 'no_response', 'retry_scheduled')
      )
  loop
    perform public.close_cycle(v_cycle, 'complete');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Scan now (admins of the computer's tenant): priority tasks for every query of the computer in the
-- open cycle; they may use the reserved budget. Audited.
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
     or not exists (select 1 from public.my_tenant_roles() r where r.tenant_id = v_tenant and r.role = 'admin') then
    raise exception 'Only admins of this computer''s tenant can scan it' using errcode = '42501';
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

do $$
declare
  f text;
begin
  foreach f in array array[
    'acquire_collector_lease(text, integer)', 'release_collector_lease(text)', 'current_queries()',
    'insert_cycle_tasks(uuid, uuid)', 'close_cycle(uuid, public.cycle_status)',
    'open_cycle(uuid, timestamptz, timestamptz)', 'add_new_computer_tasks(uuid)', 'refresh_skipped_tasks(uuid)',
    'budget_snapshot(uuid)', 'due_task_groups(uuid)', 'claim_dispatch_batch(uuid, uuid, integer, boolean)',
    'record_dispatch(uuid[], uuid, uuid, public.query_provider, text, text[], boolean)', 'release_tasks(uuid[], text)',
    'store_endpoint_result(uuid, text, jsonb)', 'set_task_outcome(uuid, text, public.task_status, text)',
    'finish_run(uuid, public.run_status, boolean, text)', 'schedule_retries(uuid, timestamptz)', 'complete_cycles(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;

revoke all on function public.scan_now(uuid) from public, anon;
grant execute on function public.scan_now(uuid) to authenticated;
