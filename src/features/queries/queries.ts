import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type QueryStatusRow = Database["public"]["Functions"]["query_catalog_status"]["Returns"][number];
export type ProbeRow = Database["public"]["Views"]["v_capability_probes_latest"]["Row"];
export type Platform = Database["public"]["Enums"]["platform"];

export type ProbeCallResult = {
  ok: boolean;
  error?: string;
  started: number;
  succeeded: number;
  failed: number;
  noResponse: number;
  running: number;
  fellBackToRest: boolean;
  // "Tenant · platform" with no computer online: no probe was started there.
  noneOnline?: string[];
  errors: string[];
};

function client() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

// One row per catalog query (about 20): small and bounded, so it is read in one call.
export async function fetchQueryStatus(tenantId: string | null): Promise<QueryStatusRow[]> {
  const { data, error } = await client().rpc("query_catalog_status", tenantId ? { p_tenant_id: tenantId } : {});
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Latest probe per tenant and platform (at most 3 per tenant).
export async function fetchLatestProbes(tenantId: string | null): Promise<ProbeRow[]> {
  let query = client().from("v_capability_probes_latest").select("*").order("tenant_name").order("platform").limit(300);
  if (tenantId) query = query.eq("tenant_id", tenantId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function runProbe(action: "start" | "poll"): Promise<ProbeCallResult> {
  const { data, error } = await client().functions.invoke<ProbeCallResult>("probe-capabilities", { method: "POST", body: { action } });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = (await error.context.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `Request failed (HTTP ${error.context.status})`);
    }
    throw new Error(error.message);
  }
  return data as ProbeCallResult;
}
