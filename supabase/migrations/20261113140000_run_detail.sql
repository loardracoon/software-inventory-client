-- Scans › Recent runs drawer (troubleshooting): one run with, per computer of the run, its task status and
-- message, the number and size of the rows that came back (raw_results, kept 90 days) and a preview of the
-- first 20 rows. Raw rows hold user names and paths, so the preview is for admins and operators only;
-- viewers get the counts and sizes. Returns null for a run outside the caller's tenants.
create or replace function public.run_detail(p_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.query_runs;
  v_role public.app_role;
  v_preview boolean;
begin
  select * into r from public.query_runs where id = p_run_id;
  if r.id is null then
    return null;
  end if;
  -- Strongest role of the caller in the run's tenant (a global admin appears as admin).
  select m.role into v_role from public.my_tenant_roles() m
  where m.tenant_id = r.tenant_id
  order by case m.role when 'admin' then 0 when 'operator' then 1 else 2 end
  limit 1;
  if v_role is null then
    return null;
  end if;
  v_preview := v_role in ('admin', 'operator');

  return jsonb_build_object(
    'run', jsonb_build_object(
      'id', r.id, 'provider', r.provider, 'domain', r.domain, 'platform', r.platform,
      'query_name', (select q.name from public.query_catalog q where q.id = r.query_id), 'query_version', r.query_version,
      'status', r.status, 'cancelled', r.cancelled, 'error', r.error, 'started_at', r.started_at, 'finished_at', r.finished_at,
      'endpoints', cardinality(r.endpoint_ids)),
    'preview_allowed', v_preview,
    'computers', coalesce((
      select jsonb_agg(jsonb_build_object(
          'computer_id', c.id, 'hostname', c.hostname, 'endpoint_id', c.sophos_endpoint_id,
          'task_status', t.status, 'last_error', t.last_error,
          'row_count', rr.row_count, 'bytes', octet_length(rr.rows::text),
          'received_at', rr.received_at, 'ingested_at', rr.ingested_at, 'ingest_error', rr.ingest_error,
          'rows', case when v_preview and rr.id is not null then (
            select coalesce(jsonb_agg(x.e order by x.n), '[]'::jsonb)
            from jsonb_array_elements(rr.rows) with ordinality x(e, n) where x.n <= 20) end)
        order by c.hostname)
      from public.computers c
      left join public.raw_results rr on rr.run_id = r.id and rr.computer_id = c.id
      left join lateral (
        select st.status, st.last_error from public.scan_tasks st
        where st.last_run_id = r.id and st.computer_id = c.id
        order by st.updated_at desc nulls last limit 1) t on true
      where c.tenant_id = r.tenant_id and c.sophos_endpoint_id = any (r.endpoint_ids)), '[]'::jsonb));
end;
$$;

revoke all on function public.run_detail(uuid) from public, anon;
grant execute on function public.run_detail(uuid) to authenticated;
