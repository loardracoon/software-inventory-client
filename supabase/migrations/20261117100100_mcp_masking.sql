-- Phase 11 M2: username masking for AI assistants. While "Show usernames to AI assistants" is off, the mcp
-- function signs its read JWT with the claim mcp_mask = true. Every view and screen RPC already masks users,
-- user scope and user folders when my_tenant_roles() says 'viewer', so the claim makes my_tenant_roles()
-- report 'viewer' for every visible tenant: one place, no view changes, same tenants. The claim can only come
-- from a JWT signed with the project secret (the mcp function); browser sessions never carry it. Draft
-- policy tools (M5) use a second JWT without the claim, and they return no usernames.

create or replace function public.mcp_masked()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'mcp_mask')::boolean, false);
$$;

create or replace function public.my_tenant_roles()
returns table (tenant_id uuid, role public.app_role)
language sql
stable
security definer
set search_path = ''
as $$
  select r.tenant_id, case when public.mcp_masked() then 'viewer'::public.app_role else r.role end
  from (
    select t.id as tenant_id, 'admin'::public.app_role as role
    from public.tenants t
    where public.is_admin()
    union all
    select m.tenant_id, m.role
    from public.tenant_members m
    where m.user_id = auth.uid() and not public.is_admin()
    union all
    select t.id, p.role
    from public.tenants t
    join public.profiles p on p.id = auth.uid()
    where not public.is_admin()
      and not exists (select 1 from public.tenant_members m where m.user_id = auth.uid())
  ) r;
$$;

revoke all on function public.mcp_masked() from public, anon;
grant execute on function public.mcp_masked() to authenticated, service_role;
