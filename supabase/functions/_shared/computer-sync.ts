// Computer sync shared by sync-computers (Settings › Sync now) and the collector tick:
// Sophos Central tenants and endpoints → public.tenants and public.computers. Rows are never
// deleted: a tenant's computers are reconciled only after every page of its endpoints was read.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { mapEndpoints, mapTenant } from "./computer-mapping.ts";
import { errorMessage, type LogBuffer } from "./edge.ts";
import type { SophosClient } from "./sophos.ts";

export type TenantSyncResult = {
  tenantId: string;
  name: string;
  ok: boolean;
  seen?: number;
  new?: number;
  reactivated?: number;
  missing?: number;
  retired?: number;
  skipped?: number;
  error?: string;
};

export type SyncSummary = {
  ok: boolean;
  message: string;
  totals: { computers: number; new: number; retired: number; failedTenants: number };
  tenants: TenantSyncResult[];
};

// Updates sophos_connection.last_sync_*; throws when the credential, whoami or the tenant list fail
// (after recording the failure).
export async function syncComputers(admin: SupabaseClient, sophos: SophosClient, logs: LogBuffer): Promise<SyncSummary> {
  const results: TenantSyncResult[] = [];
  try {
    const who = await sophos.whoami();
    const tenants = await sophos.listTenants(who);

    const { data: upserted, error: tenantError } = await admin
      .from("tenants")
      .upsert(tenants.map((t) => mapTenant(t, who.idType)), { onConflict: "sophos_tenant_id" })
      .select("id, sophos_tenant_id, name");
    if (tenantError) throw new Error(`Could not save tenants: ${tenantError.message}`);
    const idsBySophosId = new Map((upserted ?? []).map((t) => [t.sophos_tenant_id as string, t.id as string]));

    for (const tenant of tenants) {
      const tenantId = idsBySophosId.get(tenant.id);
      if (!tenantId) continue;
      try {
        const endpoints = await sophos.listEndpoints(tenant);
        const { rows, skipped } = mapEndpoints(endpoints);
        const { data, error } = await admin.rpc("apply_computer_sync", { p_tenant_id: tenantId, p_endpoints: rows });
        if (error) throw new Error(error.message);
        const counts = data as Omit<TenantSyncResult, "tenantId" | "name" | "ok">;
        results.push({ tenantId, name: tenant.name, ok: true, ...counts, skipped });
        logs.add("info", `Synced ${tenant.name}`, { ...counts, skipped }, tenantId);
        if (skipped > 0) logs.add("warn", `Skipped ${skipped} endpoints without an ID or with an unsupported platform`, null, tenantId);
      } catch (error) {
        // A failed tenant keeps its computers untouched; the others still sync.
        const message = errorMessage(error);
        results.push({ tenantId, name: tenant.name, ok: false, error: message });
        logs.add("error", `Sync failed for ${tenant.name}: ${message}`, null, tenantId);
      }
    }

    const ok = results.every((r) => r.ok);
    const totals = results.reduce(
      (sum, r) => ({
        computers: sum.computers + (r.seen ?? 0),
        new: sum.new + (r.new ?? 0),
        retired: sum.retired + (r.retired ?? 0),
        failedTenants: sum.failedTenants + (r.ok ? 0 : 1),
      }),
      { computers: 0, new: 0, retired: 0, failedTenants: 0 },
    );
    const message =
      `${results.length} tenant${results.length === 1 ? "" : "s"} · ${totals.computers} computers · ${totals.new} new · ${totals.retired} retired` +
      (totals.failedTenants > 0 ? ` · ${totals.failedTenants} failed` : "");

    await admin
      .from("sophos_connection")
      .update({ last_sync_at: new Date().toISOString(), last_sync_ok: ok, last_sync_message: message, id_type: who.idType })
      .eq("id", 1);
    return { ok, message, totals, tenants: results };
  } catch (error) {
    await admin
      .from("sophos_connection")
      .update({ last_sync_at: new Date().toISOString(), last_sync_ok: false, last_sync_message: errorMessage(error) })
      .eq("id", 1);
    throw error;
  }
}
