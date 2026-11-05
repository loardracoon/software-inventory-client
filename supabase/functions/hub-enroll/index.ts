// Settings › Dictionary hub › Request access (admins only, phase 10c). Asks the Sophizo Hub for a client key:
//   { action: "request", name, organization, contact_email, reason, consent: true, consent_version }
//       makes the key, keeps it in the Vault, sends the Hub only its SHA-256 hash and the request details
//   { action: "check" }    reads the request status now (the collector also does it on a schedule)
//   { action: "cancel" }   cancels the open request at the Hub and deletes the key
//   { action: "dismiss" }  clears a finished request (rejected, expired, cancelled) so a new one can be sent
// No inventory data and never the key leave this app here.

import { adminClient, authorize, corsHeaders, errorMessage, HttpError, json, LogBuffer } from "../_shared/edge.ts";
import { checkHubEnrollment } from "../_shared/hub-enroll-run.ts";
import { enrollmentHubUrl, hubCall, newClientKey, nextCheckDelayMs, requestBody, sha256Hex, validateForm } from "../_shared/hub-enroll.ts";

const HUB_ERRORS: Record<number, string> = {
  400: "The Hub refused the request",
  403: "The Hub does not accept requests from this email domain",
  404: "The Hub does not take access requests now",
  429: "Too many requests from this address; try again in an hour",
  503: "The Hub has too many open requests; try again later",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = adminClient();
  const logs = new LogBuffer("hub_enroll");
  try {
    const caller = await authorize(req, admin, { allowCollector: false });
    const userId = caller.kind === "user" ? caller.userId : null;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const update = (status: string, error: string | null, nextAt: string | null = null) =>
      admin.rpc("hub_enrollment_update", { p_status: status, p_note: null, p_error: error, p_next_check_at: nextAt });

    switch (body.action) {
      case "request": {
        let form;
        try {
          form = validateForm(body);
        } catch (err) {
          throw new HttpError(400, errorMessage(err));
        }
        const hubUrl = enrollmentHubUrl((name) => Deno.env.get(name));
        const key = newClientKey();
        const { error: startError } = await admin.rpc("hub_enrollment_start", {
          p: { key, hub_url: hubUrl, user_id: userId, consent_version: body.consent_version, ...form },
        });
        if (startError) throw new HttpError(startError.code === "22023" ? 409 : 500, startError.message);

        let res: Response;
        try {
          res = await hubCall(fetch, `${hubUrl}/functions/v1/client-enrollments`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(requestBody(form, await sha256Hex(key), key, Deno.env.get("APP_VERSION") ?? null)),
          });
        } catch (err) {
          await update("none", `Could not reach the Hub: ${errorMessage(err)}`);
          throw new HttpError(502, "Could not reach the Hub; try again later");
        }
        await res.body?.cancel();
        if (res.status !== 202) {
          const message = HUB_ERRORS[res.status] ?? `The Hub answered HTTP ${res.status}`;
          await update("none", message);
          throw new HttpError(res.status === 429 || res.status === 503 ? res.status : 400, message);
        }
        await update("unverified", null, new Date(Date.now() + nextCheckDelayMs(null)).toISOString());
        logs.add("info", `Access requested from ${hubUrl}`, { contact: form.contact_email });
        return json({ status: "unverified" });
      }

      case "check":
        return json({ status: await checkHubEnrollment(admin) });

      case "cancel": {
        const { data } = await admin.rpc("hub_enrollment_key");
        const row = (data as { hub_url: string; key: string; status: string }[] | null)?.[0];
        if (row?.key) {
          await hubCall(fetch, `${row.hub_url}/functions/v1/client-enrollments`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${row.key}` },
            body: JSON.stringify({ action: "cancel" }),
          })
            .then((r) => r.body?.cancel())
            .catch(() => undefined); // the key is deleted here anyway; the Hub request then expires by itself
        }
        await update("cancelled", null);
        return json({ status: "cancelled" });
      }

      case "dismiss": {
        const { data } = await admin.from("hub_enrollment").select("status").eq("id", 1).maybeSingle();
        if (["requesting", "unverified", "pending"].includes(data?.status ?? "")) throw new HttpError(409, "Cancel the open request first");
        await update("none", null);
        return json({ status: "none" });
      }

      default:
        throw new HttpError(400, "action must be request, check, cancel or dismiss");
    }
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    logs.add("error", errorMessage(error));
    return json({ error: errorMessage(error) }, 500);
  } finally {
    await logs.flush(admin);
  }
});
