-- Tamper-evident audit log (PCI DSS 10.5.1, NIST AU-9/AU-11, ISO 27001 A.8.15): each row stores the hash of the
-- previous row, nobody can change or delete rows, and only the 400-day purge removes old rows (recording an anchor).
alter table public.audit_log add column prev_hash text, add column row_hash text;

-- The actor id stays when a user is removed: a SET NULL update would be blocked and would break the chain.
alter table public.audit_log drop constraint audit_log_user_id_fkey;

create table public.audit_anchor (
  id smallint primary key default 1 check (id = 1),
  last_purged_id bigint,
  last_purged_hash text,
  purged_at timestamptz
);
alter table public.audit_anchor enable row level security;
revoke all on table public.audit_anchor from anon, authenticated;

-- created_at is rendered in UTC so the hash does not depend on the session time zone.
create function public.audit_row_hash(p_prev text, p_id bigint, p_user uuid, p_action text, p_target text, p_data jsonb, p_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(
    coalesce(p_prev, '') || '|' || p_id || '|' || coalesce(p_user::text, '') || '|' || p_action || '|' || coalesce(p_target, '') || '|'
    || coalesce(p_data::text, '') || '|' || to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), 'sha256'), 'hex')
$$;

-- Backfill existing rows in id order (the block trigger does not exist yet).
do $$
declare
  r record;
  v_prev text;
  v_hash text;
begin
  for r in select * from public.audit_log order by id loop
    v_hash := public.audit_row_hash(v_prev, r.id, r.user_id, r.action, r.target, r.data, r.created_at);
    update public.audit_log set prev_hash = v_prev, row_hash = v_hash where id = r.id;
    v_prev := v_hash;
  end loop;
end $$;

-- The lock comes first and the id is taken under it, so id order, chain order and commit order are the same.
-- A single session cannot show this; ids can have gaps. The lock is held until commit, so audit writes are serialised;
-- a rare deadlock error can occur under concurrent writes and is safe to retry. Writers must use READ COMMITTED (the default).
create function public.audit_log_chain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('audit_log_chain'));
  new.id := nextval(pg_get_serial_sequence('public.audit_log', 'id'));
  select a.row_hash into new.prev_hash from public.audit_log a order by a.id desc limit 1;
  if not found then
    select n.last_purged_hash into new.prev_hash from public.audit_anchor n;
  end if;
  new.row_hash := public.audit_row_hash(new.prev_hash, new.id, new.user_id, new.action, new.target, new.data, new.created_at);
  return new;
end;
$$;

create trigger audit_log_chain before insert on public.audit_log for each row execute function public.audit_log_chain();

create function public.audit_log_block_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.audit_purge', true), '') <> 'on' then
    raise exception 'The audit log cannot be changed' using errcode = '42501';
  end if;
  return case when tg_level = 'ROW' then coalesce(new, old) else null end;
end;
$$;

create trigger audit_log_block_change before update or delete on public.audit_log for each row execute function public.audit_log_block_change();

create trigger audit_log_block_truncate before truncate on public.audit_log for each statement execute function public.audit_log_block_change();

-- Deletes the oldest contiguous run of rows older than p_days: a hole would break the chain.
create function public.purge_audit_log(p_days integer default 400)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stop bigint;
  v_id bigint;
  v_hash text;
  v_n integer;
begin
  if p_days is null or p_days < 1 then
    raise exception 'p_days must be at least 1' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('audit_log_chain'));
  select min(a.id) into v_stop from public.audit_log a where a.created_at >= now() - make_interval(days => p_days);
  select a.id, a.row_hash into v_id, v_hash from public.audit_log a where a.id < coalesce(v_stop, 9223372036854775807) order by a.id desc limit 1;
  if v_id is null then
    return 0;
  end if;
  perform set_config('app.audit_purge', 'on', true);
  delete from public.audit_log where id <= v_id;
  get diagnostics v_n = row_count;
  perform set_config('app.audit_purge', 'off', true);
  insert into public.audit_anchor (id, last_purged_id, last_purged_hash, purged_at) values (1, v_id, v_hash, now())
  on conflict (id) do update set last_purged_id = excluded.last_purged_id, last_purged_hash = excluded.last_purged_hash, purged_at = excluded.purged_at;
  insert into public.audit_log (action, target, data) values ('purge audit_log', 'audit_log', jsonb_build_object('deleted', v_n, 'last_purged_id', v_id, 'days', p_days));
  return v_n;
end;
$$;

create function public.verify_audit_log()
returns table (checked bigint, first_bad_id bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can verify the audit log' using errcode = '42501';
  end if;
  return query
    with r as (
      select a.*, lag(a.row_hash, 1, (select n.last_purged_hash from public.audit_anchor n)) over (order by a.id) as expected_prev
      from public.audit_log a
    )
    select count(*), min(r.id) filter (where r.prev_hash is distinct from r.expected_prev
      or r.row_hash is distinct from public.audit_row_hash(r.prev_hash, r.id, r.user_id, r.action, r.target, r.data, r.created_at))
    from r;
end;
$$;

create function public.export_audit_log(p_from timestamptz, p_to timestamptz)
returns setof public.audit_log
language plpgsql
stable
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can export the audit log' using errcode = '42501';
  end if;
  return query select * from public.audit_log a
    where (p_from is null or a.created_at >= p_from) and (p_to is null or a.created_at < p_to) order by a.id desc;
end;
$$;

revoke all on function public.audit_log_chain(), public.audit_log_block_change(), public.audit_row_hash(text, bigint, uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.purge_audit_log(integer) from public, anon, authenticated;
grant execute on function public.purge_audit_log(integer) to service_role;
revoke all on function public.verify_audit_log(), public.export_audit_log(timestamptz, timestamptz) from public, anon;
grant execute on function public.verify_audit_log(), public.export_audit_log(timestamptz, timestamptz) to authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'audit-log-retention';
select cron.schedule('audit-log-retention', '15 4 * * *', 'select public.purge_audit_log(400)');
