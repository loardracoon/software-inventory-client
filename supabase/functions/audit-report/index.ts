// Reports: POST builds an evidence package (as the caller, so the SQL role check applies), stores it with the
// service role and returns its id and hash. GET ?report_id= returns the stored ZIP unchanged.

import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { adminClient, corsHeaders, errorMessage, HttpError } from "../_shared/edge.ts";
import { pgHexToBytes } from "../_shared/evidence.ts";
import { failure, generateEvidencePackage } from "./generate.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cors = { ...corsHeaders, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Expose-Headers": "Content-Disposition" };

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET" && req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) throw new HttpError(401, "Sign in to continue");
    const admin = adminClient();
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) throw new HttpError(401, "Sign in to continue");
    // The role checks live in SQL and read the caller's JWT; with the service role they would see no roles.
    const asUser = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    if (req.method === "GET") {
      const reportId = new URL(req.url).searchParams.get("report_id") ?? "";
      if (!UUID.test(reportId)) throw new HttpError(400, "report_id is required");
      const { data, error } = await asUser.rpc("get_audit_report_archive", { p_report_id: reportId });
      if (error) failure(error);
      if (typeof data !== "string") throw new HttpError(404, "Package not found, or only admins and operators can download it");
      const { data: row } = await asUser.from("v_audit_reports").select("tenant_id, as_of").eq("id", reportId).maybeSingle();
      const { data: tenant } = row ? await admin.from("tenants").select("name").eq("id", row.tenant_id).maybeSingle() : { data: null };
      const slug = (tenant?.name ?? "tenant").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tenant";
      const name = `evidence-${slug}-${(row?.as_of ?? "").slice(0, 10)}-${reportId.slice(0, 8)}.zip`;
      return new Response(pgHexToBytes(data) as BodyInit, {
        headers: { ...cors, "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"` },
      });
    }

    const body = (await req.json().catch(() => null)) as { tenant_id?: unknown; as_of?: unknown; scope_tag?: unknown } | null;
    const tenantId = typeof body?.tenant_id === "string" ? body.tenant_id : "";
    if (!UUID.test(tenantId)) throw new HttpError(400, "tenant_id is required");
    const asOfDate = body?.as_of === undefined || body.as_of === null ? new Date() : new Date(String(body.as_of));
    if (Number.isNaN(asOfDate.getTime())) throw new HttpError(400, "as_of is not a valid date");
    const scopeTag = typeof body?.scope_tag === "string" && body.scope_tag.trim() ? body.scope_tag.trim() : null;
    const asOf = asOfDate.toISOString();

    const result = await generateEvidencePackage({
      asUser,
      admin,
      user: { id: auth.user.id, email: auth.user.email ?? null },
      tenantId,
      asOf,
      scopeTag,
    });
    return reply(result);
  } catch (error) {
    if (error instanceof HttpError) return reply({ error: error.message }, error.status);
    console.error("audit-report failed", errorMessage(error));
    return reply({ error: errorMessage(error) }, 500);
  }
});
