// Application policy evaluation (Phase 9, _shared/policy-run.ts). Called by the browser right after
// policy_publish (JWT of an admin of that tenant) or with x-collector-secret; body { tenant_id }.
// Evaluates every current (title, version) of the tenant under the published policy. The collector
// step "policy" covers new pairs after each ingest and runs this again if it stops before the end.

import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { adminClient, authorize, corsHeaders, errorMessage, HttpError, json, LogBuffer } from "../_shared/edge.ts";
import { runPolicyEvaluation, type RpcClient } from "../_shared/policy-run.ts";

const BUDGET_MS = 120_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A tenant admin (tenant_members) is not a global admin, so ask the database with the caller's JWT.
async function requireTenantAdmin(req: Request, tenantId: string): Promise<string> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sign in to continue");
  const asUser = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: user, error } = await asUser.auth.getUser(token);
  if (error || !user.user) throw new HttpError(401, "Sign in to continue");
  const { data } = await asUser.rpc("policy_get", { p_tenant_id: tenantId });
  if ((data as { can_edit?: boolean } | null)?.can_edit !== true) throw new HttpError(403, "Only admins of this tenant can do this");
  return user.user.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const startedAt = Date.now();
  const admin = adminClient();
  const logs = new LogBuffer("policy");
  let tenantId: string;
  let userId: string | null = null;
  try {
    const body = (await req.json().catch(() => ({}))) as { tenant_id?: unknown };
    tenantId = typeof body.tenant_id === "string" ? body.tenant_id : "";
    if (!UUID.test(tenantId)) throw new HttpError(400, "tenant_id is required");
    if (req.headers.get("x-collector-secret") !== null) await authorize(req, admin, { allowCollector: true });
    else userId = await requireTenantAdmin(req, tenantId);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    throw error;
  }

  try {
    const summary = await runPolicyEvaluation(admin as unknown as RpcClient, {
      tenantId,
      alert: false,
      timeLeft: () => BUDGET_MS - (Date.now() - startedAt),
    });
    for (const message of summary.errors) logs.add("warn", `Policy evaluation: ${message}`, null, tenantId);
    if (userId) {
      await admin.from("audit_log").insert({ user_id: userId, action: "policy evaluated", target: "title_version_policy", data: { tenant_id: tenantId, ...summary } });
    }
    return json({ ok: summary.errors.length === 0, ...summary });
  } catch (error) {
    const message = errorMessage(error);
    logs.add("error", message, null, tenantId);
    return json({ ok: false, error: message });
  } finally {
    await logs.flush(admin);
  }
});
