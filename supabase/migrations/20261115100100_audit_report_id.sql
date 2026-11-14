-- The manifest inside the ZIP names its own report id, so the Edge Function chooses the id before it builds the package.
-- Same signature and grants as before (create or replace keeps them).
create or replace function public.record_audit_report(p_tenant_id uuid, p_as_of timestamptz, p_scope_tag text, p_manifest jsonb,
  p_manifest_sha256 text, p_archive bytea, p_users_masked boolean, p_generated_by uuid default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.audit_reports (id, tenant_id, as_of, scope_tag, generated_by, manifest, manifest_sha256, archive, users_masked)
  values (coalesce((p_manifest ->> 'report_id')::uuid, gen_random_uuid()), p_tenant_id, p_as_of, p_scope_tag, p_generated_by, p_manifest,
    p_manifest_sha256, p_archive, p_users_masked)
  returning id into v_id;
  insert into public.audit_log (user_id, action, target, data)
  values (p_generated_by, 'audit_report', p_tenant_id::text,
    jsonb_build_object('id', v_id, 'as_of', p_as_of, 'scope_tag', p_scope_tag, 'manifest_sha256', p_manifest_sha256));
  return v_id;
end;
$$;
