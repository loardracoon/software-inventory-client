-- Stage 3: the evidence package carries end of life: software rows get support_status and eol_from, computer rows the
-- OS release status and end date (status as of generation, like the policy class). audit_report_data is patched in place
-- (same signature and grants), as earlier migrations did with search_titles.
do $$
declare
  v_def text;
  v_parts text[][] := array[
    array['l.inventory_source, l.coverage_status
      from public.v_computer_list l', 'l.inventory_source, l.coverage_status, l.os_eol_status, l.os_eol_from
      from public.v_computer_list l'],
    array['case when v_pol is not null then vp.class end as policy_class, i.valid_from
      from public.installations i', 'case when v_pol is not null then vp.class end as policy_class, i.valid_from, eo.status as support_status, eo.eol_from
      from public.installations i'],
    array['vp.version = coalesce(i.version, '''')
      where i.valid_from <= p_as_of', 'vp.version = coalesce(i.version, '''')
      left join public.title_version_eol eo on eo.tenant_id = p_tenant_id and eo.title_id = i.title_id and eo.version = coalesce(i.version, '''')
      where i.valid_from <= p_as_of'],
    array['''policy_class'', s.policy_class, ''first_seen'', s.valid_from)', '''policy_class'', s.policy_class, ''support_status'', s.support_status, ''eol_from'', s.eol_from, ''first_seen'', s.valid_from)']
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
