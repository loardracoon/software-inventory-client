-- Online/offline filter for collection. Before a run starts, the collector asks Live Endpoint Search
-- which claimed computers are online; only those run. Offline ones are deferred to later the same day
-- (the collector computes the time: hourly, then the next daily window). A deferral is not an attempt:
-- no run was spent. A task already scheduled for later is never claimed, so it keeps its schedule.

create or replace function public.defer_offline_tasks(p_task_ids uuid[], p_next_at timestamptz, p_reason text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.scan_tasks
  set status = 'retry_scheduled', claimed_at = null, next_attempt_at = p_next_at, last_error = left(p_reason, 1000)
  where id = any (p_task_ids) and status = 'dispatched';
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- no_response (the computer was online when the run started, then did not answer): retry later the
-- same day too, but after 3 attempts move to p_later_at (the next daily window) so a computer that is
-- online yet never answers does not spend a run every hour.
drop function public.schedule_retries(uuid, timestamptz);

create or replace function public.schedule_retries(p_tenant_id uuid, p_next_at timestamptz, p_later_at timestamptz default null)
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
  set status = 'retry_scheduled',
      attempts = t.attempts + 1,
      next_attempt_at = case when t.attempts + 1 >= 3 and p_later_at is not null then p_later_at else p_next_at end,
      claimed_at = null
  from public.scan_cycles cy
  where cy.id = t.cycle_id and cy.status = 'open' and t.tenant_id = p_tenant_id and t.status = 'no_response';
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.defer_offline_tasks(uuid[], timestamptz, text) from public, anon, authenticated;
grant execute on function public.defer_offline_tasks(uuid[], timestamptz, text) to service_role;
revoke all on function public.schedule_retries(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.schedule_retries(uuid, timestamptz, timestamptz) to service_role;
