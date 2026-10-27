// Computer sync: Sophos Central tenants and endpoints → public.tenants and public.computers.
// Called by an admin (Settings › Sync now, user JWT) or by pg_cron with x-collector-secret
// (deployed with --no-verify-jwt; see supabase/config.toml). The collector tick runs the same sync
// (_shared/computer-sync.ts) when it is due.

import { syncComputers } from "../_shared/computer-sync.ts";
import { adminClient, authorize, corsHeaders, errorMessage, HttpError, json, loadSophosClient, LogBuffer } from "../_shared/edge.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = adminClient();
  const logs = new LogBuffer("sync_computers");
  let caller;
  try {
    caller = await authorize(req, admin, { allowCollector: true });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    throw error;
  }

  try {
    const sophos = await loadSophosClient(admin, logs.apiCall);
    const summary = await syncComputers(admin, sophos, logs);
    if (caller.kind === "user") {
      await admin.from("audit_log").insert({ user_id: caller.userId, action: "sync computers", target: "sophos_connection", data: summary.totals });
    }
    return json(summary);
  } catch (error) {
    const message = errorMessage(error);
    logs.add("error", message);
    return json({ ok: false, error: message, tenants: [] });
  } finally {
    await logs.flush(admin);
  }
});
