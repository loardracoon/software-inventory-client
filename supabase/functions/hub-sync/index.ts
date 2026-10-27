// Dictionary Hub sync (_shared/hub-sync.ts). Called by an admin (Settings › Sync now, user JWT) or
// with x-collector-secret; the collector tick runs the same sync when it is due.

import { adminClient, authorize, corsHeaders, errorMessage, HttpError, json, LogBuffer } from "../_shared/edge.ts";
import { requireHub, runHubSync } from "../_shared/hub-sync.ts";

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
    const summary = await runHubSync(admin, state, logs, () => BUDGET_MS - (Date.now() - startedAt));
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
