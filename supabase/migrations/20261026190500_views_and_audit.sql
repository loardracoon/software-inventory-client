-- Phase 1: audit log, title classification, the views the app reads, and title_summary.

-- Audit -----------------------------------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  action text not null,
  target text,
  data jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_created_at_idx on public.audit_log (created_at desc);
create index audit_log_user_idx on public.audit_log (user_id, created_at desc);

alter table public.audit_log enable row level security;

-- Append-only: rows come from triggers and SECURITY DEFINER functions; nobody updates or deletes.
create policy "Admins read the audit log"
  on public.audit_log for select
  to authenticated
  using ((select public.is_admin()));

revoke all on table public.audit_log from anon, authenticated;
grant select on table public.audit_log to authenticated;

-- Row-change audit. TG_ARGV[0] names the key column used as the target, e.g. 'tenant_id'.
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.audit_log (user_id, action, target, data)
  values (
    auth.uid(),
    lower(tg_op) || ' ' || tg_table_name,
    tg_table_name || ':' || coalesce(row_data ->> tg_argv[0], ''),
    jsonb_build_object(
      'old', case when tg_op = 'INSERT' then null else to_jsonb(old) end,
      'new', case when tg_op = 'DELETE' then null else to_jsonb(new) end
    )
  );
  return null;
end;
$$;

revoke all on function public.audit_row_change() from public, anon, authenticated;

create trigger profiles_audit_role
  after update of role on public.profiles
  for each row when (old.role is distinct from new.role)
  execute function public.audit_row_change('id');

create trigger tenant_members_audit
  after insert or update or delete on public.tenant_members
  for each row execute function public.audit_row_change('user_id');

create trigger scan_settings_audit
  after update on public.scan_settings
  for each row execute function public.audit_row_change('tenant_id');

create trigger local_overrides_audit
  after insert or update or delete on public.local_overrides
  for each row execute function public.audit_row_change('title_id');

-- Classification --------------------------------------------------------------------------------

-- Local override > dictionary exact match on (kind, source, match_key) > unclassified.
-- origin + method + confidence drive the label under the category ("Hub · Jev 0.97").
create view public.title_classification
with (security_invoker = true)
as
select
  t.id as title_id,
  c.slug as category_slug,
  l1.name as level1_name,
  c.name as level2_name,
  case
    when o.title_id is not null then coalesce(o.attention_level, c.attention_level)
    when d.kind is not null then d.attention_level
  end as attention_level,
  case
    when o.title_id is not null then 'local_override'
    when d.kind is not null then 'hub'
    else 'unclassified'
  end as origin,
  case when o.title_id is null then d.method end as method,
  case when o.title_id is null then d.confidence end as confidence
from public.software_titles t
left join public.local_overrides o on o.title_id = t.id
left join public.dictionary_cache d
  on d.kind = t.kind and d.source = t.source and d.match_key = t.match_key and d.status = 'published'
left join public.categories_cache c on c.slug = coalesce(o.category_slug, d.category_slug)
left join public.categories_cache l1 on l1.slug = c.parent_slug;

-- Masked reads ----------------------------------------------------------------------------------

-- Replaces the user folder in paths (C:\Users\<name>, /Users/<name>, /home/<name>), also inside
-- JSON text where backslashes are doubled.
create or replace function public.mask_user_path(value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.regexp_replace(value, '([\\/]+(Users|home|Documents and Settings)[\\/]+)[^\\/"]+', '\1***', 'gi');
$$;

-- The app reads computers and installations through these views. They run as their owner on
-- purpose (to reach rows the viewer cannot read directly), so they filter tenants themselves with
-- my_tenant_roles() and mask usernames for viewers.
create view public.v_computers
with (security_barrier = true)
as
select
  c.id,
  c.tenant_id,
  c.sophos_endpoint_id,
  c.hostname,
  c.platform,
  c.os_name,
  c.os_version,
  c.os_build,
  case when r.role = 'viewer' then null else c.associated_user end as associated_user,
  (r.role = 'viewer' and c.associated_user is not null) as user_masked,
  c.health,
  c.last_seen_at,
  c.last_collected_at,
  c.retired_at,
  c.missing_syncs,
  c.created_at,
  c.updated_at
from public.computers c
join public.my_tenant_roles() r on r.tenant_id = c.tenant_id;

create view public.v_installations
with (security_barrier = true)
as
select
  i.id,
  i.tenant_id,
  i.computer_id,
  i.title_id,
  i.domain,
  case when r.role = 'viewer' then null else i.scope_key end as scope_key,
  case when r.role = 'viewer' then null else i.username end as username,
  (r.role = 'viewer' and i.username is not null) as user_masked,
  i.version,
  case when r.role = 'viewer' then public.mask_user_path(i.path) else i.path end as path,
  case when r.role = 'viewer' then public.mask_user_path(i.attrs::text)::jsonb else i.attrs end as attrs,
  i.valid_from,
  i.valid_to,
  i.first_seen_snapshot,
  i.last_seen_snapshot
from public.installations i
join public.my_tenant_roles() r on r.tenant_id = i.tenant_id;

create view public.current_installations
with (security_barrier = true)
as
select * from public.v_installations where valid_to is null;

-- Title summary ---------------------------------------------------------------------------------

-- One row per tenant and title currently installed on an active computer. Refreshed concurrently
-- after ingest, at most every 5 minutes (Phase 5). No RLS on materialized views, so the browser
-- reads v_title_summary.
create materialized view public.title_summary as
select
  i.tenant_id,
  t.id as title_id,
  t.kind,
  t.source,
  t.canonical_name,
  t.vendor,
  t.external_id,
  tc.category_slug,
  tc.attention_level,
  count(distinct i.computer_id) as computers,
  count(distinct i.version) as versions,
  (array_agg(i.version order by public.version_key(i.version) desc))[1] as latest_version,
  (
    select min(h.valid_from)
    from public.installations h
    where h.title_id = t.id and h.tenant_id = i.tenant_id
  ) as first_seen
from public.installations i
join public.computers c on c.id = i.computer_id and c.retired_at is null
join public.software_titles t on t.id = i.title_id
left join public.title_classification tc on tc.title_id = t.id
where i.valid_to is null
group by i.tenant_id, t.id, tc.category_slug, tc.attention_level;

create unique index title_summary_tenant_title_idx on public.title_summary (tenant_id, title_id);
create index title_summary_category_idx on public.title_summary (category_slug);

create view public.v_title_summary
with (security_barrier = true)
as
select s.*
from public.title_summary s
where s.tenant_id in (select r.tenant_id from public.my_tenant_roles() r);

revoke all on table public.title_summary from anon, authenticated;
revoke all on table
  public.title_classification, public.v_computers, public.v_installations,
  public.current_installations, public.v_title_summary
  from anon, authenticated;
grant select on table
  public.title_classification, public.v_computers, public.v_installations,
  public.current_installations, public.v_title_summary
  to authenticated;
