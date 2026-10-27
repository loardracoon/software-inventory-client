// Capability probe I/O shared by probe-capabilities (Settings › Probe again) and the collector tick.
// The decisions live in capability-probe.ts.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { decideProbe, pickProbeTargets, probeKey, PROBE_QUERY, tablesFromRows, type ProbeCandidate } from "./capability-probe.ts";
import { errorMessage, type LogBuffer } from "./edge.ts";
import { createQueryProvider, readAllResults, type ProviderName } from "./query-provider.ts";
import type { SophosClient, SophosTenant } from "./sophos.ts";

export type ScanSettingsRow = {
  cycle_weekday: number;
  cycle_time: string;
  retry_time: string;
  timezone: string;
  batch_size: number;
  max_active_runs: number;
  runs_per_minute: number;
  daily_run_limit: number;
  reserve_pct: number;
  run_grace_minutes: number;
  provider: ProviderName;
};

export type TenantRow = {
  id: string;
  sophos_tenant_id: string;
  name: string;
  data_region_host: string | null;
  last_synced_at: string | null;
  scan_settings: ScanSettingsRow | null;
};

type ProbeRow = {
  id: string;
  tenant_id: string;
  platform: string;
  computer_id: string;
  provider: ProviderName;
  sophos_run_id: string;
  started_at: string;
  computers: { sophos_endpoint_id: string } | null;
};

export type ProbeSummary = {
  started: number;
  succeeded: number;
  failed: number;
  noResponse: number;
  running: number;
  fellBackToRest: boolean;
  // "Tenant · platform" where no computer was online, so no probe was started.
  noneOnline: string[];
  errors: string[];
};

export function newProbeSummary(): ProbeSummary {
  return { started: 0, succeeded: 0, failed: 0, noResponse: 0, running: 0, fellBackToRest: false, noneOnline: [], errors: [] };
}

export async function loadTenants(admin: SupabaseClient): Promise<Map<string, TenantRow>> {
  const { data, error } = await admin
    .from("tenants")
    .select("id, sophos_tenant_id, name, data_region_host, last_synced_at, scan_settings(*)");
  if (error) throw new Error(error.message);
  return new Map((data as unknown as TenantRow[]).map((t) => [t.id, t]));
}

export function sophosTenantOf(t: TenantRow): SophosTenant {
  if (!t.data_region_host) throw new Error(`Tenant ${t.name} has no data region; run a computer sync first`);
  return { id: t.sophos_tenant_id, name: t.name, apiHost: t.data_region_host };
}

// Advances running probes: store tables when the computer answered, record failures, give up after
// run_grace_minutes (cancel is best effort).
export async function advanceProbes(
  admin: SupabaseClient,
  sophos: SophosClient,
  logs: LogBuffer,
  tenants: Map<string, TenantRow>,
  lesUrl: string | undefined,
  summary: ProbeSummary,
): Promise<void> {
  const { data: running, error: runningError } = await admin
    .from("capability_probes")
    .select("id, tenant_id, platform, computer_id, provider, sophos_run_id, started_at, computers(sophos_endpoint_id)")
    .eq("status", "running");
  if (runningError) throw new Error(runningError.message);

  for (const probe of running as unknown as ProbeRow[]) {
    const tenant = tenants.get(probe.tenant_id);
    if (!tenant) continue;
    const finish = (status: string, fields: Record<string, unknown>) =>
      admin.from("capability_probes").update({ status, finished_at: new Date().toISOString(), ...fields }).eq("id", probe.id);
    try {
      const { provider } = createQueryProvider(sophos, sophosTenantOf(tenant), probe.provider, lesUrl);
      const run = await provider.getRun(probe.sophos_run_id);
      const endpoints = await provider.getEndpointStatuses(probe.sophos_run_id).catch(() => []);
      const endpoint = endpoints.find((e) => e.endpointId === probe.computers?.sophos_endpoint_id) ?? null;
      const decision = decideProbe(run, endpoint, probe.started_at, Date.now(), tenant.scan_settings?.run_grace_minutes ?? 10);

      if (decision.action === "wait") {
        summary.running++;
      } else if (decision.action === "collect") {
        const tables = tablesFromRows(await readAllResults(provider, probe.sophos_run_id));
        if (tables.length === 0) {
          await finish("failed", { error: "The probe returned no tables." });
          summary.failed++;
          continue;
        }
        const { error } = await admin
          .from("platform_capabilities")
          .upsert({ tenant_id: probe.tenant_id, platform: probe.platform, osquery_tables: tables, probed_at: new Date().toISOString() });
        if (error) throw new Error(error.message);
        await finish("succeeded", { table_count: tables.length });
        logs.add("info", `${tenant.name} ${probe.platform}: ${tables.length} osquery tables`, null, probe.tenant_id);
        summary.succeeded++;
      } else {
        if (decision.action === "no_response") {
          const cancelled = await provider
            .cancel(probe.sophos_run_id)
            .catch((e) => (logs.add("warn", `Could not cancel run: ${errorMessage(e)}`, null, probe.tenant_id), true));
          if (!cancelled) {
            logs.add("info", `${provider.name} cannot cancel runs; run ${probe.sophos_run_id} ends at its maximum duration`, null, probe.tenant_id);
          }
        }
        await finish(decision.action === "fail" ? "failed" : "no_response", { error: decision.message });
        logs.add("warn", `${tenant.name} ${probe.platform}: ${decision.message}`, null, probe.tenant_id);
        if (decision.action === "fail") summary.failed++;
        else summary.noResponse++;
      }
    } catch (error) {
      // Keep the probe running so the next poll retries; give up after the grace time. Sophos forgets
      // expired runs ("The metadata of the execution … was not found"), so an old probe would otherwise
      // stay running forever and block new probes of its platform.
      const message = errorMessage(error);
      const graceMs = (tenant.scan_settings?.run_grace_minutes ?? 10) * 60_000;
      if (Date.now() - Date.parse(probe.started_at) > graceMs) {
        await finish("no_response", { error: `Gave up after the grace time: ${message}` });
        logs.add("warn", `${tenant.name} ${probe.platform}: probe abandoned after the grace time (${message})`, null, probe.tenant_id);
        summary.noResponse++;
        continue;
      }
      logs.add("error", `Polling probe for ${tenant.name} ${probe.platform} failed: ${message}`, null, probe.tenant_id);
      summary.errors.push(`${tenant.name} ${probe.platform}: ${message}`);
      summary.running++;
    }
  }
}

export type StartProbeOptions = {
  requestedBy: string | null;
  // manual (Probe again): every platform, avoiding computers that failed in the last 24 h.
  // auto (collector): only platforms never probed, at most one attempt per platform per hour.
  mode: "manual" | "auto";
};

const FAILED_LOOKBACK_MS = 24 * 3600_000;
const AUTO_RETRY_MS = 3600_000;

export async function startProbes(
  admin: SupabaseClient,
  sophos: SophosClient,
  logs: LogBuffer,
  tenants: Map<string, TenantRow>,
  lesUrl: string | undefined,
  summary: ProbeSummary,
  options: StartProbeOptions,
): Promise<void> {
  const [{ data: stillRunning }, { data: computers }, { data: recentFailures }, { data: probed }, { data: recentAttempts }] = await Promise.all([
    admin.from("capability_probes").select("tenant_id, platform").eq("status", "running"),
    admin.from("computers").select("id, tenant_id, platform, sophos_endpoint_id, last_seen_at").is("retired_at", null),
    admin
      .from("capability_probes")
      .select("computer_id")
      .in("status", ["failed", "no_response"])
      .gte("started_at", new Date(Date.now() - FAILED_LOOKBACK_MS).toISOString()),
    options.mode === "auto" ? admin.from("platform_capabilities").select("tenant_id, platform") : Promise.resolve({ data: [] }),
    options.mode === "auto"
      ? admin.from("capability_probes").select("tenant_id, platform").gte("started_at", new Date(Date.now() - AUTO_RETRY_MS).toISOString())
      : Promise.resolve({ data: [] }),
  ]);
  const skipKeys = new Set(
    [...(stillRunning ?? []), ...(probed ?? []), ...(recentAttempts ?? [])].map((p) => probeKey(p.tenant_id as string, p.platform as string)),
  );
  const failed = new Set((recentFailures ?? []).map((p) => p.computer_id as string));
  // A tenant without a data region was never synced: nothing to probe yet.
  const candidates = ((computers ?? []) as ProbeCandidate[]).filter(
    (c) => tenants.get(c.tenant_id)?.data_region_host && !skipKeys.has(probeKey(c.tenant_id, c.platform)),
  );

  // Ask Sophos which candidates are online, one call per tenant; only those can be probed.
  const online = new Set<string>();
  const providers = new Map<string, ReturnType<typeof createQueryProvider>>();
  for (const tenantId of new Set(candidates.map((c) => c.tenant_id))) {
    const tenant = tenants.get(tenantId)!;
    const created = createQueryProvider(sophos, sophosTenantOf(tenant), tenant.scan_settings?.provider ?? "live_endpoint_search", lesUrl);
    providers.set(tenantId, created);
    try {
      const ids = await created.provider.onlineEndpoints(candidates.filter((c) => c.tenant_id === tenantId).map((c) => c.sophos_endpoint_id));
      if (ids === null) {
        summary.errors.push(`${tenant.name}: the Live Discover REST API cannot tell which computers are online, so no probe was started. Set SOPHOS_LES_URL.`);
        continue;
      }
      for (const id of ids) online.add(id);
    } catch (error) {
      summary.errors.push(`${tenant.name}: could not check which computers are online (${errorMessage(error)})`);
    }
  }

  const { targets, noneOnline } = pickProbeTargets(candidates, new Set(), failed, online);
  for (const c of noneOnline) {
    const tenant = tenants.get(c.tenant_id)!;
    if (providers.get(c.tenant_id)?.provider.name !== "live_endpoint_search") continue; // already reported above
    summary.noneOnline.push(`${tenant.name} · ${c.platform}`);
    logs.add("info", `${tenant.name} ${c.platform}: no computer online, probe not started`, null, c.tenant_id);
  }

  for (const target of targets) {
    const tenant = tenants.get(target.tenant_id)!;
    const preferred = tenant.scan_settings?.provider ?? "live_endpoint_search";
    try {
      const { provider, fellBack } = providers.get(target.tenant_id)!;
      if (fellBack) {
        summary.fellBackToRest = true;
        logs.add("warn", "SOPHOS_LES_URL is not set: using the Live Discover REST API", null, target.tenant_id);
      }
      const runId = await provider.startRun([target.sophos_endpoint_id], PROBE_QUERY);
      await admin.rpc("record_api_run", { p_tenant_id: target.tenant_id });
      const { error } = await admin.from("capability_probes").insert({
        tenant_id: target.tenant_id,
        platform: target.platform,
        computer_id: target.id,
        provider: provider.name,
        sophos_run_id: runId,
        requested_by: options.requestedBy,
      });
      if (error) throw new Error(error.message);
      summary.started++;
      summary.running++;
    } catch (error) {
      const message = errorMessage(error);
      await admin.from("capability_probes").insert({
        tenant_id: target.tenant_id,
        platform: target.platform,
        computer_id: target.id,
        provider: preferred,
        status: "failed",
        error: message,
        finished_at: new Date().toISOString(),
        requested_by: options.requestedBy,
      });
      logs.add("error", `Could not start the probe for ${tenant.name} ${target.platform}: ${message}`, null, target.tenant_id);
      summary.errors.push(`${tenant.name} ${target.platform}: ${message}`);
      summary.failed++;
    }
  }
}
