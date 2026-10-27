-- Fix: add_new_computer_tasks ran insert_cycle_tasks for every computer on every tick. After a new query
-- version (programs v2), each open cycle got a second task per computer for the same query name, so
-- both versions would run and their snapshots would alternate, each switch a baseline with other title
-- keys. The open cycle keeps the versions it opened with; only computers with no task in the cycle get
-- tasks (with the versions current at that moment).

create or replace function public.add_new_computer_tasks(p_cycle_id uuid)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  select coalesce(sum(public.insert_cycle_tasks(p_cycle_id, c.id)), 0)::integer
  from public.scan_cycles y
  join public.computers c on c.tenant_id = y.tenant_id and c.retired_at is null
  where y.id = p_cycle_id
    and not exists (select 1 from public.scan_tasks t where t.cycle_id = p_cycle_id and t.computer_id = c.id);
$$;

-- Remove the duplicates already created: in open cycles, a not-yet-run task whose computer has a task of
-- another version of the same query keeps only the oldest version (the one the cycle opened with).
delete from public.scan_tasks t
using public.query_catalog q, public.scan_cycles y
where q.id = t.query_id
  and y.id = t.cycle_id and y.status = 'open'
  and t.status in ('pending', 'skipped')
  and exists (
    select 1
    from public.scan_tasks t2
    join public.query_catalog q2 on q2.id = t2.query_id
    where t2.cycle_id = t.cycle_id and t2.computer_id = t.computer_id
      and q2.platform = q.platform and q2.name = q.name and q2.version < q.version
  );
