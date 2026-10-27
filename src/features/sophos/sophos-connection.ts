import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type SophosConnectionStatus =
  Database["public"]["Functions"]["get_sophos_connection_status"]["Returns"][number];

export type ConnectionTestResult =
  | { ok: true; idType: string; regions: string[]; tenantCount: number; message: string }
  | { ok: false; error: string };

export type SyncResult = {
  ok: boolean;
  message?: string;
  error?: string;
  totals?: { computers: number; new: number; retired: number; failedTenants: number };
  tenants?: { name: string; ok: boolean; error?: string }[];
};

function client() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

export async function fetchSophosConnectionStatus(): Promise<SophosConnectionStatus> {
  const { data, error } = await client().rpc("get_sophos_connection_status");
  if (error) throw new Error(error.message);
  return data[0];
}

// The secret goes to Vault through this RPC and is never read back by the browser.
export async function saveSophosCredential(clientId: string, clientSecret: string): Promise<void> {
  const { error } = await client().rpc("set_sophos_credential", {
    p_client_id: clientId,
    p_client_secret: clientSecret,
  });
  if (error) throw new Error(error.message);
}

export async function removeSophosCredential(): Promise<void> {
  const { error } = await client().rpc("clear_sophos_credential");
  if (error) throw new Error(error.message);
}

async function invoke<T>(name: string): Promise<T> {
  const { data, error } = await client().functions.invoke<T>(name, { method: "POST", body: {} });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = (await error.context.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `Request failed (HTTP ${error.context.status})`);
    }
    throw new Error(error.message);
  }
  return data as T;
}

export function testSophosConnection(): Promise<ConnectionTestResult> {
  return invoke<ConnectionTestResult>("sophos-connection-test");
}

export function syncComputers(): Promise<SyncResult> {
  return invoke<SyncResult>("sync-computers");
}
