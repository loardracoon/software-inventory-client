// Settings › "Test connection": token, whoami and tenant count. Admins only. Returns the credential
// type, regions and tenant count; never secrets or tokens.

import { hostOf } from "../_shared/computer-mapping.ts";
import { adminClient, authorize, corsHeaders, errorMessage, HttpError, json, loadSophosClient, LogBuffer } from "../_shared/edge.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = adminClient();
  const logs = new LogBuffer("test_connection");
  try {
    await authorize(req, admin, { allowCollector: false });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    throw error;
  }

  try {
    const sophos = await loadSophosClient(admin, logs.apiCall);
    const who = await sophos.whoami();
    const tenants = await sophos.listTenants(who);
    const regions = [...new Set(tenants.map((t) => hostOf(t.apiHost)).filter(Boolean))] as string[];
    const message = `Connected as ${who.idType} · ${tenants.length} tenant${tenants.length === 1 ? "" : "s"}`;

    await admin
      .from("sophos_connection")
      .update({
        last_test_at: new Date().toISOString(),
        last_test_ok: true,
        last_test_message: message,
        id_type: who.idType,
        data_region_host: who.idType === "tenant" ? (who.apiHosts.dataRegion ?? null) : null,
      })
      .eq("id", 1);
    logs.add("info", message, { idType: who.idType, tenantCount: tenants.length, regions });
    return json({ ok: true, idType: who.idType, regions, tenantCount: tenants.length, message });
  } catch (error) {
    const message = errorMessage(error);
    if (!(error instanceof HttpError && error.status === 409)) {
      await admin
        .from("sophos_connection")
        .update({ last_test_at: new Date().toISOString(), last_test_ok: false, last_test_message: message })
        .eq("id", 1);
    }
    logs.add("error", message);
    // 200 with ok: false so the browser can show the reason.
    return json({ ok: false, error: message });
  } finally {
    await logs.flush(admin);
  }
});
