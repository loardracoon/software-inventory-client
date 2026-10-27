-- Phase 4: pg_cron calls the collector Edge Function every 5 minutes through pg_net.
-- Opt-in and secret-free: the URL and the shared secret live in Vault (names collector_url and
-- collector_secret). Until both exist the tick does nothing. Configure locally with
-- `npm run collector:configure`; on a remote project run, in the SQL editor:
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/collector', 'collector_url');
--   select vault.create_secret('<COLLECTOR_SECRET>', 'collector_secret');
-- and set the same COLLECTOR_SECRET as an Edge Function secret.

create or replace function public.invoke_collector()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'collector_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'collector_secret';
  if v_url is null or v_secret is null then
    return null;
  end if;
  return net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-collector-secret', v_secret),
    timeout_milliseconds := 150000
  );
end;
$$;

revoke all on function public.invoke_collector() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'collector-tick';
select cron.schedule('collector-tick', '*/5 * * * *', 'select public.invoke_collector()');
