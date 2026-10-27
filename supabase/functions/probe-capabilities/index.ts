// Capability probe: which osquery tables each tenant's agents have, per platform.
// POST { action: "start" } (admins: Settings › Probe again) starts a probe on the most recently seen
// computer of every tenant and platform without one running; POST { action: "poll" } (admins, or
// pg_cron with x-collector-secret) advances running probes: stores the table list when the computer
// answers, records failures, and cancels after run_grace_minutes. Every call polls first. The
// collector tick also polls and probes never-probed platforms (_shared/probe-runner.ts).

import { adminClient, authorize, corsHeaders, errorMessage, HttpError, json, loadSophosClient, LogBuffer } from "../_shared/edge.ts";
import { advanceProbes, loadTenants, newProbeSummary, startProbes } from "../_shared/probe-runner.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = adminClient();
  const logs = new LogBuffer("probe_capabilities");
  let caller;
  try {
    caller = await authorize(req, admin, { allowCollector: true });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    throw error;
  }
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const action = body.action === "start" ? "start" : "poll";
  const lesUrl = Deno.env.get("SOPHOS_LES_URL") || undefined;

  const summary = newProbeSummary();
  try {
    const sophos = await loadSophosClient(admin, logs.apiCall);
    const tenants = await loadTenants(admin);
    await advanceProbes(admin, sophos, logs, tenants, lesUrl, summary);
    if (action === "start") {
      await startProbes(admin, sophos, logs, tenants, lesUrl, summary, {
        requestedBy: caller.kind === "user" ? caller.userId : null,
        mode: "manual",
      });
    }
    for (const tenantId of tenants.keys()) await admin.rpc("refresh_skipped_tasks", { p_tenant_id: tenantId });
    return json({ ok: summary.errors.length === 0, action, ...summary });
  } catch (error) {
    const message = errorMessage(error);
    logs.add("error", message);
    return json({ ok: false, action, error: message, ...summary });
  } finally {
    await logs.flush(admin);
  }
});
