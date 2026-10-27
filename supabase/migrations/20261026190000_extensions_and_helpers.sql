-- Phase 1: extensions, enums and helpers shared by the inventory schema.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
-- supabase_vault is installed by Supabase (schema vault).

create type public.platform as enum ('windows', 'macos', 'linux');
-- Named inventory_domain to avoid confusion with the DOMAIN keyword; columns are still called "domain".
create type public.inventory_domain as enum ('hardware', 'disks', 'programs', 'extensions', 'ide_extensions', 'packages');
create type public.title_kind as enum ('program', 'extension', 'ide_extension', 'package');
create type public.task_status as enum ('pending', 'dispatched', 'collected', 'no_response', 'retry_scheduled', 'missed', 'error');
create type public.change_type as enum ('added', 'removed', 'updated');
create type public.attention_level as enum ('info', 'review', 'not_allowed');
create type public.cycle_status as enum ('open', 'closed', 'complete');
create type public.run_status as enum ('running', 'finished', 'failed');
create type public.query_provider as enum ('live_endpoint_search', 'live_discover_rest');

-- Sort key for dot-separated versions: '4.4.41_0' -> {4,4,41,0}. Compare keys to find the highest
-- version (title_summary.latest_version here, current extension folder in Phase 5).
create or replace function public.version_key(v text)
returns numeric[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(array_agg(m.parts[1]::numeric order by m.n), '{}')
  from pg_catalog.regexp_matches(coalesce(v, ''), '(\d+)', 'g') with ordinality as m (parts, n);
$$;
