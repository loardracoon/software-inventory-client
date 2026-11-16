-- Phase 11 M5: AI assistants may change the policy draft, and only the draft. The mcp function signs its write
-- JWT with the claims mcp_token (the token id) and mcp_scope. The draft RPCs stay as they are (same admin
-- checks, same audit); these triggers add what is different for an assistant:
--   * only a policy_draft token may write; a read token is refused even for an admin;
--   * no publish, no discard, no default class change, no rule deletion (rows of policies are never updated
--     or deleted, rules of a draft are never deleted);
--   * risk_accepted_by is never filled: a new rule has none, a changed rule keeps the value a person typed or
--     loses it, and the draft copy of a published rule keeps the published value;
--   * every audit_log row written with such a JWT says via = 'mcp' and which token.
-- Browser sessions never carry the claims: only a JWT signed with the project secret (the mcp function) can.

create or replace function public.mcp_token_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'mcp_token', '')::uuid;
$$;

create or replace function public.mcp_token_scope()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'mcp_scope';
$$;

revoke all on function public.mcp_token_id(), public.mcp_token_scope() from public, anon;
grant execute on function public.mcp_token_id(), public.mcp_token_scope() to authenticated, service_role;

-- audit_log: name sorts before audit_log_chain, so the hash covers the added fields.
create or replace function public.audit_log_mcp_via()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_token uuid := public.mcp_token_id();
begin
  if v_token is not null then
    new.data := coalesce(new.data, '{}'::jsonb) || jsonb_build_object('via', 'mcp', 'mcp_token_id', v_token);
  end if;
  return new;
end;
$$;

create trigger audit_log_0_mcp_via before insert on public.audit_log
for each row execute function public.audit_log_mcp_via();

create or replace function public.mcp_policy_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status public.policy_status;
  v_published text;
begin
  if public.mcp_token_id() is null then
    return coalesce(new, old);
  end if;
  if public.mcp_token_scope() is distinct from 'policy_draft' then
    raise exception 'This AI assistant token can only read. An admin can create a token with the policy_draft scope.' using errcode = '42501';
  end if;

  if tg_table_name = 'policies' then
    if tg_op = 'INSERT' and new.status = 'draft' then
      return new;
    end if;
    raise exception 'AI assistants can only change the draft rules; a person publishes, discards and sets the default class in the console.' using errcode = '42501';
  end if;

  -- policy_rules
  if tg_op = 'DELETE' then
    raise exception 'AI assistants cannot delete rules; disable the rule instead, or delete it in the console.' using errcode = '42501';
  end if;
  select status into v_status from public.policies where id = new.policy_id;
  if v_status is distinct from 'draft' then
    raise exception 'AI assistants can only change the draft.' using errcode = '42501';
  end if;
  if new.risk_accepted_by is not null then
    if tg_op = 'UPDATE' and new.risk_accepted_by is not distinct from old.risk_accepted_by then
      return new;
    end if;
    if tg_op = 'INSERT' then
      -- policy_ensure_draft copies the published rules, with the acceptance a person gave.
      select r.risk_accepted_by into v_published
      from public.policy_rules r join public.policies p on p.id = r.policy_id
      where p.tenant_id = (select tenant_id from public.policies where id = new.policy_id)
        and p.status = 'published' and r.lineage_id = new.lineage_id;
      if v_published is not distinct from new.risk_accepted_by then
        return new;
      end if;
    end if;
    raise exception 'Only a person can fill risk_accepted_by.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.audit_log_mcp_via(), public.mcp_policy_guard() from public, anon, authenticated;

create trigger mcp_policy_guard before insert or update or delete on public.policies
for each row execute function public.mcp_policy_guard();
create trigger mcp_policy_guard before insert or update or delete on public.policy_rules
for each row execute function public.mcp_policy_guard();

-- The policy page's draft bar: who changed the draft and how (console or AI assistant), newest first.
-- Tenant admins only (the people who can publish); others get no rows.
create or replace function public.policy_draft_activity(p_tenant_id uuid)
returns table (at timestamptz, action text, rule_name text, user_email text, via text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.created_at, a.action, a.data ->> 'name', pf.email, coalesce(a.data ->> 'via', 'console')
  from public.policies d
  join public.audit_log a on a.created_at >= d.created_at
    and a.action like 'policy rule %'
    and a.data ->> 'tenant_id' = p_tenant_id::text
  left join public.profiles pf on pf.id = a.user_id
  where d.tenant_id = p_tenant_id and d.status = 'draft'
    and exists (select 1 from public.my_tenant_roles() r where r.tenant_id = p_tenant_id and r.role = 'admin')
  order by a.created_at desc, a.id desc
  limit 50;
$$;

revoke all on function public.policy_draft_activity(uuid) from public, anon;
grant execute on function public.policy_draft_activity(uuid) to authenticated;
