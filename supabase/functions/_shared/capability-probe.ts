// Capability probe decisions, kept pure for tests. The Edge Function probe-capabilities does the I/O.

import type { EndpointRunState, ResultRow, RunState } from "./query-provider.ts";

export const PROBE_QUERY = {
  name: "inv.capability_probe",
  sql: "SELECT name FROM osquery_registry WHERE registry = 'table'",
};

export type ProbeCandidate = {
  id: string;
  tenant_id: string;
  platform: "windows" | "macos" | "linux";
  sophos_endpoint_id: string;
  last_seen_at: string | null;
};

// For each tenant and platform without a running probe, the most recently seen computer that is online
// now (`online` holds Sophos endpoint IDs). Offline computers are never probed: their run would only
// wait out the grace time. Computers that just failed a probe are skipped while another online one of
// that platform exists. Platforms with no online computer come back in `noneOnline` (one computer each).
export function pickProbeTargets(
  computers: ProbeCandidate[],
  runningKeys: Set<string>,
  recentlyFailed: Set<string>,
  online: Set<string>,
): { targets: ProbeCandidate[]; noneOnline: ProbeCandidate[] } {
  const groups = new Map<string, ProbeCandidate[]>();
  for (const computer of computers) {
    const key = probeKey(computer.tenant_id, computer.platform);
    if (runningKeys.has(key)) continue;
    groups.set(key, [...(groups.get(key) ?? []), computer]);
  }
  const targets: ProbeCandidate[] = [];
  const noneOnline: ProbeCandidate[] = [];
  for (const group of groups.values()) {
    const sorted = group.filter((c) => online.has(c.sophos_endpoint_id)).sort((a, b) => seen(b) - seen(a));
    if (sorted.length === 0) noneOnline.push(group[0]);
    else targets.push(sorted.find((c) => !recentlyFailed.has(c.id)) ?? sorted[0]);
  }
  return { targets, noneOnline };
}

export function probeKey(tenantId: string, platform: string): string {
  return `${tenantId}:${platform}`;
}

function seen(computer: ProbeCandidate): number {
  return computer.last_seen_at ? Date.parse(computer.last_seen_at) : 0;
}

export type ProbeDecision =
  | { action: "wait" }
  | { action: "collect" }
  | { action: "fail"; message: string }
  | { action: "no_response"; message: string };

// The probe targets one endpoint, so its own status decides; the run status is the fallback when the
// provider gives no per-endpoint status. Results are read as soon as the endpoint finished, without
// waiting for the run, and the run is cancelled after the grace time.
export function decideProbe(
  run: RunState,
  endpoint: EndpointRunState | null,
  startedAt: string,
  now: number,
  graceMinutes: number,
): ProbeDecision {
  const state = endpoint ?? run;
  if (state.status === "finished") {
    if (state.result === "succeeded") return { action: "collect" };
    if (state.result === "timedOut") return { action: "no_response", message: "The computer did not answer before the run timed out." };
    if (state.result === "failed") {
      return { action: "fail", message: endpoint?.statusMessage || "The probe query failed on the computer." };
    }
  }
  if (now - Date.parse(startedAt) > graceMinutes * 60_000) {
    const minutes = `${graceMinutes} minute${graceMinutes === 1 ? "" : "s"}`;
    return { action: "no_response", message: `No answer within ${minutes} (the computer may be offline).` };
  }
  return { action: "wait" };
}

export function tablesFromRows(rows: ResultRow[]): string[] {
  const tables = new Set<string>();
  for (const row of rows) {
    const name = row.columns.name;
    if (typeof name === "string" && /^[A-Za-z0-9_]+$/.test(name)) tables.add(name);
  }
  return [...tables].sort();
}
