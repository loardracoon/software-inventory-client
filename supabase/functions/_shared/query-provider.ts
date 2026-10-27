// Runs osquery on endpoints through Sophos Central. One interface, two implementations:
// - LiveEndpointSearchProvider (default): the Live Endpoint Search GraphQL API, written against the
//   published schema live-endpoint-search-v1.graphql. Its URL is not published; set SOPHOS_LES_URL
//   (docs/spec.md › Riscos e pontos a validar).
// - LiveDiscoverRestProvider (fallback): the legacy Live Discover REST API, per the reference at
//   developer.sophos.com/reference/live-discover-v1/ (POST/GET /queries/runs, GET /runs/{id}/endpoints
//   paged by page number, GET /runs/{id}/results paged by key). It has no cancel operation: a run
//   ends on its own after maxDurationInSeconds (600 s).
// Runtime-neutral (Deno and Node).

import { SophosApiError, type SophosClient, type SophosTenant } from "./sophos.ts";

export type ProviderName = "live_endpoint_search" | "live_discover_rest";
export type ExecutionStatus = "pending" | "started" | "finished";
export type ExecutionResult = "notAvailable" | "succeeded" | "failed" | "timedOut";

export type RunState = { status: ExecutionStatus; result: ExecutionResult; resultCount: number | null };
export type EndpointRunState = RunState & { endpointId: string; statusMessage: string | null };
export type ResultRow = { endpointId: string | null; columns: Record<string, unknown> };
export type ResultPage = { rows: ResultRow[]; nextKey: string | null };
export type AdHocQuery = { name: string; sql: string };

export interface SophosQueryProvider {
  readonly name: ProviderName;
  startRun(endpointIds: string[], query: AdHocQuery): Promise<string>;
  getRun(runId: string): Promise<RunState>;
  getEndpointStatuses(runId: string): Promise<EndpointRunState[]>;
  getResults(runId: string, cursor?: string | null): Promise<ResultPage>;
  // false when the API cannot cancel (REST): the run then ends at its maximum duration.
  cancel(runId: string): Promise<boolean>;
  // Which of these endpoints are online now; null when the API cannot tell (REST).
  onlineEndpoints(endpointIds: string[]): Promise<Set<string> | null>;
}

const RESULT_PAGE_SIZE = 1000;
// Offset paging must keep one page size; 50 is the documented default for every Sophos API.
const ENDPOINT_PAGE_SIZE = 50;
const MAX_PAGES = 10_000;

const STATUSES: ExecutionStatus[] = ["pending", "started", "finished"];
const RESULTS: ExecutionResult[] = ["notAvailable", "succeeded", "failed", "timedOut"];

function asStatus(value: unknown): ExecutionStatus {
  return STATUSES.includes(value as ExecutionStatus) ? (value as ExecutionStatus) : "pending";
}

function asResult(value: unknown): ExecutionResult {
  return RESULTS.includes(value as ExecutionResult) ? (value as ExecutionResult) : "notAvailable";
}

function asCount(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

// additionalColumns is a JSON scalar; the guide describes it as a JSON-encoded string.
export function parseColumns(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export class LiveEndpointSearchError extends Error {
  constructor(readonly messages: string[]) {
    super(`Live Endpoint Search error: ${messages.join("; ")}`);
    this.name = "LiveEndpointSearchError";
  }
}

export class LiveEndpointSearchProvider implements SophosQueryProvider {
  readonly name = "live_endpoint_search" as const;

  constructor(
    private readonly client: SophosClient,
    private readonly tenant: SophosTenant,
    private readonly url: string,
  ) {}

  private async gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const body = (await this.client.requestJson("POST", this.url, { "X-Tenant-ID": this.tenant.id }, { query, variables })) as {
      data?: T;
      errors?: { message?: string }[];
    } | null;
    if (body?.errors?.length) throw new LiveEndpointSearchError(body.errors.map((e) => e.message ?? "unknown error"));
    if (!body?.data) throw new LiveEndpointSearchError(["empty response"]);
    return body.data;
  }

  // Documented flow: create a session, add the endpoints to it, run with matchEndpoints { all: false }.
  async startRun(endpointIds: string[], query: AdHocQuery): Promise<string> {
    const created = await this.gql<{ createLiveDiscoverSession: { session: { name: string } | null } }>(
      "mutation CreateSession { createLiveDiscoverSession { session { name } } }",
      {},
    );
    const sessionId = created.createLiveDiscoverSession.session?.name;
    if (!sessionId) throw new LiveEndpointSearchError(["no session was created"]);

    await this.gql(
      "mutation AddEndpoints($input: EndpointSessionsInput!) { endpointSessions(input: $input) { requestedAt completedAt } }",
      { input: { sessions: [sessionId], action: "add", filter: { ids: endpointIds } } },
    );

    const run = await this.gql<{ runLiveDiscoverQuery: { executionSummary: { id: string } | null } }>(
      "mutation Run($input: LiveDiscoverExecutionRequest!) { runLiveDiscoverQuery(input: $input) { executionSummary { id status } } }",
      { input: { adHocQuery: { name: query.name, template: query.sql }, sessionId, matchEndpoints: { all: false } } },
    );
    const runId = run.runLiveDiscoverQuery.executionSummary?.id;
    if (!runId) throw new LiveEndpointSearchError(["no run was started"]);
    return runId;
  }

  async getRun(runId: string): Promise<RunState> {
    const data = await this.gql<{ liveDiscoverQueryRun: { executionSummary: Record<string, unknown> | null } }>(
      "query Run($runId: ID!) { liveDiscoverQueryRun(runId: $runId) { executionSummary { id status result resultCount } } }",
      { runId },
    );
    const summary = data.liveDiscoverQueryRun.executionSummary ?? {};
    return { status: asStatus(summary.status), result: asResult(summary.result), resultCount: asCount(summary.resultCount) };
  }

  async getEndpointStatuses(runId: string): Promise<EndpointRunState[]> {
    const states: EndpointRunState[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await this.gql<{
        liveDiscoverQueryRunEndpoints: { items: Record<string, unknown>[]; pages: { current: number; size: number; total?: number | null } };
      }>(
        "query Endpoints($runId: ID!, $params: LiveDiscoverEndpointParams) { liveDiscoverQueryRunEndpoints(runId: $runId, params: $params) { items { id status result resultCount statusMessage } pages { current size total } } }",
        { runId, params: { pageSize: ENDPOINT_PAGE_SIZE, page, pageTotal: true } },
      );
      const { items, pages } = data.liveDiscoverQueryRunEndpoints;
      for (const item of items) {
        states.push({
          endpointId: String(item.id),
          status: asStatus(item.status),
          result: asResult(item.result),
          resultCount: asCount(item.resultCount),
          statusMessage: typeof item.statusMessage === "string" ? item.statusMessage : null,
        });
      }
      const total = pages.total ?? page;
      if (page >= total || items.length === 0) return states;
    }
    return states;
  }

  async getResults(runId: string, cursor?: string | null): Promise<ResultPage> {
    const data = await this.gql<{
      liveDiscoverQueryRunResults: { items: { endpointId: string; additionalColumns: unknown }[]; pages: { nextKey?: string | null } };
    }>(
      "query Results($runId: ID!, $params: LiveDiscoverQueryRunResultsParams) { liveDiscoverQueryRunResults(runId: $runId, params: $params) { items { endpointId hostname additionalColumns } pages { fromKey nextKey size maxSize } } }",
      { runId, params: { pageSize: RESULT_PAGE_SIZE, ...(cursor ? { pageFromKey: cursor } : {}) } },
    );
    const { items, pages } = data.liveDiscoverQueryRunResults;
    return {
      rows: items.map((item) => ({ endpointId: item.endpointId ?? null, columns: parseColumns(item.additionalColumns) })),
      nextKey: pages.nextKey || null,
    };
  }

  async cancel(runId: string): Promise<boolean> {
    await this.gql("mutation Cancel($runId: ID!) { cancelLiveDiscoverQueryRun(runId: $runId) { executionSummary { id status } } }", {
      runId,
    });
    return true;
  }

  // liveDiscoverEndpointSearch reports `online` (lab, Oct 27, 2026: true only for the endpoint that was
  // answering), unlike the Endpoint API, whose `online` field is disabled in production.
  async onlineEndpoints(endpointIds: string[]): Promise<Set<string>> {
    const online = new Set<string>();
    for (let i = 0; i < endpointIds.length; i += ONLINE_BATCH) {
      let pageFromKey: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const data: { liveDiscoverEndpointSearch: { items: { id: string; online?: boolean | null }[]; pages: { nextKey?: string | null } } } =
          await this.gql(
            "query Online($input: EndpointSessionsFilter!) { liveDiscoverEndpointSearch(input: $input) { items { id online } pages { nextKey } } }",
            { input: { ids: endpointIds.slice(i, i + ONLINE_BATCH), pageSize: ONLINE_BATCH, ...(pageFromKey ? { pageFromKey } : {}) } },
          );
        for (const item of data.liveDiscoverEndpointSearch.items) if (item.online === true) online.add(String(item.id));
        pageFromKey = data.liveDiscoverEndpointSearch.pages.nextKey || null;
        if (!pageFromKey) break;
      }
    }
    return online;
  }
}

const ONLINE_BATCH = 100;

export class LiveDiscoverRestProvider implements SophosQueryProvider {
  readonly name = "live_discover_rest" as const;
  private readonly base: string;

  constructor(
    private readonly client: SophosClient,
    private readonly tenant: SophosTenant,
  ) {
    this.base = `${tenant.apiHost.replace(/\/+$/, "")}/live-discover/v1/queries/runs`;
  }

  private request(method: "GET" | "POST", path: string, body?: unknown) {
    return this.client.requestJson(method, `${this.base}${path}`, { "X-Tenant-ID": this.tenant.id }, body) as Promise<
      Record<string, unknown> | null
    >;
  }

  async startRun(endpointIds: string[], query: AdHocQuery): Promise<string> {
    let run: Record<string, unknown> | null;
    try {
      run = await this.request("POST", "", {
        adHocQuery: { name: query.name, template: query.sql },
        matchEndpoints: { filters: [{ ids: endpointIds }] },
      });
    } catch (error) {
      // Documented 404 for POST /queries/runs: "No resolved endpoints found".
      if (error instanceof SophosApiError && error.status === 404) {
        throw new Error("Sophos Central resolved none of the requested endpoints (deleted, or not in this tenant).");
      }
      throw error;
    }
    if (!run?.id) throw new Error("Live Discover returned no run ID");
    return String(run.id);
  }

  async getRun(runId: string): Promise<RunState> {
    const run = (await this.request("GET", `/${encodeURIComponent(runId)}`)) ?? {};
    return { status: asStatus(run.status), result: asResult(run.result), resultCount: asCount(run.resultCount) };
  }

  // Paged by page number (page, pageSize, pageTotal), not by key.
  async getEndpointStatuses(runId: string): Promise<EndpointRunState[]> {
    const states: EndpointRunState[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const query = new URLSearchParams({ pageSize: String(ENDPOINT_PAGE_SIZE), page: String(page), pageTotal: "true" });
      const data = (await this.request("GET", `/${encodeURIComponent(runId)}/endpoints?${query}`)) as {
        items?: Record<string, unknown>[];
        pages?: { current?: number; total?: number };
      } | null;
      const items = data?.items ?? [];
      for (const item of items) {
        states.push({
          endpointId: String(item.id),
          status: asStatus(item.status),
          result: asResult(item.result),
          resultCount: asCount(item.resultCount),
          statusMessage: typeof item.statusMessage === "string" ? item.statusMessage : null,
        });
      }
      const total = data?.pages?.total ?? page;
      if (page >= total || items.length === 0) return states;
    }
    return states;
  }

  // Each row carries endpointId and hostname next to the query's columns; metadata.columns names the
  // query's own columns (a query may select its own "hostname").
  async getResults(runId: string, cursor?: string | null): Promise<ResultPage> {
    const query = new URLSearchParams({ pageSize: String(RESULT_PAGE_SIZE) });
    if (cursor) query.set("pageFromKey", cursor);
    const data = (await this.request("GET", `/${encodeURIComponent(runId)}/results?${query}`)) as {
      items?: Record<string, unknown>[];
      pages?: { nextKey?: string };
      metadata?: { columns?: { name: string }[] };
    } | null;
    const names = (data?.metadata?.columns ?? []).map((c) => c.name).filter(Boolean);
    return {
      rows: (data?.items ?? []).map((item) => {
        const { endpointId, hostname: _hostname, ...rest } = item;
        const columns = names.length > 0 ? Object.fromEntries(names.map((n) => [n, item[n] ?? null])) : rest;
        return { endpointId: typeof endpointId === "string" ? endpointId : null, columns };
      }),
      nextKey: data?.pages?.nextKey || null,
    };
  }

  // The REST API cannot tell whether an endpoint is online (the Endpoint API's field is disabled).
  onlineEndpoints(_endpointIds: string[]): Promise<null> {
    return Promise.resolve(null);
  }

  // The REST API has no cancel operation.
  cancel(_runId: string): Promise<boolean> {
    return Promise.resolve(false);
  }
}

// Live Endpoint Search unless the tenant chose REST, or LES has no URL configured yet.
export function createQueryProvider(
  client: SophosClient,
  tenant: SophosTenant,
  preferred: ProviderName,
  lesUrl: string | undefined,
): { provider: SophosQueryProvider; fellBack: boolean } {
  if (preferred === "live_endpoint_search" && lesUrl) {
    return { provider: new LiveEndpointSearchProvider(client, tenant, lesUrl), fellBack: false };
  }
  return { provider: new LiveDiscoverRestProvider(client, tenant), fellBack: preferred === "live_endpoint_search" };
}

// Reads every result page of a run.
export async function readAllResults(provider: SophosQueryProvider, runId: string): Promise<ResultRow[]> {
  const rows: ResultRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result: ResultPage = await provider.getResults(runId, cursor);
    rows.push(...result.rows);
    cursor = result.nextKey;
    if (!cursor) return rows;
  }
  throw new Error(`Results of run ${runId} exceeded ${MAX_PAGES} pages`);
}
