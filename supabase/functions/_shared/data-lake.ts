// Sophos Data Lake (Fusion GraphQL search API): reads the `softwareinfo` inventory that Sophos XDR
// writes for each endpoint, as a gap-fill for endpoints Live Discover cannot reach. Runtime-neutral.

import type { RawRow } from "./normalize.ts";
import type { SophosClient } from "./sophos.ts";

export const FUSION_GRAPHQL_URL = "https://api.taegis.sophos.com/graphql";
// One inventory snapshot is written over a few minutes; rows this close to the newest belong to it.
export const SNAPSHOT_SPREAD_MS = 600_000;
export const HOSTS_PER_SEARCH = 20;
export const MAX_SEARCH_ROWS = 10_000;

const PAGE_SIZE = 1000;
const POLL_MS = 2000;
const HOUR_MS = 3_600_000;
const SETTLE_MS = 900_000;
const FAILED_STATUSES = new Set(["FAILED", "CANCELLED", "CANCELED", "ERROR", "EXPIRED"]);
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DataLakeRow = Record<string, unknown>;
export type SearchWindow = { earliest: string; latest: string };

export class DataLakeError extends Error {
  constructor(message: string) {
    super(`Data Lake: ${message}`);
    this.name = "DataLakeError";
  }
}

// The search found more rows than one search returns; a smaller batch may fit.
export class DataLakeOverLimitError extends DataLakeError {
  constructor() {
    super("over the 10,000-row limit");
    this.name = "DataLakeOverLimitError";
  }
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

// Whole hours, so a retry sends the same text and getOrCreateSearch reuses the search. It ends at least
// 15 minutes ago, so it does not catch a snapshot the Data Lake is still writing.
export function searchWindow(now: number): SearchWindow {
  const latest = Math.floor((now - SETTLE_MS) / HOUR_MS) * HOUR_MS;
  return { earliest: iso(latest - 26 * HOUR_MS), latest: iso(latest) };
}

export function softwareInfoQl(endpointIds: string[], w: SearchWindow): string {
  if (endpointIds.length === 0 || endpointIds.length > HOSTS_PER_SEARCH) {
    throw new DataLakeError(`need 1 to ${HOSTS_PER_SEARCH} endpoint ids, got ${endpointIds.length}`);
  }
  // The ids go into the query text: only UUIDs may pass.
  for (const id of endpointIds) if (!UUID.test(id)) throw new DataLakeError("endpoint id is not a UUID");
  const hosts = endpointIds.map((id) => `'${id}'`).join(", ");
  return (
    `from softwareinfo where normalizer = 'sophos-xdr-it-hygiene-ingestor' and host_id in (${hosts}) ` +
    `earliest='${w.earliest}' latest='${w.latest}' | fields host_id, time, product.name, product.version, ` +
    `product.vendor_name, product.uid, product.type_id, product.path, product.source, product.url_string, original_data`
  );
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function snapshotTime(rows: DataLakeRow[]): string {
  return new Date(Math.max(...rows.map((r) => r.time as number))).toISOString();
}

export function latestSnapshots(rows: DataLakeRow[]): Map<string, DataLakeRow[]> {
  const byHost = new Map<string, DataLakeRow[]>();
  for (const row of rows) {
    if (typeof row.host_id !== "string" || !isNum(row.time)) continue;
    const list = byHost.get(row.host_id) ?? [];
    list.push(row);
    byHost.set(row.host_id, list);
  }
  for (const [host, list] of byHost) {
    const cutoff = Math.max(...list.map((r) => r.time as number)) - SNAPSHOT_SPREAD_MS;
    byHost.set(host, list.filter((r) => (r.time as number) >= cutoff));
  }
  return byHost;
}

const product = (row: DataLakeRow) => (row.product && typeof row.product === "object" ? (row.product as Record<string, unknown>) : {});

function original(row: DataLakeRow): Record<string, unknown> {
  try {
    const parsed = typeof row.original_data === "string" ? JSON.parse(row.original_data) : row.original_data;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);

export function toProgramRows(rows: DataLakeRow[]): RawRow[] {
  const out: RawRow[] = [];
  for (const row of rows) {
    const p = product(row);
    if (p.type_id !== "TYPE_ID_APPLICATION") continue;
    const o = original(row);
    const name = str(p.name) ?? str(o.name);
    if (!name) continue; // LES drops nameless programs too
    out.push({
      name,
      version: p.version ?? null,
      publisher: p.vendor_name ?? null,
      install_location: null,
      install_date: o.installDate ?? null,
      identifying_number: p.uid ?? null,
    });
  }
  return out;
}

export function toExtensionRows(rows: DataLakeRow[]): RawRow[] {
  const out: RawRow[] = [];
  for (const row of rows) {
    const p = product(row);
    if (p.type_id !== "TYPE_ID_BROWSER_EXTENSION") continue;
    out.push({
      identifier: p.uid ?? null,
      name: p.name ?? null,
      version: p.version ?? null,
      path: p.path ?? null,
      username: original(row).username ?? null,
      browser_type: typeof p.source === "string" ? p.source.toLowerCase() : null,
      update_url: p.url_string ?? null,
    });
  }
  return out;
}

type SearchState = {
  urn: string;
  status: string;
  outcome?: { success?: unknown; errors?: unknown } | null;
  overThreshold?: boolean | null;
  errors?: unknown;
};

const STATE_FIELDS = "urn status outcome { success errors { urn errors } } overThreshold errors";

export class DataLakeClient {
  constructor(
    private readonly client: SophosClient,
    private readonly tenantId: string,
    private readonly url: string = FUSION_GRAPHQL_URL,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  private async gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const body = (await this.client.requestJson("POST", this.url, { "X-Tenant-ID": this.tenantId }, { query, variables })) as {
      data?: T;
      errors?: { message?: string }[];
    } | null;
    if (body?.errors?.length) throw new DataLakeError(body.errors.map((e) => e.message ?? "unknown error").join("; "));
    if (!body?.data) throw new DataLakeError("empty response");
    return body.data;
  }

  async search(ql: string, deadline: number): Promise<{ urn: string; rows: DataLakeRow[] }> {
    const created = await this.gql<{ getOrCreateSearch: SearchState }>(
      `mutation Create($input: CreateSearchInput) { getOrCreateSearch(input: $input) { ${STATE_FIELDS} } }`,
      { input: { text: ql } },
    );
    let state = created.getOrCreateSearch;
    const { urn } = state;
    while (state.status !== "COMPLETE") {
      if (FAILED_STATUSES.has(state.status)) throw new DataLakeError(`search ${state.status}`);
      if (Date.now() >= deadline) throw new DataLakeError("timed out");
      await this.sleep(POLL_MS);
      state = (await this.gql<{ search: SearchState }>(`query Poll($urn: URN!) { search(urn: $urn) { ${STATE_FIELDS} } }`, { urn })).search;
    }
    if (state.outcome?.success !== "ALL") {
      throw new DataLakeError(`search outcome ${JSON.stringify(state.outcome?.success ?? null)} is not ALL`);
    }

    const rows: DataLakeRow[] = [];
    let total: number | null = null;
    let cursor: string | null = null;
    do {
      const data: { searchResults: { values: unknown; nextCursor?: string | null; totals?: { total?: { value?: number } } } } = await this.gql(
        "query Results($urn: URN!, $cursor: String, $limit: Int) { searchResults(urn: $urn, cursor: $cursor, limit: $limit) { values nextCursor totals { total { value } } } }",
        { urn, cursor, limit: PAGE_SIZE },
      );
      const page = data.searchResults;
      let values = page.values;
      if (typeof values === "string") {
        try {
          values = JSON.parse(values);
        } catch {
          throw new DataLakeError("results are not valid JSON");
        }
      }
      if (Array.isArray(values)) rows.push(...(values as DataLakeRow[]));
      total = page.totals?.total?.value ?? total;
      cursor = page.nextCursor || null;
      if (rows.length >= MAX_SEARCH_ROWS) throw new DataLakeOverLimitError();
    } while (cursor);

    if (state.overThreshold || (total !== null && rows.length < total)) throw new DataLakeOverLimitError();
    return { urn, rows };
  }
}
