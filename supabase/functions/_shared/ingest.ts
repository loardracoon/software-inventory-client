// Collector step "ingest": raw results → normalized, hashed snapshots → ingest_snapshot (one
// transaction each). A raw result that fails is marked with ingest_error and skipped from then on;
// clear the column to retry it (update raw_results set ingest_error = null where id = ...).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { errorMessage, type LogBuffer } from "./edge.ts";
import { hashItems, normalize, type RawRow } from "./normalize.ts";

const BATCH = 25;
const MIN_TIME_LEFT_MS = 10_000;

type PendingRow = {
  id: string;
  tenant_id: string;
  rows: RawRow[];
  query_catalog: { domain: string; platform: string; name: string; version: number } | null;
};

export type IngestSummary = {
  ingested: number;
  failed: number;
  outcomes: Record<string, number>;
  titleSummaryRefreshed: boolean;
};

export async function ingestPending(admin: SupabaseClient, logs: LogBuffer, timeLeft: () => number): Promise<IngestSummary> {
  const summary: IngestSummary = { ingested: 0, failed: 0, outcomes: {}, titleSummaryRefreshed: false };
  const { data, error } = await admin
    .from("raw_results")
    .select("id, tenant_id, rows, query_catalog(domain, platform, name, version)")
    .is("ingested_at", null)
    .is("ingest_error", null)
    .order("received_at")
    .limit(BATCH);
  if (error) throw new Error(`Could not read raw results: ${error.message}`);

  for (const raw of (data ?? []) as unknown as PendingRow[]) {
    if (timeLeft() < MIN_TIME_LEFT_MS) break;
    try {
      const query = raw.query_catalog;
      if (!query) throw new Error("The raw result has no query");
      const payload = await hashItems(normalize(query.domain, query.platform, query.name, Array.isArray(raw.rows) ? raw.rows : [], query.version));
      const { data: result, error: rpcError } = await admin.rpc("ingest_snapshot", { p_raw_result_id: raw.id, p_payload: payload });
      if (rpcError) throw new Error(rpcError.message);
      const outcome = (result as { outcome?: string; skipped?: boolean }).outcome ?? "skipped";
      summary.outcomes[outcome] = (summary.outcomes[outcome] ?? 0) + 1;
      summary.ingested++;
    } catch (e) {
      const message = errorMessage(e);
      await admin.rpc("mark_ingest_error", { p_raw_result_id: raw.id, p_error: message });
      logs.add("error", `Could not ingest raw result ${raw.id}: ${message}`, null, raw.tenant_id);
      summary.failed++;
    }
  }

  if (summary.ingested > 0 || summary.failed === 0) {
    const { data: refreshed, error: refreshError } = await admin.rpc("refresh_title_summary_if_due");
    if (refreshError) logs.add("warn", `title_summary refresh failed: ${refreshError.message}`);
    summary.titleSummaryRefreshed = refreshed === true;
  }
  return summary;
}
