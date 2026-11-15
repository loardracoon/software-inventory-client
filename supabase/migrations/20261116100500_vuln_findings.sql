-- Stage 3: remediation deadlines. Every certain vulnerability match is a finding with a first-seen date and a due date
-- from its severity (tenant settings) and the CISA KEV date; a finding is resolved when the match goes (version upgraded,
-- software removed) or becomes uncertain, and a match that returns is a new finding. Kept by triggers on the match table,
-- so the matcher does not change.

alter table public.scan_settings
  add column sla_critical_days integer not null default 15 check (sla_critical_days between 1 and 365),
  add column sla_high_days integer not null default 30 check (sla_high_days between 1 and 365),
  add column sla_medium_days integer not null default 90 check (sla_medium_days between 1 and 365),
  add column sla_low_days integer not null default 180 check (sla_low_days between 1 and 365);

create table public.vuln_findings (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  title_id uuid not null references public.software_titles (id) on delete cascade,
  version text not null default '',
  product_key text not null,
  vuln_id text not null,
  severity text,
  first_seen_at timestamptz not null,
  due_at timestamptz not null,
  resolved_at timestamptz
);

-- One open finding per tenant, title, version and CVE.
create unique index vuln_findings_one_open_idx on public.vuln_findings (tenant_id, title_id, version, vuln_id) where resolved_at is null;
create index vuln_findings_cve_idx on public.vuln_findings (product_key, vuln_id) where resolved_at is null;
create index vuln_findings_tenant_idx on public.vuln_findings (tenant_id, resolved_at, due_at);

-- The due date: first seen plus the tenant's days for the severity (no severity counts as low), or the CISA KEV date
-- (end of that day, UTC) when it is earlier.
create or replace function public.vuln_due_at(p_tenant_id uuid, p_severity text, p_first_seen timestamptz, p_kev_due date)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select least(
    p_first_seen + make_interval(days => coalesce(
      (select case upper(coalesce(p_severity, ''))
                when 'CRITICAL' then s.sla_critical_days when 'HIGH' then s.sla_high_days when 'MEDIUM' then s.sla_medium_days else s.sla_low_days end
       from public.scan_settings s where s.tenant_id = p_tenant_id),
      case upper(coalesce(p_severity, '')) when 'CRITICAL' then 15 when 'HIGH' then 30 when 'MEDIUM' then 90 else 180 end)),
    case when p_kev_due is not null then (p_kev_due::timestamp + interval '23 hours 59 minutes 59 seconds') at time zone 'UTC' end);
$$;

create or replace function public.vuln_finding_open(p_tenant_id uuid, p_title_id uuid, p_version text, p_product_key text, p_vuln_id text, p_first_seen timestamptz)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.vuln_findings (tenant_id, title_id, version, product_key, vuln_id, severity, first_seen_at, due_at)
  select p_tenant_id, p_title_id, p_version, p_product_key, p_vuln_id, upper(c.severity), p_first_seen,
         public.vuln_due_at(p_tenant_id, c.severity, p_first_seen, c.kev_due)
  from public.vuln_cache c where c.product_key = p_product_key and c.vuln_id = p_vuln_id
  on conflict (tenant_id, title_id, version, vuln_id) where resolved_at is null do nothing;
$$;

create or replace function public.vuln_matches_to_findings()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'UPDATE') and not old.uncertain and (tg_op = 'DELETE' or new.uncertain) then
    update public.vuln_findings set resolved_at = now()
    where tenant_id = old.tenant_id and title_id = old.title_id and version = old.version and vuln_id = old.vuln_id and resolved_at is null;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and not new.uncertain and (tg_op = 'INSERT' or old.uncertain) then
    perform public.vuln_finding_open(new.tenant_id, new.title_id, new.version, new.product_key, new.vuln_id, new.first_seen_at);
  end if;
  return null;
end;
$$;

create trigger title_version_vulns_findings
  after insert or delete or update of uncertain on public.title_version_vulns
  for each row execute function public.vuln_matches_to_findings();

-- Severity or KEV changed in the CVE data: the open findings of that CVE get their new due date.
create or replace function public.vuln_cache_to_findings()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.vuln_findings f set severity = upper(new.severity), due_at = public.vuln_due_at(f.tenant_id, new.severity, f.first_seen_at, new.kev_due)
  where f.product_key = new.product_key and f.vuln_id = new.vuln_id and f.resolved_at is null;
  return null;
end;
$$;

create trigger vuln_cache_findings
  after insert or update of severity, kev_added, kev_due on public.vuln_cache
  for each row execute function public.vuln_cache_to_findings();

-- A tenant changes its deadlines: its open findings follow.
create or replace function public.scan_settings_to_findings()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.vuln_findings f set due_at = public.vuln_due_at(f.tenant_id, c.severity, f.first_seen_at, c.kev_due)
  from public.vuln_cache c
  where f.tenant_id = new.tenant_id and f.resolved_at is null and c.product_key = f.product_key and c.vuln_id = f.vuln_id;
  return null;
end;
$$;

create trigger scan_settings_findings
  after update of sla_critical_days, sla_high_days, sla_medium_days, sla_low_days on public.scan_settings
  for each row execute function public.scan_settings_to_findings();

-- One open finding for every certain match already stored (the first-seen date is the match's own). Returns how many were opened.
create or replace function public.vuln_findings_backfill()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  with up as (
    insert into public.vuln_findings (tenant_id, title_id, version, product_key, vuln_id, severity, first_seen_at, due_at)
    select m.tenant_id, m.title_id, m.version, m.product_key, m.vuln_id, upper(c.severity), m.first_seen_at,
           public.vuln_due_at(m.tenant_id, c.severity, m.first_seen_at, c.kev_due)
    from public.title_version_vulns m
    join public.vuln_cache c on c.product_key = m.product_key and c.vuln_id = m.vuln_id
    where not m.uncertain
    on conflict (tenant_id, title_id, version, vuln_id) where resolved_at is null do nothing
    returning 1
  )
  select count(*) into v_n from up;
  return v_n;
end;
$$;
select public.vuln_findings_backfill();

-- Console read model: the findings of the caller's tenants with status and age.
create or replace view public.v_vuln_findings
with (security_barrier = true)
as
select f.id, f.tenant_id, f.title_id, t.canonical_name, f.version, f.product_key, f.vuln_id, f.severity, c.cvss_score,
  c.kev_added is not null as kev, c.kev_due, f.first_seen_at, f.due_at, f.resolved_at,
  case when f.resolved_at is null then case when now() > f.due_at then 'overdue' else 'open' end
       else case when f.resolved_at <= f.due_at then 'resolved_in_time' else 'resolved_late' end end as status,
  floor(extract(epoch from coalesce(f.resolved_at, now()) - f.first_seen_at) / 86400)::integer as days_open,
  (select count(distinct i.computer_id) from public.installations i
   join public.computers k on k.id = i.computer_id and k.retired_at is null
   where i.tenant_id = f.tenant_id and i.title_id = f.title_id and coalesce(i.version, '') = f.version and i.valid_to is null) as computers
from public.vuln_findings f
join public.my_tenant_roles() r on r.tenant_id = f.tenant_id
join public.software_titles t on t.id = f.title_id
left join public.vuln_cache c on c.product_key = f.product_key and c.vuln_id = f.vuln_id;

alter table public.vuln_findings enable row level security;
revoke all on table public.vuln_findings from anon, authenticated;
revoke all on table public.v_vuln_findings from anon, authenticated;
grant select on table public.v_vuln_findings to authenticated;

revoke all on function public.vuln_due_at(uuid, text, timestamptz, date), public.vuln_finding_open(uuid, uuid, text, text, text, timestamptz),
  public.vuln_matches_to_findings(), public.vuln_cache_to_findings(), public.scan_settings_to_findings(), public.vuln_findings_backfill()
  from public, anon, authenticated;
grant execute on function public.vuln_findings_backfill() to service_role;
