// Dictionary Hub sync, run by the hub-sync Edge Function (Settings › Sync now) and by the collector
// tick when due (every 6 hours, after a failure with backoff, or when new titles wait to be shared):
//   1 pull   GET dictionary-changes since last_seq, one apply_dictionary_changes transaction per page
//   2 push   unsent hub_submissions to titles-submit, only when sharing is on
//   3 status GET reclassification-requests for the open requests
// The cache keeps classifying while the hub is unreachable; hub_sync_finished records the backoff.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { errorMessage, HttpError, type LogBuffer } from "./edge.ts";
import { HubClient, SUBMIT_BATCH, type TitleSubmission } from "./hub.ts";
import type { ApiCallLog } from "./sophos.ts";

const MAX_PAGES = 20;
const MIN_TIME_LEFT_MS = 15_000;
const STATUS_BATCH = 50;

export type HubState = { hub: HubClient; share: boolean; lastSeq: number };

export type HubSyncSummary = {
  ok: boolean;
  error?: string;
  pages: number;
  categories: number;
  upserted: number;
  dropped: number;
  skipped: number;
  lastSeq: number;
  submitted: number;
  requestsUpdated: number;
};

// Settings (Vault) first; the HUB_URL / HUB_CLIENT_KEY secrets are a fallback. null = not configured.
export async function loadHub(admin: SupabaseClient, onCall: (log: ApiCallLog) => void): Promise<HubState | null> {
  const { data, error } = await admin.rpc("get_hub_credential");
  if (error) throw new Error(`Could not read the Dictionary Hub connection: ${error.message}`);
  const row = (data as { url: string | null; client_key: string | null; share_unknown_titles: boolean; last_seq: number }[] | null)?.[0];
  const url = row?.url ?? Deno.env.get("HUB_URL") ?? "";
  const key = row?.client_key ?? Deno.env.get("HUB_CLIENT_KEY") ?? "";
  if (!url || !key) return null;
  return { hub: new HubClient({ url, key, onCall }), share: row?.share_unknown_titles ?? true, lastSeq: Number(row?.last_seq ?? 0) };
}

export async function requireHub(admin: SupabaseClient, onCall: (log: ApiCallLog) => void): Promise<HubState> {
  const state = await loadHub(admin, onCall);
  if (!state) throw new HttpError(409, "No Dictionary Hub is configured. An admin can add one in Settings.");
  return state;
}

// Collector: due on schedule (next_attempt_at), or early when titles wait and the last sync worked.
export async function hubSyncDue(admin: SupabaseClient): Promise<boolean> {
  const { data } = await admin.from("hub_connection").select("next_attempt_at, share_unknown_titles, last_error").eq("id", 1).maybeSingle();
  if (!data) return false;
  if (!data.next_attempt_at || Date.parse(data.next_attempt_at) <= Date.now()) return true;
  if (!data.share_unknown_titles || data.last_error) return false;
  const { count } = await admin.from("hub_submissions").select("id", { count: "exact", head: true }).is("sent_at", null);
  return (count ?? 0) > 0;
}

export async function runHubSync(admin: SupabaseClient, state: HubState, logs: LogBuffer, timeLeft: () => number): Promise<HubSyncSummary> {
  const summary: HubSyncSummary = {
    ok: true,
    pages: 0,
    categories: 0,
    upserted: 0,
    dropped: 0,
    skipped: 0,
    lastSeq: state.lastSeq,
    submitted: 0,
    requestsUpdated: 0,
  };
  try {
    // 1 pull
    for (let more = true; more && summary.pages < MAX_PAGES && timeLeft() > MIN_TIME_LEFT_MS; ) {
      const page = await state.hub.dictionaryChanges(summary.lastSeq);
      const { data, error } = await admin.rpc("apply_dictionary_changes", {
        p_categories: page.categories,
        p_entries: page.entries,
        p_next_seq: page.next_seq,
      });
      if (error) throw new Error(`Could not apply dictionary changes: ${error.message}`);
      const counts = data as { categories: number; upserted: number; dropped: number; skipped: number };
      summary.pages++;
      summary.categories += counts.categories;
      summary.upserted += counts.upserted;
      summary.dropped += counts.dropped;
      summary.skipped += counts.skipped;
      summary.lastSeq = Math.max(summary.lastSeq, page.next_seq);
      more = page.has_more && page.next_seq > 0;
    }
    if (summary.skipped > 0) logs.add("warn", `${summary.skipped} dictionary rows skipped (unknown category or method)`);

    // 2 push: metadata only (hub.ts copies the six allowed fields)
    while (state.share && timeLeft() > MIN_TIME_LEFT_MS) {
      const { data, error } = await admin
        .from("hub_submissions")
        .select("id, kind, source, match_key, name, vendor, description")
        .is("sent_at", null)
        .order("first_seen")
        .limit(SUBMIT_BATCH);
      if (error) throw new Error(`Could not read hub submissions: ${error.message}`);
      const rows = (data ?? []) as (TitleSubmission & { id: string })[];
      if (rows.length === 0) break;
      await state.hub.submitTitles(rows);
      const { error: markError } = await admin
        .from("hub_submissions")
        .update({ sent_at: new Date().toISOString() })
        .in("id", rows.map((r) => r.id));
      if (markError) throw new Error(`Could not mark hub submissions as sent: ${markError.message}`);
      summary.submitted += rows.length;
      if (rows.length < SUBMIT_BATCH) break;
    }

    // 3 request status
    const { data: open, error: openError } = await admin
      .from("reclassification_requests")
      .select("hub_request_id, status, admin_note")
      .eq("status", "open")
      .order("created_at")
      .limit(500);
    if (openError) throw new Error(`Could not read reclassification requests: ${openError.message}`);
    const openRows = (open ?? []) as { hub_request_id: string; status: string; admin_note: string | null }[];
    for (let i = 0; i < openRows.length && timeLeft() > MIN_TIME_LEFT_MS; i += STATUS_BATCH) {
      const batch = openRows.slice(i, i + STATUS_BATCH);
      const statuses = await state.hub.requestStatus(batch.map((r) => r.hub_request_id));
      for (const s of statuses) {
        const mine = batch.find((r) => r.hub_request_id === s.id);
        if (!mine || (mine.status === s.status && mine.admin_note === (s.admin_note ?? null))) continue;
        if (!["open", "accepted", "rejected", "superseded"].includes(s.status)) continue;
        const { error } = await admin
          .from("reclassification_requests")
          .update({ status: s.status, admin_note: s.admin_note ?? null, updated_at: new Date().toISOString() })
          .eq("hub_request_id", s.id);
        if (error) throw new Error(`Could not update request ${s.id}: ${error.message}`);
        summary.requestsUpdated++;
      }
    }
  } catch (error) {
    summary.ok = false;
    summary.error = errorMessage(error);
    logs.add("error", `Dictionary Hub sync failed: ${summary.error}`);
  }

  const { error: finishError } = await admin.rpc("hub_sync_finished", { p_ok: summary.ok, p_error: summary.error ?? null });
  if (finishError) logs.add("warn", `hub_sync_finished failed: ${finishError.message}`);
  if (summary.upserted + summary.dropped + summary.categories > 0) {
    const { error: refreshError } = await admin.rpc("refresh_title_summary_if_due");
    if (refreshError) logs.add("warn", `title_summary refresh failed: ${refreshError.message}`);
  }
  logs.add(summary.ok ? "info" : "warn", "Dictionary Hub sync", summary);
  return summary;
}
