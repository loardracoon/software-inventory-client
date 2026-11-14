// Reports: evidence packages for auditors. Generation and download go through the audit-report Edge Function.

import type { Database } from "@/integrations/supabase/types";
import { supabaseUrl } from "@/integrations/supabase/client";
import { db, invokeFunction, orThrow } from "@/lib/supabase-query";

export type AuditReportRow = Database["public"]["Views"]["v_audit_reports"]["Row"];

export async function fetchAuditReports(tenantId: string): Promise<AuditReportRow[]> {
  return orThrow(await db().from("v_audit_reports").select("*").eq("tenant_id", tenantId).order("generated_at", { ascending: false }).limit(200)) ?? [];
}

// Distinct scope tags in use in the tenant (the optional filter of a package).
export async function fetchScopeTags(tenantId: string): Promise<string[]> {
  const rows = orThrow(await db().from("v_computer_list").select("scope_tags").eq("tenant_id", tenantId).limit(5000)) ?? [];
  return [...new Set(rows.flatMap((r) => r.scope_tags ?? []))].sort();
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
