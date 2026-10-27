-- Phase 4 fixes found by pgTAP:
-- - claim_dispatch_batch must only claim tasks whose query can run on the platform
--   (missing_tables = '{}'); unprobed or incomplete platforms wait.
-- - Releasing the lease clears the holder, so a new holder can take it at once.

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
      and public.missing_tables(p_tenant_id, p_query_id) = '{}'
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
  where public.collector_lease.holder is null
     or public.collector_lease.expires_at < now()
     or public.collector_lease.holder = excluded.holder;
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
  update public.collector_lease set holder = null, expires_at = now() where id = 1 and holder = p_holder;
$$;

revoke all on function public.claim_dispatch_batch(uuid, uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.claim_dispatch_batch(uuid, uuid, integer, boolean) to service_role;
revoke all on function public.acquire_collector_lease(text, integer) from public, anon, authenticated;
grant execute on function public.acquire_collector_lease(text, integer) to service_role;
revoke all on function public.release_collector_lease(text) from public, anon, authenticated;
grant execute on function public.release_collector_lease(text) to service_role;
