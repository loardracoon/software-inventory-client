// Dictionary Hub, reclassification requests, local overrides and CSV exports: all browser I/O.
// The hub client key goes to Vault through set_hub_connection and is never read back; only Edge
// Functions talk to the hub.

import type { Database } from "@/integrations/supabase/types";
import { db, invokeFunction, orThrow } from "@/lib/supabase-query";
import { useLoad } from "@/lib/use-load";

type Tables = Database["public"]["Tables"];
export type HubStatus = Database["public"]["Functions"]["get_hub_status"]["Returns"][number];
export type ReclassificationRequest = Tables["reclassification_requests"]["Row"];
export type LocalOverride = Tables["local_overrides"]["Row"];
export type AttentionLevel = Database["public"]["Enums"]["attention_level"];

export type HubSyncResult = {
  ok: boolean;
  error?: string;
  pages: number;
  upserted: number;
  dropped: number;
  submitted: number;
  requestsUpdated: number;
  lastSeq: number;
};

export async function fetchHubStatus(): Promise<HubStatus> {
  return (orThrow(await db().rpc("get_hub_status")) ?? [])[0];
}

export async function saveHubConnection(url: string, key: string): Promise<void> {
  orThrow(await db().rpc("set_hub_connection", { p_url: url, p_key: key }));
}

export async function removeHubConnection(): Promise<void> {
  orThrow(await db().rpc("clear_hub_connection"));
}

export async function setHubSharing(share: boolean): Promise<void> {
  orThrow(await db().rpc("set_hub_sharing", { p_share: share }));
}

export function syncHub(): Promise<HubSyncResult> {
  return invokeFunction<HubSyncResult>("hub-sync");
}

// Admins and operators export and request reclassification (public.can_contribute()).
export function useCanContribute(): boolean {
  const { data } = useLoad("can_contribute", async () => orThrow(await db().rpc("can_contribute")) === true);
  return data === true;
}

// Reclassification -----------------------------------------------------------------------------------

export const REASON_MAX = 500;

export type ReclassificationInput = {
  titleId: string;
  suggestedCategorySlug: string | null; // null = Other
  reason: string;
  evidenceUrl: string;
};

export function requestReclassification(input: ReclassificationInput): Promise<{ id: string; status: string }> {
  return invokeFunction("hub-reclassify", {
    title_id: input.titleId,
    suggested_category_slug: input.suggestedCategorySlug,
    reason: input.reason.trim(),
    evidence_url: input.evidenceUrl.trim() || null,
  });
}

export async function fetchTitleRequests(titleId: string): Promise<ReclassificationRequest[]> {
  return orThrow(await db().from("reclassification_requests").select("*").eq("title_id", titleId).order("created_at", { ascending: false })) ?? [];
}

export async function fetchOpenRequestTitleIds(titleIds: string[]): Promise<Set<string>> {
  if (titleIds.length === 0) return new Set();
  const rows = orThrow(await db().from("reclassification_requests").select("title_id").eq("status", "open").in("title_id", titleIds)) ?? [];
  return new Set(rows.map((r) => r.title_id));
}

// Local overrides (admins) -----------------------------------------------------------------------------

export async function fetchLocalOverride(titleId: string): Promise<LocalOverride | null> {
  return orThrow(await db().from("local_overrides").select("*").eq("title_id", titleId).maybeSingle());
}

export async function saveLocalOverride(titleId: string, categorySlug: string, attention: AttentionLevel | null, note: string): Promise<void> {
  orThrow(
    await db()
      .from("local_overrides")
      .upsert({ title_id: titleId, category_slug: categorySlug, attention_level: attention, note: note.trim() || null }, { onConflict: "title_id" }),
  );
}

export async function removeLocalOverride(titleId: string): Promise<void> {
  orThrow(await db().from("local_overrides").delete().eq("title_id", titleId));
}

// CSV exports (generated and audited by public.export_csv) ---------------------------------------------

export type ExportDataset = "computers" | "software" | "title_computers" | "changes";

export async function exportCsv(dataset: ExportDataset, filters: object): Promise<void> {
  const csv = orThrow(await db().rpc("export_csv", { p_dataset: dataset, p_filters: JSON.parse(JSON.stringify(filters)) })) as string;
  // BOM so spreadsheet apps read UTF-8.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${dataset.replace("_", "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
