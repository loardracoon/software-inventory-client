// "Request reclassification": admins and operators suggest another category for a title. The request
// goes to the Dictionary Hub (POST reclassification-requests) and the returned REQ id is stored;
// hub-sync then follows its status. Only the title key, the category, the reason and the evidence URL
// leave this app.

import { adminClient, authorizeContributor, corsHeaders, errorMessage, HttpError, json, LogBuffer } from "../_shared/edge.ts";
import { HubError, REASON_MAX } from "../_shared/hub.ts";
import { requireHub } from "../_shared/hub-sync.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Body = { title_id?: unknown; suggested_category_slug?: unknown; reason?: unknown; evidence_url?: unknown };

function validate(body: Body) {
  const titleId = typeof body.title_id === "string" && UUID.test(body.title_id) ? body.title_id : null;
  if (!titleId) throw new HttpError(400, "Choose a title");
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) throw new HttpError(400, "Enter a reason");
  if (reason.length > REASON_MAX) throw new HttpError(400, `The reason can have at most ${REASON_MAX} characters`);
  const slug = typeof body.suggested_category_slug === "string" && body.suggested_category_slug ? body.suggested_category_slug : null;
  let evidenceUrl: string | null = null;
  if (typeof body.evidence_url === "string" && body.evidence_url.trim()) {
    evidenceUrl = body.evidence_url.trim();
    let parsed: URL | null = null;
    try {
      parsed = new URL(evidenceUrl);
    } catch {
      parsed = null;
    }
    if (!parsed || !["http:", "https:"].includes(parsed.protocol) || evidenceUrl.length > 500) {
      throw new HttpError(400, "The evidence URL must be an http(s) link");
    }
  }
  return { titleId, reason, slug, evidenceUrl };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = adminClient();
  const logs = new LogBuffer("hub_reclassify");
  try {
    const { userId } = await authorizeContributor(req, admin);
    const input = validate((await req.json().catch(() => ({}))) as Body);

    const { data: title } = await admin.from("software_titles").select("id, kind, source, match_key").eq("id", input.titleId).maybeSingle();
    if (!title) throw new HttpError(404, "Title not found");
    const { data: current } = await admin.from("title_classification").select("category_slug").eq("title_id", title.id).maybeSingle();

    let suggestedHubId: string | null = null;
    if (input.slug) {
      const { data: category } = await admin.from("categories_cache").select("hub_id, level").eq("slug", input.slug).maybeSingle();
      if (!category || category.level !== 2) throw new HttpError(400, "Choose a subcategory");
      if (!category.hub_id) throw new HttpError(409, "The categories are not synced with the hub yet. Sync the dictionary and try again.");
      suggestedHubId = category.hub_id;
    }

    const { hub } = await requireHub(admin, logs.apiCall);
    const created = await hub.createRequest({
      kind: title.kind,
      source: title.source,
      match_key: title.match_key,
      suggested_category_id: suggestedHubId,
      reason: input.reason,
      evidence_url: input.evidenceUrl,
    });

    // The hub returns the open request when this client already has one for the entry: keep ours.
    const { error } = await admin.from("reclassification_requests").upsert(
      {
        hub_request_id: created.id,
        title_id: title.id,
        current_category_slug: current?.category_slug ?? null,
        suggested_category_slug: input.slug,
        reason: input.reason,
        evidence_url: input.evidenceUrl,
        status: created.status,
        created_by: userId,
      },
      { onConflict: "hub_request_id", ignoreDuplicates: true },
    );
    if (error) throw new Error(`Could not store the request: ${error.message}`);
    await admin.from("audit_log").insert({
      user_id: userId,
      action: "request reclassification",
      target: title.id,
      data: { hub_request_id: created.id, suggested_category_slug: input.slug },
    });
    return json({ id: created.id, status: created.status });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    const message = error instanceof HubError ? `The Dictionary Hub could not take the request (${error.message})` : errorMessage(error);
    logs.add("error", message);
    return json({ error: message }, 502);
  } finally {
    await logs.flush(admin);
  }
});
