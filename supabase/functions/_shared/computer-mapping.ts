// Maps Sophos Central endpoints and tenants to rows for apply_computer_sync and public.tenants.
// Runtime-neutral (Deno and Node).

import type { IdType, SophosEndpoint, SophosTenant } from "./sophos.ts";

export type Platform = "windows" | "macos" | "linux";

export type ComputerSyncRow = {
  sophos_endpoint_id: string;
  hostname: string;
  platform: Platform;
  endpoint_type: "computer" | "server" | null;
  os_name: string | null;
  os_version: string | null;
  os_build: string | null;
  associated_user: string | null;
  health: string | null;
  last_seen_at: string | null;
};

export function mapPlatform(value: string | undefined): Platform | null {
  switch (value?.toLowerCase()) {
    case "windows":
      return "windows";
    case "macos":
    case "mac":
    case "osx":
      return "macos";
    case "linux":
      return "linux";
    default:
      return null;
  }
}

// null when the endpoint cannot be stored (no ID or a platform this app does not collect).
export function mapEndpoint(endpoint: SophosEndpoint): ComputerSyncRow | null {
  const platform = mapPlatform(endpoint.os?.platform);
  if (!endpoint.id || !platform) return null;
  const version = [endpoint.os?.majorVersion, endpoint.os?.minorVersion].filter((v) => v !== undefined && v !== null);
  const type = endpoint.type === "computer" || endpoint.type === "server" ? endpoint.type : null;
  return {
    sophos_endpoint_id: endpoint.id,
    hostname: endpoint.hostname?.trim() || endpoint.id,
    platform,
    endpoint_type: type,
    os_name: endpoint.os?.name ?? null,
    os_version: version.length > 0 ? version.join(".") : null,
    os_build: endpoint.os?.build !== undefined && endpoint.os?.build !== null ? String(endpoint.os.build) : null,
    associated_user: endpoint.associatedPerson?.viaLogin || endpoint.associatedPerson?.name || null,
    health: endpoint.health?.overall ?? null,
    last_seen_at: endpoint.lastSeenAt ?? null,
  };
}

export function mapEndpoints(endpoints: SophosEndpoint[]): { rows: ComputerSyncRow[]; skipped: number } {
  const rows: ComputerSyncRow[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const endpoint of endpoints) {
    const row = mapEndpoint(endpoint);
    if (!row || seen.has(row.sophos_endpoint_id)) {
      skipped++;
      continue;
    }
    seen.add(row.sophos_endpoint_id);
    rows.push(row);
  }
  return { rows, skipped };
}

export function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function mapTenant(tenant: SophosTenant, idType: IdType) {
  return {
    sophos_tenant_id: tenant.id,
    name: tenant.name,
    id_type: idType,
    data_region_host: tenant.apiHost,
  };
}
