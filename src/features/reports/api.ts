// Reports: evidence packages for auditors. Generation and download go through the audit-report Edge Function.

import type { Database } from "@/integrations/supabase/types";
import { supabaseUrl } from "@/integrations/supabase/client";
import { db, invokeFunction, orThrow } from "@/lib/supabase-query";

export type AuditReportRow = Database["public"]["Views"]["v_audit_reports"]["Row"];

export async function fetchAuditReports(tenantId: string): Promise<AuditReportRow[]> {
  return orThrow(await db().from("v_audit_reports").select("*").eq("tenant_id", tenantId).order("generated_at", { ascending: false }).limit(200)) ?? [];
}

// Distinct scope tags in use in the tenant (the optional filter of a package), from SQL: PostgREST returns at most 1,000 rows.
export async function fetchScopeTags(tenantId: string): Promise<string[]> {
  return orThrow(await db().rpc("scope_tags_in_use", { p_tenant_id: tenantId })) ?? [];
}

// asOf: ISO date-time. scopeTag: null = all computers.
export function generateAuditReport(input: { tenantId: string; asOf: string; scopeTag: string | null }): Promise<{ report_id: string; manifest_sha256: string }> {
  return invokeFunction("audit-report", { tenant_id: input.tenantId, as_of: input.asOf, scope_tag: input.scopeTag });
}

// The ZIP is binary, so this reads the function's answer directly instead of through functions.invoke.
export async function downloadAuditReport(reportId: string): Promise<void> {
  const { data } = await db().auth.getSession();
  const response = await fetch(`${supabaseUrl}/functions/v1/audit-report?report_id=${encodeURIComponent(reportId)}`, {
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Download failed (HTTP ${response.status})`);
  }
  const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? `evidence-${reportId.slice(0, 8)}.zip`;
  const url = URL.createObjectURL(await response.blob());
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  // Safari and older Firefox can cancel the download if the URL is revoked at once.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export type InventoryReviewRow = Database["public"]["Tables"]["inventory_reviews"]["Row"];
export type ReviewStatus = Database["public"]["Functions"]["inventory_review_status"]["Returns"][number];
export type ReviewOutcome = "accurate" | "accurate_with_changes";

export async function fetchReviewStatus(tenantId: string): Promise<ReviewStatus | null> {
  return (orThrow(await db().rpc("inventory_review_status", { p_tenant_id: tenantId })) ?? [])[0] ?? null;
}

export async function fetchInventoryReviews(tenantId: string): Promise<InventoryReviewRow[]> {
  return orThrow(await db().from("inventory_reviews").select("*").eq("tenant_id", tenantId).order("reviewed_at", { ascending: false }).limit(200)) ?? [];
}

export async function recordInventoryReview(input: { reportId: string; outcome: ReviewOutcome; statement: string; notes: string | null }): Promise<string> {
  return orThrow(await db().rpc("record_inventory_review", { p_report_id: input.reportId, p_outcome: input.outcome, p_statement: input.statement, p_notes: input.notes ?? undefined })) as string;
}
