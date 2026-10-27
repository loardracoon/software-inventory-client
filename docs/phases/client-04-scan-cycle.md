# Phase 4: weekly cycle, dispatcher, poller and daily retry

From `docs/spec.md`, section "Prompts do cliente" ("Fase 4: ciclo semanal, despacho e retry diário"). Plan first, implement, then verify with build and tests before the next phase.

> **Repo note (from Phase 3):** `SophosQueryProvider`, both implementations, `createQueryProvider` (REST fallback when `SOPHOS_LES_URL` is unset) and `readAllResults` already exist in `supabase/functions/_shared/query-provider.ts`, built per tenant (the tenant is a constructor argument, not a method argument). Reuse them, `record_api_run` for api_budget, `missing_tables()` to skip queries ('{}' = runnable) and the `capability-probe.ts` pattern (collect when the endpoint finished, cancel after `run_grace_minutes`). The pg_cron tick should also POST `{ "action": "poll" }` to `probe-capabilities`. Extend `scripts/mock-sophos-central.mjs` for collector tests.
> The Live Discover REST API cannot cancel a run (`cancel()` returns false): with the REST provider, a run past `run_grace_minutes` stops being polled for results but still counts as active toward `max_active_runs` until it finishes (at most 600 s). Besides the per-tenant run limits, Sophos enforces 100 API calls per minute per credential across all APIs.
> Lab (Oct 26, 2026, Live Endpoint Search at https://api.taegis.sophos.com/graphql): a run with offline endpoints stays `started` with `timeRemainingInSeconds: 0` after its 600 s, and `cancelLiveDiscoverQueryRun` on it fails with BAD_GATEWAY (HTTP 500). Count a run as active only until `started_at + maxDurationInSeconds` (plus a margin), whatever Sophos reports, and treat cancel failures as warnings.

Phase 4: weekly cycle, dispatcher, poller and daily retry. Plan first.

Define an interface SophosQueryProvider { startRun(tenant, endpointIds, query): runId; getRun(runId); getEndpointStatuses(runId); getResults(runId, cursor); cancel(runId) } with two implementations:
- LiveEndpointSearchProvider (default): GraphQL at SOPHOS_LES_URL. Create a session (createLiveDiscoverSession), attach the endpoint IDs with endpointSessions(filter: { ids }), run with runLiveDiscoverQuery (matchEndpoints { all: false }), read liveDiscoverQueryRun, liveDiscoverQueryRunEndpoints and liveDiscoverQueryRunResults, cancel with cancelLiveDiscoverQueryRun.
- LiveDiscoverRestProvider (fallback): POST {dataRegion}/live-discover/v1/queries/runs with adHocQuery, then GET /runs/{id}, /runs/{id}/endpoints and /runs/{id}/results (pages via fromKey, page size 1000).

Edge Function collector, called every 5 minutes by pg_cron + pg_net with header x-collector-secret = COLLECTOR_SECRET (stored in Vault). Each call runs these steps in order and stops when its 120 s budget is spent. Every step logs to collector_logs.
1. open_cycles: when the weekly time (scan_settings, tenant time zone) has passed and no cycle is open for this week, close the previous cycle (pending, dispatched, no_response and retry_scheduled tasks become missed; compute coverage_pct) and open a new one with one task per active computer and enabled domain for its platform, next_attempt_at = now.
2. add_new_computers: computers first seen after the cycle opened get tasks in the open cycle.
3. dispatch: lock due tasks (status pending or retry_scheduled, next_attempt_at <= now) with SELECT ... FOR UPDATE SKIP LOCKED, group them by platform and domain, and split them into batches of batch_size. Start runs only while active runs < max_active_runs, runs in the current minute < runs_per_minute, and runs today < daily_run_limit * (1 - reserve_pct/100). Priority tasks may use the reserve. Insert query_runs and set the tasks to dispatched.
4. poll: for each active run, read per-endpoint statuses and page all results. An endpoint that finished successfully: store raw_results, create a snapshot, call apply_snapshot (Phase 5) and set the task to collected. An endpoint that failed with a query error: set error and write an alert. When the run is finished or older than run_grace_minutes, cancel it if still open and set every task still waiting to no_response.
5. schedule_retries: no_response becomes retry_scheduled with attempts + 1 and next_attempt_at = the next occurrence of retry_time in the tenant time zone (tomorrow when today's window has passed).
6. close_cycles: a cycle whose tasks are all collected or error closes early as complete.

Add the pg_cron job in a migration. Add RPC scan_now(computer_id), admin only, which creates priority tasks for every domain of that computer in the open cycle and writes audit_log.
Add unit tests for the time-window maths (DST-free zone, end of week, today vs tomorrow) and for budget limits.
