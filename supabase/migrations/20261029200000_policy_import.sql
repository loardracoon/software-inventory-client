-- Policies › Import policy (Phase 9 follow-up): an admin of the tenant loads a file made by Export policy (from
-- this or another tenant). The import replaces the rules and the default class of the tenant's draft, never the
-- published policy: the admin reviews the draft and publishes it as usual. One transaction: a bad rule changes
-- nothing. Each rule goes through policy_save_rule (same checks and audit).
create or replace function public.policy_import(p_tenant_id uuid, p_policy jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_draft uuid;
  v_version integer;
  v_rule jsonb;
  v_count integer := 0;
begin
  perform public.policy_require_admin(p_tenant_id);
  if coalesce(jsonb_typeof(p_policy), '') <> 'object' or coalesce(jsonb_typeof(p_policy -> 'rules'), '') <> 'array' then
    raise exception 'The file is not an exported policy (no rules list)' using errcode = '22023';
  end if;
  if jsonb_array_length(p_policy -> 'rules') > 500 then
    raise exception 'A policy can have at most 500 rules' using errcode = '22023';
  end if;

  v_draft := public.policy_ensure_draft(p_tenant_id);
  select version into v_version from public.policies where id = v_draft;
  delete from public.policy_rules where policy_id = v_draft;
  if nullif(p_policy ->> 'default_class', '') is not null then
    update public.policies set default_class = (p_policy ->> 'default_class')::public.policy_class where id = v_draft;
  end if;

  -- In the file's order (position, then place in the list); ids and lineages of the source are not kept.
  for v_rule in
    select r.item from jsonb_array_elements(p_policy -> 'rules') with ordinality as r (item, ord)
    order by coalesce(nullif(r.item ->> 'position', '')::integer, r.ord::integer), r.ord
  loop
    v_count := v_count + 1;
    perform public.policy_save_rule(p_tenant_id, (v_rule - 'id' - 'lineage_id') || jsonb_build_object('position', v_count));
  end loop;

  insert into public.audit_log (user_id, action, target, data)
  values (auth.uid(), 'policy imported', 'policies', jsonb_build_object('tenant_id', p_tenant_id, 'version', v_version, 'rules', v_count,
    'default_class', p_policy ->> 'default_class', 'source_version', p_policy ->> 'version'));
  return v_count;
end;
$$;

revoke all on function public.policy_import(uuid, jsonb) from public, anon;
grant execute on function public.policy_import(uuid, jsonb) to authenticated;
