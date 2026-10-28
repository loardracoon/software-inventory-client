// Deno-only helpers shared by the Edge Functions: CORS, JSON responses, caller checks, the service
// role client, the Sophos credential and collector_logs.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { SophosClient, type ApiCallLog } from "./sophos.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-collector-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

export type Caller = { kind: "user"; userId: string } | { kind: "collector" };

// Admins (browser, user JWT) or, when allowed, pg_cron with x-collector-secret.
export async function authorize(req: Request, admin: SupabaseClient, options: { allowCollector: boolean }): Promise<Caller> {
  const collectorSecret = Deno.env.get("COLLECTOR_SECRET") ?? "";
  const sentSecret = req.headers.get("x-collector-secret");
  if (options.allowCollector && sentSecret !== null) {
    if (collectorSecret.length >= 16 && timingSafeEqual(sentSecret, collectorSecret)) return { kind: "collector" };
    throw new HttpError(401, "Invalid collector secret");
  }

  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sign in to continue");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Sign in to continue");

  const { data: profile } = await admin.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  if (profile?.role !== "admin") throw new HttpError(403, "Only admins can do this");
  return { kind: "user", userId: data.user.id };
}

// Admins and operators (public.can_contribute(), checked with the caller's own JWT).
export async function authorizeContributor(req: Request, admin: SupabaseClient): Promise<{ userId: string }> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sign in to continue");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Sign in to continue");

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const asUser = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: allowed } = await asUser.rpc("can_contribute");
  if (allowed !== true) throw new HttpError(403, "Only admins and operators can do this");
  return { userId: data.user.id };
}

// Vault credential (Settings) first; the SOPHOS_CLIENT_ID / SOPHOS_CLIENT_SECRET secrets are a fallback.
export async function loadSophosClient(admin: SupabaseClient, onCall: (log: ApiCallLog) => void): Promise<SophosClient> {
  const { data, error } = await admin.rpc("get_sophos_credential");
  if (error) throw new Error(`Could not read the Sophos Central credential: ${error.message}`);
  const row = (data as { client_id: string; client_secret: string }[] | null)?.[0];
  const clientId = row?.client_id ?? Deno.env.get("SOPHOS_CLIENT_ID") ?? "";
  const clientSecret = row?.client_secret ?? Deno.env.get("SOPHOS_CLIENT_SECRET") ?? "";
  if (!clientId || !clientSecret) {
    throw new HttpError(409, "No Sophos Central credential is configured. An admin can add one in Settings.");
  }
  return new SophosClient({
    clientId,
    clientSecret,
    onCall,
    // Overrides exist for local end-to-end tests against a mock; production uses the defaults.
    idUrl: Deno.env.get("SOPHOS_ID_URL") || undefined,
    globalUrl: Deno.env.get("SOPHOS_GLOBAL_URL") || undefined,
  });
}

type LogLevel = "debug" | "info" | "warn" | "error";

// Buffers collector_logs rows and writes them in one insert. Never put tokens or secrets in data.
export class LogBuffer {
  private rows: { step: string; tenant_id: string | null; level: LogLevel; message: string; data: unknown }[] = [];

  constructor(private readonly step: string) {}

  add(level: LogLevel, message: string, data?: unknown, tenantId: string | null = null) {
    this.rows.push({ step: this.step, tenant_id: tenantId, level, message, data: data ?? null });
  }

  apiCall = (log: ApiCallLog) => {
    const level: LogLevel = log.status === null || log.status >= 500 || log.status === 429 ? "warn" : log.status >= 400 ? "error" : "debug";
    this.add(level, `${log.method} ${log.host}${log.path} → ${log.status ?? "network error"}`, log);
  };

  async flush(admin: SupabaseClient) {
    if (this.rows.length === 0) return;
    const rows = this.rows;
    this.rows = [];
    const { error } = await admin.from("collector_logs").insert(rows);
    if (error) console.error("collector_logs insert failed", error.message);
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}
