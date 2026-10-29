// Dictionary Hub sync (_shared/hub-sync.ts). Called by an admin (Settings › Sync now, user JWT) or
// with x-collector-secret; the collector tick runs the same sync when it is due. After the pull, the
// CVE matches and then the policy classes are brought up to date with the time left (Phase 10b), so a
// manual sync shows its result without waiting for the collector.

import { adminClient, authorize, corsHeaders, errorMessage, HttpError, json, LogBuffer } from "../_shared/edge.ts";
import { requireHub, runHubSync } from "../_shared/hub-sync.ts";
import { runPolicyEvaluation, type RpcClient } from "../_shared/policy-run.ts";
import { runVulnEvaluation } from "../_shared/vuln-run.ts";

const BUDGET_MS = 120_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const startedAt = Date.now();
  const admin = adminClient();
  const logs = new LogBuffer("hub_sync");
  let caller;
  try {
    caller = await authorize(req, admin, { allowCollector: true });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    throw error;
  }

  try {
    const state = await requireHub(admin, logs.apiCall);
    const timeLeft = () => BUDGET_MS - (Date.now() - startedAt);
    const sync = await runHubSync(admin, state, logs, timeLeft);
    const vulns = await runVulnEvaluation(admin as unknown as RpcClient, { timeLeft });
    const policy = await runPolicyEvaluation(admin as unknown as RpcClient, { alert: true, timeLeft });
    for (const message of [...vulns.errors, ...policy.errors]) logs.add("warn", message);
    const summary = { ...sync, vulns, policy };
    if (caller.kind === "user") {
      await admin.from("audit_log").insert({ user_id: caller.userId, action: "sync dictionary", target: "hub_connection", data: summary });
    }
    return json(summary);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    const message = errorMessage(error);
    logs.add("error", message);
    return json({ ok: false, error: message });
  } finally {
    await logs.flush(admin);
  }
});
