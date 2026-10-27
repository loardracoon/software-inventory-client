// Alerts: run by pg_cron every 5 minutes (alerts-tick, x-collector-secret), apart from the collector so
// a stopped collector is still reported, or by an admin (Settings › Alerts › Send test alert).
// detect_alerts() records new conditions once; this function delivers what is pending (at most 5 tries).

import { deliverAlert, emailReady, type Alert, type Channels } from "../_shared/alerts.ts";
import { adminClient, authorize, corsHeaders, errorMessage, HttpError, json, LogBuffer } from "../_shared/edge.ts";

const MAX_ATTEMPTS = 5;
const BATCH = 20;

type Secrets = { enabled: boolean; webhook_url: string | null; resend_key: string | null; email_from: string | null; email_to: string[] | null };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = adminClient();
  const logs = new LogBuffer("alerts");
  let caller;
  try {
    caller = await authorize(req, admin, { allowCollector: true });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    throw error;
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { test?: boolean };
    const { data: secretRows, error: secretError } = await admin.rpc("get_alert_secrets");
    if (secretError) throw new Error(`Could not read the alert settings: ${secretError.message}`);
    const s = (secretRows as Secrets[] | null)?.[0];
    const channels: Channels = {
      webhookUrl: s?.webhook_url ?? null,
      resendKey: s?.resend_key ?? null,
      emailFrom: s?.email_from ?? null,
      emailTo: s?.email_to ?? [],
    };
    const hasChannel = Boolean(channels.webhookUrl) || emailReady(channels);

    if (body.test && caller.kind === "user") {
      if (!hasChannel) throw new HttpError(409, "Add a webhook or an email channel first.");
      const { error } = await admin.from("alerts").insert({
        kind: "test",
        dedupe_key: `test:${crypto.randomUUID()}`,
        title: "Test alert",
        body: "This is a test alert from Endpoint Inventory. Alerts arrive here when a cycle closes below the coverage threshold, a query returns an error or the collector stops.",
      });
      if (error) throw new Error(`Could not create the test alert: ${error.message}`);
    }

    const { data: detected, error: detectError } = await admin.rpc("detect_alerts");
    if (detectError) throw new Error(`Alert detection failed: ${detectError.message}`);
    if (!s?.enabled || !hasChannel) return json({ ok: true, detected, sent: 0, failed: 0, note: s?.enabled ? "No alert channel configured" : "Alerts are off" });

    const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
    const { data: pending, error: pendingError } = await admin
      .from("alerts")
      .select("id, kind, title, body, data, created_at, attempts, tenants(name)")
      .is("sent_at", null)
      .lt("attempts", MAX_ATTEMPTS)
      .gte("created_at", since)
      .order("id")
      .limit(BATCH);
    if (pendingError) throw new Error(`Could not read pending alerts: ${pendingError.message}`);

    let sent = 0;
    let failed = 0;
    const resendUrl = Deno.env.get("RESEND_API_URL") || undefined; // test override (local mock)
    for (const row of (pending ?? []) as unknown as (Alert & { attempts: number; tenants: { name: string } | null })[]) {
      const alert: Alert = { ...row, tenant_name: row.tenants?.name ?? null };
      const errors = await deliverAlert(alert, channels, { resendUrl });
      const update = errors.length === 0
        ? { sent_at: new Date().toISOString(), attempts: row.attempts + 1, last_error: null }
        : { attempts: row.attempts + 1, last_error: errors.join("; ") };
      await admin.from("alerts").update(update).eq("id", row.id);
      if (errors.length === 0) sent++;
      else {
        failed++;
        logs.add("warn", `Alert ${row.id} not delivered: ${errors.join("; ")}`);
      }
    }
    if (caller.kind === "user" && body.test) {
      await admin.from("audit_log").insert({ user_id: caller.userId, action: "send test alert", target: "alert_settings", data: { sent, failed } });
    }
    if (sent + failed > 0) logs.add("info", `Alerts: ${sent} sent, ${failed} failed`, { detected, sent, failed });
    return json({ ok: failed === 0, detected, sent, failed });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    const message = errorMessage(error);
    logs.add("error", message);
    return json({ ok: false, error: message }, 500);
  } finally {
    await logs.flush(admin);
  }
});
