// Collector decisions kept pure for tests; the collector Edge Function does the I/O.
// Runtime-neutral (Deno and Node).

import type { EndpointRunState, ResultRow } from "./query-provider.ts";

export type EndpointAction =
  | { action: "wait" }
  | { action: "collect" }
  | { action: "error"; message: string }
  | { action: "no_response"; message: string };

// Per computer in a run: results are read as soon as it finished, without waiting for the run.
export function decideEndpoint(state: EndpointRunState): EndpointAction {
  if (state.status !== "finished") return { action: "wait" };
  switch (state.result) {
    case "succeeded":
      return { action: "collect" };
    case "failed":
      return { action: "error", message: state.statusMessage || "The query failed on the computer." };
    case "timedOut":
      return { action: "no_response", message: "The computer did not answer before the run timed out." };
    default:
      return { action: "wait" };
  }
}

// A run is given up after run_grace_minutes: it is cancelled (best effort) and its silent
// computers go to the daily retry.
export function runPastGrace(startedAt: string, graceMinutes: number, now: number): boolean {
  return now - Date.parse(startedAt) > graceMinutes * 60_000;
}

export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error("Chunk size must be at least 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Result rows of a run grouped by endpoint, as plain column objects (what raw_results keeps).
export function rowsByEndpoint(rows: ResultRow[]): Map<string, Record<string, unknown>[]> {
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    if (!row.endpointId) continue;
    const list = grouped.get(row.endpointId) ?? [];
    list.push(row.columns);
    grouped.set(row.endpointId, list);
  }
  return grouped;
}

// Run name shown in Sophos Central, e.g. "inv.programs.v1".
export function runName(queryName: string, version: number): string {
  return `${queryName}.v${version}`;
}
