// Builds, checks and stores one evidence package. Used by the audit-report function (console) and by the mcp
// function (create_evidence_package, Phase 11 M3), which cannot call audit-report over HTTP: that one checks the
// caller with GoTrue's getUser, which accepts only sign-in sessions, not the mcp function's short-lived JWT.
// asUser must carry the caller's JWT: audit_report_data checks the role (admins and operators) in SQL.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { HttpError } from "../_shared/edge.ts";
import { buildEvidence, bytesToPgHex, contentTooBig, type ReportData } from "../_shared/evidence.ts";
import { storeReport } from "./store.ts";
import { zipEvidence } from "./zip.ts";

export const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
export const TOO_BIG = "The package is too big (25 MB limit). Narrow it with a scope tag.";

export function failure(error: { code?: string; message: string }): never {
  if (error.code === "42501") throw new HttpError(403, "Only admins and operators can do this");
  if (error.code === "22023") throw new HttpError(400, error.message);
  if (error.code === "54000") throw new HttpError(413, error.message);
  throw new Error(error.message);
}

export type GenerateInput = {
  asUser: SupabaseClient;
  admin: SupabaseClient;
  user: { id: string; email: string | null };
  tenantId: string;
  asOf: string; // ISO date-time
  scopeTag: string | null;
};

export async function generateEvidencePackage(input: GenerateInput): Promise<{ report_id: string; manifest_sha256: string }> {
  const { asUser, admin, user, tenantId, asOf, scopeTag } = input;
  // The generated type marks p_scope_tag as a non-null string; null means "all computers".
  let report: unknown;
  {
    const call = await asUser.rpc("audit_report_data", { p_tenant_id: tenantId, p_as_of: asOf, p_scope_tag: scopeTag as unknown as string });
    if (call.error) failure(call.error);
    report = call.data;
  }
  const { data: tenant } = await admin.from("tenants").select("id, name").eq("id", tenantId).maybeSingle();
  if (!tenant) throw new HttpError(404, "Tenant not found");

  const reportId = crypto.randomUUID();
  const evidence = await buildEvidence(report as ReportData, {
    reportId,
    tenant: { id: tenant.id, name: tenant.name },
    asOf,
    generatedAt: new Date().toISOString(),
    generatedBy: user.email ?? user.id,
    scopeTag,
    appVersion: Deno.env.get("APP_TAG") || "dev",
  });
  report = null; // the big JSON is not needed any more
  if (contentTooBig(evidence.files)) throw new HttpError(413, TOO_BIG);
  const archive = zipEvidence(evidence.files, evidence.manifestBytes);
  if (archive.length > MAX_ARCHIVE_BYTES) throw new HttpError(413, TOO_BIG);

  const { data: id, error: saveError } = await storeReport(
    {
      p_tenant_id: tenantId,
      p_as_of: asOf,
      p_scope_tag: scopeTag,
      p_manifest: evidence.manifest,
      p_manifest_sha256: evidence.manifestSha256,
      p_archive: bytesToPgHex(archive),
      p_users_masked: evidence.manifest.users_masked,
      p_generated_by: user.id,
    },
    {
      restUrl: Deno.env.get("INTERNAL_REST_URL") || undefined,
      serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      rpc: (args) => admin.rpc("record_audit_report", args),
    },
  );
  if (saveError) throw new Error(`Could not store the package: ${saveError.message}`);
  return { report_id: id as string, manifest_sha256: evidence.manifestSha256 };
}
