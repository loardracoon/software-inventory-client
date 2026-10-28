// Settings › Users and access › "Add user" (admins only): writes the email rule with the chosen role and
// sends a one-click sign-in email. A new person gets an Auth invitation (the account is created now and
// takes the rule's role); an existing user gets the new role and a magic link.

import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { adminClient, authorize, corsHeaders, errorMessage, HttpError, json } from "../_shared/edge.ts";
import { parseInvite } from "../_shared/users.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = adminClient();
  let callerId: string;
  try {
    const caller = await authorize(req, admin, { allowCollector: false });
    callerId = caller.kind === "user" ? caller.userId : "";
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    throw error;
  }

  let invite;
  try {
    invite = parseInvite(await req.json().catch(() => null));
  } catch (error) {
    return json({ error: errorMessage(error) }, 400);
  }

  try {
    const { data: existing } = await admin.from("profiles").select("id, role").eq("email", invite.email).maybeSingle();
    if (existing && existing.role === "admin" && invite.role !== "admin") {
      const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
      if ((count ?? 0) <= 1) return json({ error: "Keep at least one admin" }, 409);
    }

    // The rule first: Auth refuses to create an account without one.
    const { error: ruleError } = await admin
      .from("access_rules")
      .upsert({ kind: "email", value: invite.email, role: invite.role, created_by: callerId }, { onConflict: "kind,value" });
    if (ruleError) throw new Error(`Could not save the access rule: ${ruleError.message}`);

    let status: "invited" | "existing";
    if (existing) {
      const { error } = await admin.from("profiles").update({ role: invite.role }).eq("id", existing.id);
      if (error) throw new Error(`Could not change the role: ${error.message}`);
      // A magic link through the public endpoint, as if the person asked for it on the sign-in page.
      const anon = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: otpError } = await anon.auth.signInWithOtp({
        email: invite.email,
        options: { shouldCreateUser: false, ...(invite.redirectTo ? { emailRedirectTo: invite.redirectTo } : {}) },
      });
      if (otpError) throw new HttpError(otpError.status ?? 502, `Role saved, but the sign-in email failed: ${otpError.message}`);
      status = "existing";
    } else {
      const { error } = await admin.auth.admin.inviteUserByEmail(invite.email, invite.redirectTo ? { redirectTo: invite.redirectTo } : {});
      if (error) throw new HttpError(error.status ?? 502, `Could not send the invitation: ${error.message}`);
      status = "invited";
    }

    await admin.from("audit_log").insert({
      user_id: callerId,
      action: status === "invited" ? "invite user" : "send sign-in link",
      target: `access_rules:email:${invite.email}`,
      data: { email: invite.email, role: invite.role },
    });
    return json({ ok: true, status, email: invite.email, role: invite.role });
  } catch (error) {
    return json({ error: errorMessage(error) }, error instanceof HttpError ? error.status : 500);
  }
});
