-- Stage 3: overdue remediation. A new alert kind (one alert per finding) and the deadline columns of the evidence package.
-- detect_alerts and audit_report_data are patched on their live definitions (same signature and grants).

alter table public.alerts drop constraint alerts_kind_check;
alter table public.alerts add constraint alerts_kind_check
  check (kind in ('coverage_low', 'query_error', 'collector_stale', 'test', 'policy_unsanctioned', 'vuln_kev', 'review_overdue', 'sla_overdue'));

-- detect_alerts: the sla_overdue block before the final return.
do $$
declare
  v_def text;
  v_parts text[][] := array[
    array['  return v_added;', '  -- Remediation overdue: one alert per finding, for those that became overdue in the last 7 days (an older backlog, e.g. after the first backfill, is on the Remediation screen, not one alert each).
  insert into public.alerts (kind, dedupe_key, tenant_id, title, body, data)
  select ''sla_overdue'', ''sla_overdue:'' || f.id, f.tenant_id,
    format(''Vulnerability overdue in %s: %s'', tn.name, f.vuln_id),
    format(''%s on %s%s was due %s (%s, first seen %s).'', f.vuln_id, t.canonical_name, coalesce('' '' || nullif(f.version, ''''), ''''),
      to_char(f.due_at at time zone ''UTC'', ''YYYY-MM-DD''), coalesce(lower(f.severity), ''no severity''), to_char(f.first_seen_at at time zone ''UTC'', ''YYYY-MM-DD'')),
    jsonb_build_object(''finding_id'', f.id, ''vuln_id'', f.vuln_id, ''due_at'', f.due_at)
  from public.vuln_findings f
  join public.tenants tn on tn.id = f.tenant_id
  join public.software_titles t on t.id = f.title_id
  where f.resolved_at is null and f.due_at < now() and f.due_at >= now() - interval ''7 days''
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  v_added := v_added + v_n;

  return v_added;']
  ];
  i integer;
begin
  select pg_get_functiondef('public.detect_alerts'::regproc) into v_def;
  for i in 1 .. array_length(v_parts, 1) loop
    if (length(v_def) - length(replace(v_def, v_parts[i][1], ''))) / length(v_parts[i][1]) <> 1 then
      raise exception 'detect_alerts has changed (part %): update this migration', i;
    end if;
    v_def := replace(v_def, v_parts[i][1], v_parts[i][2]);
  end loop;
  execute v_def;
end;
$$;

-- audit_report_data: due date and status on the vulnerability rows, and the remediation summary.
do $$
declare
  v_def text;
  v_parts text[][] := array[
    array['select t.canonical_name, v.version, v.vuln_id, vc.severity,', 'select t.canonical_name, v.title_id, v.version, v.vuln_id, vc.severity,'],
    array['''vulnerabilities'', coalesce((select jsonb_agg(to_jsonb(v) order by v.canonical_name, v.version, v.vuln_id) from vulns v), ''[]''::jsonb),', '''vulnerabilities'', coalesce((select jsonb_agg((to_jsonb(v) - ''title_id'') || jsonb_build_object(''due_at'', f.due_at, ''status'', case when f.id is null then null when now() > f.due_at then ''overdue'' else ''open'' end) order by v.canonical_name, v.version, v.vuln_id) from vulns v left join public.vuln_findings f on f.tenant_id = p_tenant_id and f.title_id = v.title_id and f.version = v.version and f.vuln_id = v.vuln_id and f.resolved_at is null), ''[]''::jsonb),
      -- Remediation of the whole tenant (the scope tag does not narrow it), as of generation.
      ''remediation'', (select jsonb_build_object(''open'', count(*) filter (where resolved_at is null and now() <= due_at), ''overdue'', count(*) filter (where resolved_at is null and now() > due_at), ''resolved_in_time'', count(*) filter (where resolved_at is not null and resolved_at <= due_at), ''resolved_late'', count(*) filter (where resolved_at is not null and resolved_at > due_at), ''oldest_open_days'', coalesce(floor(extract(epoch from now() - min(first_seen_at) filter (where resolved_at is null)) / 86400)::int, 0)) from public.vuln_findings where tenant_id = p_tenant_id),']
  ];
  i integer;
begin
  select pg_get_functiondef('public.audit_report_data'::regproc) into v_def;
  for i in 1 .. array_length(v_parts, 1) loop
    if (length(v_def) - length(replace(v_def, v_parts[i][1], ''))) / length(v_parts[i][1]) <> 1 then
      raise exception 'audit_report_data has changed (part %): update this migration', i;
    end if;
    v_def := replace(v_def, v_parts[i][1], v_parts[i][2]);
  end loop;
  execute v_def;
end;
$$;
