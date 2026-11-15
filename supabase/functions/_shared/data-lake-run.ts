// Collector step data_lake: fills computers Live Discover could not reach from the Sophos Data Lake.
// The RPCs pick the computers and store the rows; this file only searches and maps. Runtime-neutral.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import {
  DataLakeClient,
  DataLakeOverLimitError,
  HOSTS_PER_PATCH_SEARCH,
  HOSTS_PER_SEARCH,
  latestSnapshots,
  patchStateQl,
  searchWindow,
  snapshotTime,
  softwareInfoQl,
  toExtensionRows,
  toPatchRows,
  toProgramRows,
  UUID,
  type DataLakeRow,
} from "./data-lake.ts";
import type { LogBuffer } from "./edge.ts";
import type { TenantRow } from "./probe-runner.ts";
import type { SophosClient } from "./sophos.ts";

export const DATA_LAKE_RETRY_MS = 3_600_000;
const MIN_LEFT_MS = 30_000;
const SEARCH_MARGIN_MS = 15_000;

type Target = { computer_id: string; sophos_endpoint_id: string; domains: string[] };
type Item = { computer_id: string; domain: string; collected_at: string; rows: unknown[] };
type Searcher = { search(ql: string, deadline: number): Promise<{ urn: string; rows: DataLakeRow[] }> };

export async function syncDataLake(
  admin: SupabaseClient,
  sophos: SophosClient,
  logs: LogBuffer,
  tenant: TenantRow,
  timeLeft: () => number,
  now: number = Date.now(),
  makeClient: (tenant: TenantRow) => Searcher = (t) => new DataLakeClient(sophos, t.sophos_tenant_id),
): Promise<{ searches: number; rawResults: number }> {
  const out = { searches: 0, rawResults: 0 };
  const last = tenant.data_lake_attempt_at ? Date.parse(tenant.data_lake_attempt_at) : null;
  if (!(tenant.scan_settings?.data_lake_inventory || tenant.scan_settings?.data_lake_patches) || (last !== null && now - last < DATA_LAKE_RETRY_MS)) return out;

  // Stamped first: a failing tenant is tried again in an hour, not every tick.
  await admin.from("tenants").update({ data_lake_attempt_at: new Date(now).toISOString() }).eq("id", tenant.id);
  try {
    const client = makeClient(tenant);
    // One store call per search: the RPC is idempotent per (search URN, domain). urn null = no search,
    // the call only stamps p_checked.
    const store = async (urn: string | null, checked: Target[], items: Item[]) => {
      const stored = await admin.rpc("store_data_lake_results", { p_tenant_id: tenant.id, p_search_urn: urn, p_checked: checked.map((t) => t.computer_id), p_results: items });
      if (stored.error) throw new Error(stored.error.message);
      return (stored.data as number) ?? 0;
    };
    // Over the row limit, search each half, down to one host. `patches` picks the patchstate search (and its domain).
    const fill = async (batch: Target[], patches: boolean): Promise<void> => {
      let result: { urn: string; rows: DataLakeRow[] };
      const ql = patches ? patchStateQl : softwareInfoQl;
      try {
        result = await client.search(ql(batch.map((t) => t.sophos_endpoint_id), searchWindow(now)), Date.now() + timeLeft() - SEARCH_MARGIN_MS);
      } catch (error) {
        if (!(error instanceof DataLakeOverLimitError)) throw error;
        if (batch.length === 1) {
          logs.add("warn", `Data Lake: endpoint ${batch[0].sophos_endpoint_id} of ${tenant.name} is over the 10,000-row limit; it is skipped until its next turn`, null, tenant.id);
          await store(null, batch, []);
          return;
        }
        const half = Math.ceil(batch.length / 2);
        await fill(batch.slice(0, half), patches);
        await fill(batch.slice(half), patches);
        return;
      }
      const snapshots = latestSnapshots(result.rows);
      const items: Item[] = [];
      for (const t of batch) {
        const host = snapshots.get(t.sophos_endpoint_id);
        if (!host?.length) continue;
        // A host that reported: an empty domain is real (e.g. Chrome removed), so it gets an item too.
        for (const domain of t.domains.filter((d) => (d === "patches") === patches)) {
          const mapped = domain === "patches" ? toPatchRows(host) : domain === "programs" ? toProgramRows(host) : domain === "extensions" ? toExtensionRows(host) : [];
          items.push({ computer_id: t.computer_id, domain, collected_at: snapshotTime(host), rows: mapped });
        }
      }
      out.rawResults += await store(result.urn, batch, items);
      out.searches++;
    };

    while (timeLeft() > MIN_LEFT_MS) {
      const { data, error } = await admin.rpc("data_lake_targets", { p_tenant_id: tenant.id, p_limit: HOSTS_PER_SEARCH });
      if (error) throw new Error(error.message);
      const targets = (data ?? []) as Target[];
      if (targets.length === 0) break;

      // The ids go into the query text: a computer with another id is only stamped.
      const bad = targets.filter((t) => !UUID.test(t.sophos_endpoint_id));
      if (bad.length) {
        logs.add("warn", `Data Lake: ${bad.length} computer(s) of ${tenant.name} have an endpoint id that is not a UUID; they are skipped`, null, tenant.id);
        await store(null, bad, []);
      }
      const good = targets.filter((t) => UUID.test(t.sophos_endpoint_id));
      const inventory = good.map((t) => ({ ...t, domains: t.domains.filter((d) => d !== "patches") })).filter((t) => t.domains.length > 0);
      if (inventory.length) await fill(inventory, false);
      const wantPatches = good.map((t) => ({ ...t, domains: t.domains.filter((d) => d === "patches") })).filter((t) => t.domains.length > 0);
      for (let i = 0; i < wantPatches.length; i += HOSTS_PER_PATCH_SEARCH) await fill(wantPatches.slice(i, i + HOSTS_PER_PATCH_SEARCH), true);
    }
  } catch (error) {
    logs.add("warn", `Data Lake search failed for ${tenant.name}: ${error instanceof Error ? error.message : String(error)}`, null, tenant.id);
  }
  return out;
}
