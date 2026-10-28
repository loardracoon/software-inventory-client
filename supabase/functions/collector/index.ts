// Collector tick, called every 5 minutes by pg_cron (x-collector-secret) or by an admin. Each call
// runs these steps in order and stops when its 120 s budget is spent; all state lives in Postgres, so
// the next tick continues where this one stopped. Every step logs to collector_logs.
//   0 lease            one tick at a time
//   1 sync_computers   when a tenant was not synced for 20 h, or before its cycle opens
//   2 open_cycles      weekly, in the tenant time zone (closing the previous cycle)
//   3 add_new_computers
//   4 probes           advance running probes; probe platforms never probed; refresh skipped tasks
//   5 dispatch         due tasks in batches, within the Sophos limits (budget.ts); only computers online
//                      now run, offline ones are checked again later the same day (no run spent)
//   6 poll             per-endpoint status and results while they arrive; give up after the grace time
//   6b ingest          raw results → snapshots → versioned inventory (Phase 5); title_summary refresh
//   6c hub_sync        Dictionary Hub pull / share / request status when due (Phase 7, _shared/hub-sync.ts)
//   6d policy          policy classes of new (title, version) pairs; every pair after a publish or a
//                      dictionary change (Phase 9, _shared/policy-run.ts)
//   7 schedule_retries no_response → later the same day; from the 3rd attempt, the next daily window
//   8 close_cycles     cycles with nothing left close early as complete

import { runAllowance, spendRun, type RunAllowance } from "../_shared/budget.ts";
import { decideEndpoint, rowsByEndpoint, runName, runPastGrace } from "../_shared/collector-plan.ts";
import { syncComputers } from "../_shared/computer-sync.ts";
import { hubSyncDue, loadHub, runHubSync, type HubSyncSummary } from "../_shared/hub-sync.ts";
import { ingestPending, type IngestSummary } from "../_shared/ingest.ts";
import { runPolicyEvaluation, type PolicyRunSummary, type RpcClient } from "../_shared/policy-run.ts";
import { adminClient, authorize, corsHeaders, errorMessage, HttpError, json, loadSophosClient, LogBuffer } from "../_shared/edge.ts";
import { advanceProbes, loadTenants, newProbeSummary, sophosTenantOf, startProbes, type TenantRow } from "../_shared/probe-runner.ts";
import { createQueryProvider, readAllResults, type ProviderName } from "../_shared/query-provider.ts";
import { cycleStartAtOrBefore, nextCycleStart, nextOfflineCheck, nextRetryAt, wallTime } from "../_shared/schedule.ts";

const TICK_BUDGET_MS = 120_000;
const LEASE_SECONDS = 180;
const SYNC_EVERY_MS = 20 * 3600_000;

// "14:05" in the tenant time zone, for messages shown on the Computers and Scans pages.
const localTime = (instant: Date, timeZone: string) => {
  const w = wallTime(instant, timeZone);
  return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
};

type DueGroup = { query_id: string; name: string; version: number; platform: string; sql: string; due: number; due_priority: number };
type Claimed = { task_id: string; computer_id: string; sophos_endpoint_id: string; priority: boolean };
type RunRow = {
  id: string;
  tenant_id: string;
  sophos_run_id: string;
  provider: ProviderName;
  started_at: string;
  scan_tasks: { status: string; computers: { sophos_endpoint_id: string } | null }[];
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const startedAt = Date.now();
  const timeLeft = () => TICK_BUDGET_MS - (Date.now() - startedAt);
  const admin = adminClient();
  const logs = new LogBuffer("collector");
  try {
    await authorize(req, admin, { allowCollector: true });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    throw error;
  }

  const holder = crypto.randomUUID();
  const { data: gotLease } = await admin.rpc("acquire_collector_lease", { p_holder: holder, p_ttl_seconds: LEASE_SECONDS });
  if (!gotLease) return json({ ok: true, skipped: "Another collector tick is running" });

  const summary = {
    synced: false,
    cyclesOpened: 0,
    newComputerTasks: 0,
    probes: newProbeSummary(),
    runsStarted: 0,
    tasksDispatched: 0,
    deferredOffline: 0,
    collected: 0,
    errors: 0,
    noResponse: 0,
    runsFinished: 0,
    retriesScheduled: 0,
    cyclesCompleted: 0,
    ingest: null as IngestSummary | null,
    hubSync: null as HubSyncSummary | null,
    policy: null as PolicyRunSummary | null,
    stoppedEarly: false,
    problems: [] as string[],
  };
  const step = (name: string) => {
    if (timeLeft() <= 0) {
      summary.stoppedEarly = true;
      return false;
    }
    logs.add("debug", `step ${name}`);
    return true;
  };
  const problem = (message: string, tenantId: string | null = null, level: "warn" | "error" = "error") => {
    summary.problems.push(message);
    logs.add(level, message, null, tenantId);
  };
  const lesUrl = Deno.env.get("SOPHOS_LES_URL") || undefined;
  const warnedNoOnlineCheck = new Set<string>();

  try {
    const sophos = await loadSophosClient(admin, logs.apiCall);
    let tenants = await loadTenants(admin);
    const now = new Date();

    const periodOf = (t: TenantRow) => {
      const s = t.scan_settings!;
      const start = cycleStartAtOrBefore(now, s.cycle_weekday, s.cycle_time, s.timezone);
      return { start, closes: nextCycleStart(start, s.cycle_time, s.timezone) };
    };
    const openCycleFor = async (tenantId: string) => {
      const { data } = await admin.from("scan_cycles").select("id, opened_at").eq("tenant_id", tenantId).eq("status", "open").maybeSingle();
      return data as { id: string; opened_at: string } | null;
    };

    // 1. sync_computers
    if (step("sync_computers")) {
      const due = tenants.size === 0 || [...tenants.values()].some((t) => {
        const synced = t.last_synced_at ? Date.parse(t.last_synced_at) : 0;
        return Date.now() - synced > SYNC_EVERY_MS || (t.scan_settings !== null && synced < periodOf(t).start.getTime());
      });
      if (due) {
        try {
          const result = await syncComputers(admin, sophos, logs);
          summary.synced = true;
          if (!result.ok) problem(`Computer sync finished with errors: ${result.message}`, null, "warn");
          tenants = await loadTenants(admin);
        } catch (error) {
          problem(`Computer sync failed: ${errorMessage(error)}`);
        }
      }
    }
    const active = [...tenants.values()].filter((t) => t.scan_settings && t.data_region_host);

    // 2. open_cycles and 3. add_new_computers
    if (step("open_cycles")) {
      for (const t of active) {
        const { start, closes } = periodOf(t);
        const { data, error } = await admin.rpc("open_cycle", {
          p_tenant_id: t.id,
          p_period_start: start.toISOString(),
          p_closes_at: closes.toISOString(),
        });
        if (error) problem(`Could not open the cycle for ${t.name}: ${error.message}`, t.id);
        else if (data) {
          summary.cyclesOpened++;
          logs.add("info", `Opened the cycle for ${t.name} (closes ${closes.toISOString()})`, null, t.id);
        }
      }
    }
    if (step("add_new_computers")) {
      for (const t of active) {
        const cycle = await openCycleFor(t.id);
        if (!cycle) continue;
        const { data } = await admin.rpc("add_new_computer_tasks", { p_cycle_id: cycle.id });
        summary.newComputerTasks += (data as number) ?? 0;
      }
    }

    // 4. probes
    if (step("probes")) {
      try {
        await advanceProbes(admin, sophos, logs, tenants, lesUrl, summary.probes);
        await startProbes(admin, sophos, logs, tenants, lesUrl, summary.probes, { requestedBy: null, mode: "auto" });
        for (const t of active) await admin.rpc("refresh_skipped_tasks", { p_tenant_id: t.id });
      } catch (error) {
        problem(`Probes failed: ${errorMessage(error)}`);
      }
    }

    // 5. dispatch
    if (step("dispatch")) {
      for (const t of active) {
        if (timeLeft() < 30_000) {
          summary.stoppedEarly = true;
          break;
        }
        const s = t.scan_settings!;
        const { data: usage } = await admin.rpc("budget_snapshot", { p_tenant_id: t.id });
        let allowance: RunAllowance = runAllowance(s, (usage as { runs_this_minute: number; runs_today: number; active_runs: number }[])[0]);
        if (allowance.normal + allowance.reserveOnly === 0) continue;

        const { data: groups } = await admin.rpc("due_task_groups", { p_tenant_id: t.id });
        const { provider, fellBack } = createQueryProvider(sophos, sophosTenantOf(t), s.provider, lesUrl);
        if (fellBack) logs.add("warn", "SOPHOS_LES_URL is not set: using the Live Discover REST API", null, t.id);

        for (const group of (groups ?? []) as DueGroup[]) {
          while (allowance.normal + allowance.reserveOnly > 0 && timeLeft() > 30_000) {
            const reserve = allowance.normal === 0;
            const { data: claimed, error: claimError } = await admin.rpc("claim_dispatch_batch", {
              p_tenant_id: t.id,
              p_query_id: group.query_id,
              p_limit: s.batch_size,
              p_reserve_only: reserve,
            });
            if (claimError) {
              problem(`Could not claim tasks for ${group.name}: ${claimError.message}`, t.id);
              break;
            }
            const claimedBatch = (claimed ?? []) as Claimed[];
            if (claimedBatch.length === 0) break;

            // Only online computers run. Offline ones wait for a later check today; no run is spent.
            let online: Set<string> | null;
            try {
              online = await provider.onlineEndpoints(claimedBatch.map((c) => c.sophos_endpoint_id));
            } catch (error) {
              const message = errorMessage(error);
              await admin.rpc("release_tasks", { p_task_ids: claimedBatch.map((c) => c.task_id), p_error: `Could not check which computers are online: ${message}` });
              problem(`Could not check which computers are online for ${t.name}: ${message}`, t.id);
              break;
            }
            if (online === null && !warnedNoOnlineCheck.has(t.id)) {
              warnedNoOnlineCheck.add(t.id);
              logs.add("warn", "The Live Discover REST API cannot tell which computers are online: runs go to every due computer", null, t.id);
            }
            const offline = online ? claimedBatch.filter((c) => !online.has(c.sophos_endpoint_id)) : [];
            if (offline.length > 0) {
              const next = nextOfflineCheck(new Date(), s.retry_time, s.timezone);
              const { error } = await admin.rpc("defer_offline_tasks", {
                p_task_ids: offline.map((c) => c.task_id),
                p_next_at: next.toISOString(),
                p_reason: `Offline at ${localTime(new Date(), s.timezone)}; next check ${localTime(next, s.timezone)} (${s.timezone})`,
              });
              if (error) throw new Error(`Could not defer offline computers: ${error.message}`);
              summary.deferredOffline += offline.length;
            }
            const batch = online ? claimedBatch.filter((c) => online.has(c.sophos_endpoint_id)) : claimedBatch;
            if (batch.length === 0) continue;
            const endpointIds = batch.map((c) => c.sophos_endpoint_id);
            try {
              const runId = await provider.startRun(endpointIds, { name: runName(group.name, group.version), sql: group.sql });
              const { error } = await admin.rpc("record_dispatch", {
                p_task_ids: batch.map((c) => c.task_id),
                p_tenant_id: t.id,
                p_query_id: group.query_id,
                p_provider: provider.name,
                p_sophos_run_id: runId,
                p_endpoint_ids: endpointIds,
                p_priority: batch.some((c) => c.priority),
              });
              if (error) throw new Error(error.message);
              allowance = spendRun(allowance, reserve);
              summary.runsStarted++;
              summary.tasksDispatched += batch.length;
              logs.add("info", `Started ${runName(group.name, group.version)} on ${batch.length} ${group.platform} computers`, { runId }, t.id);
            } catch (error) {
              const message = errorMessage(error);
              await admin.rpc("release_tasks", { p_task_ids: batch.map((c) => c.task_id), p_error: message });
              problem(`Could not start ${group.name} for ${t.name}: ${message}`, t.id);
              break;
            }
          }
        }
      }
    }

    // 6. poll
    if (step("poll")) {
      const { data: runs, error: runsError } = await admin
        .from("query_runs")
        .select("id, tenant_id, sophos_run_id, provider, started_at, scan_tasks(status, computers(sophos_endpoint_id))")
        .eq("status", "running")
        .order("started_at");
      if (runsError) throw new Error(runsError.message);

      for (const run of (runs ?? []) as unknown as RunRow[]) {
        if (timeLeft() < 15_000) {
          summary.stoppedEarly = true;
          break;
        }
        const tenant = tenants.get(run.tenant_id);
        if (!tenant?.scan_settings) continue;
        const grace = tenant.scan_settings.run_grace_minutes;
        const waiting = new Set(
          run.scan_tasks.filter((task) => task.status === "dispatched").map((task) => task.computers?.sophos_endpoint_id).filter(Boolean),
        );
        try {
          const { provider } = createQueryProvider(sophos, sophosTenantOf(tenant), run.provider, lesUrl);
          const states = await provider.getEndpointStatuses(run.sophos_run_id);
          const toCollect: string[] = [];
          for (const state of states) {
            if (!waiting.has(state.endpointId)) continue;
            const decision = decideEndpoint(state);
            if (decision.action === "collect") toCollect.push(state.endpointId);
            else if (decision.action === "error") {
              await admin.rpc("set_task_outcome", { p_run_id: run.id, p_sophos_endpoint_id: state.endpointId, p_status: "error", p_error: decision.message });
              waiting.delete(state.endpointId);
              summary.errors++;
              // Query errors are alerts (Phase 8 sends them), not retries.
              logs.add("error", `Query error on ${state.endpointId}: ${decision.message}`, { runId: run.id, step: "query_error" }, run.tenant_id);
            } else if (decision.action === "no_response") {
              await admin.rpc("set_task_outcome", { p_run_id: run.id, p_sophos_endpoint_id: state.endpointId, p_status: "no_response", p_error: decision.message });
              waiting.delete(state.endpointId);
              summary.noResponse++;
            }
          }
          if (toCollect.length > 0) {
            const grouped = rowsByEndpoint(await readAllResults(provider, run.sophos_run_id));
            for (const endpointId of toCollect) {
              const { data: stored, error } = await admin.rpc("store_endpoint_result", {
                p_run_id: run.id,
                p_sophos_endpoint_id: endpointId,
                p_rows: grouped.get(endpointId) ?? [],
              });
              if (error) throw new Error(error.message);
              if (stored) summary.collected++;
              waiting.delete(endpointId);
            }
          }

          const expired = runPastGrace(run.started_at, grace, Date.now());
          if (waiting.size === 0 || expired) {
            let cancelled = false;
            if (waiting.size > 0) {
              cancelled = await provider.cancel(run.sophos_run_id).catch((e) => {
                // Lab: cancelling an expired Live Endpoint Search run fails with HTTP 500.
                logs.add("warn", `Could not cancel run ${run.sophos_run_id}: ${errorMessage(e)}`, null, run.tenant_id);
                return false;
              });
            }
            const { data: silent } = await admin.rpc("finish_run", {
              p_run_id: run.id,
              p_status: "finished",
              p_cancelled: cancelled,
              p_error: waiting.size > 0 ? `${waiting.size} computer(s) did not answer within ${grace} min` : null,
            });
            summary.noResponse += (silent as number) ?? 0;
            summary.runsFinished++;
          }
        } catch (error) {
          problem(`Polling run ${run.sophos_run_id} failed: ${errorMessage(error)}`, run.tenant_id);
          if (runPastGrace(run.started_at, grace, Date.now())) {
            await admin.rpc("finish_run", { p_run_id: run.id, p_status: "failed", p_cancelled: false, p_error: errorMessage(error) });
            summary.runsFinished++;
          }
        }
      }
    }

    // 6b. ingest
    if (step("ingest")) {
      try {
        summary.ingest = await ingestPending(admin, logs, timeLeft);
        if (summary.ingest.failed > 0) problem(`${summary.ingest.failed} raw result(s) could not be ingested`, null, "warn");
      } catch (error) {
        problem(`Ingest failed: ${errorMessage(error)}`);
      }
    }

    // 6c. hub_sync
    if (step("hub_sync")) {
      try {
        const hub = (await hubSyncDue(admin)) ? await loadHub(admin, logs.apiCall) : null;
        if (hub) {
          summary.hubSync = await runHubSync(admin, hub, logs, timeLeft);
          if (!summary.hubSync.ok) problem(`Dictionary sync delayed: ${summary.hubSync.error}`, null, "warn");
        }
      } catch (error) {
        problem(`Dictionary sync failed: ${errorMessage(error)}`, null, "warn");
      }
    }

    // 6d. policy
    if (step("policy")) {
      try {
        summary.policy = await runPolicyEvaluation(admin as unknown as RpcClient, { alert: true, timeLeft });
        for (const message of summary.policy.errors) problem(`Policy evaluation: ${message}`, null, "warn");
      } catch (error) {
        problem(`Policy evaluation failed: ${errorMessage(error)}`, null, "warn");
      }
    }

    // 7. schedule_retries
    if (step("schedule_retries")) {
      for (const t of active) {
        const s = t.scan_settings!;
        const now = new Date();
        const { data } = await admin.rpc("schedule_retries", {
          p_tenant_id: t.id,
          p_next_at: nextOfflineCheck(now, s.retry_time, s.timezone).toISOString(),
          p_later_at: nextRetryAt(now, s.retry_time, s.timezone).toISOString(),
        });
        if ((data as number) > 0) logs.add("info", `${data} task(s) without an answer will retry later`, null, t.id);
        summary.retriesScheduled += (data as number) ?? 0;
      }
    }

    // 8. close_cycles
    if (step("close_cycles")) {
      for (const t of active) {
        const { data } = await admin.rpc("complete_cycles", { p_tenant_id: t.id });
        summary.cyclesCompleted += (data as number) ?? 0;
      }
    }

    logs.add("info", "Tick finished", { ...summary, ms: Date.now() - startedAt });
    return json({ ok: summary.problems.length === 0, ...summary, ms: Date.now() - startedAt });
  } catch (error) {
    const message = errorMessage(error);
    logs.add("error", message);
    return json({ ok: false, error: message, ...summary });
  } finally {
    await admin.rpc("release_collector_lease", { p_holder: holder });
    await logs.flush(admin);
  }
});
