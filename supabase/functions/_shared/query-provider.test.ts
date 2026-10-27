import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearTokenCache, SophosClient, type SophosTenant } from "./sophos.ts";
import {
  createQueryProvider,
  LiveDiscoverRestProvider,
  LiveEndpointSearchError,
  LiveEndpointSearchProvider,
  parseColumns,
  readAllResults,
} from "./query-provider.ts";

const tenant: SophosTenant = { id: "t-1", name: "Lab", apiHost: "https://api-eu01.central.sophos.com" };
const LES_URL = "https://les.example.test/graphql";

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };

function setup(respond: (call: Call) => unknown) {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (input: string, init: RequestInit = {}) => {
    if (input.includes("oauth2")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
    const call = {
      method: init.method ?? "GET",
      url: input,
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const body = respond(call);
    return new Response(body === undefined ? null : JSON.stringify(body), { status: body === undefined ? 204 : 200 });
  });
  const client = new SophosClient({ clientId: "id", clientSecret: "secret-0123456789", fetch: fetchFn, sleep: async () => {} });
  return { client, calls };
}

beforeEach(() => clearTokenCache());

describe("LiveEndpointSearchProvider", () => {
  it("creates a session, adds the endpoints and runs with matchEndpoints { all: false }", async () => {
    const { client, calls } = setup(({ body }) => {
      const query = (body as { query: string }).query;
      if (query.includes("createLiveDiscoverSession")) return { data: { createLiveDiscoverSession: { session: { name: "s-1" } } } };
      if (query.includes("endpointSessions")) return { data: { endpointSessions: { requestedAt: "x", completedAt: "y" } } };
      return { data: { runLiveDiscoverQuery: { executionSummary: { id: "run-1", status: "started" } } } };
    });
    const provider = new LiveEndpointSearchProvider(client, tenant, LES_URL);
    expect(await provider.startRun(["e1"], { name: "probe", sql: "SELECT 1" })).toBe("run-1");

    expect(calls.every((c) => c.method === "POST" && c.url === LES_URL && c.headers["X-Tenant-ID"] === "t-1")).toBe(true);
    expect((calls[1].body as { variables: unknown }).variables).toEqual({
      input: { sessions: ["s-1"], action: "add", filter: { ids: ["e1"] } },
    });
    expect((calls[2].body as { variables: unknown }).variables).toEqual({
      input: { adHocQuery: { name: "probe", template: "SELECT 1" }, sessionId: "s-1", matchEndpoints: { all: false } },
    });
  });

  it("reads run state, endpoint pages and result pages", async () => {
    const { client } = setup(({ body }) => {
      const { query, variables } = body as { query: string; variables: { params?: { page?: number; pageFromKey?: string } } };
      if (query.includes("liveDiscoverQueryRunEndpoints")) {
        const page = variables.params?.page ?? 1;
        return {
          data: {
            liveDiscoverQueryRunEndpoints: {
              items: [{ id: `e${page}`, status: "finished", result: page === 1 ? "succeeded" : "failed", resultCount: "2", statusMessage: page === 2 ? "no such table" : null }],
              pages: { current: page, size: 1, total: 2 },
            },
          },
        };
      }
      if (query.includes("liveDiscoverQueryRunResults")) {
        const second = variables.params?.pageFromKey === "k2";
        return {
          data: {
            liveDiscoverQueryRunResults: {
              items: [{ endpointId: "e1", additionalColumns: second ? { name: "users" } : JSON.stringify({ name: "programs" }) }],
              pages: { nextKey: second ? null : "k2" },
            },
          },
        };
      }
      return { data: { liveDiscoverQueryRun: { executionSummary: { id: "run-1", status: "finished", result: "succeeded", resultCount: 4 } } } };
    });
    const provider = new LiveEndpointSearchProvider(client, tenant, LES_URL);
    expect(await provider.getRun("run-1")).toEqual({ status: "finished", result: "succeeded", resultCount: 4 });
    const endpoints = await provider.getEndpointStatuses("run-1");
    expect(endpoints.map((e) => [e.endpointId, e.result, e.resultCount, e.statusMessage])).toEqual([
      ["e1", "succeeded", 2, null],
      ["e2", "failed", 2, "no such table"],
    ]);
    const rows = await readAllResults(provider, "run-1");
    expect(rows.map((r) => r.columns.name)).toEqual(["programs", "users"]);
  });

  it("raises GraphQL errors", async () => {
    const { client } = setup(() => ({ errors: [{ message: "Not authorized" }] }));
    const provider = new LiveEndpointSearchProvider(client, tenant, LES_URL);
    await expect(provider.getRun("run-1")).rejects.toBeInstanceOf(LiveEndpointSearchError);
  });
});

describe("LiveDiscoverRestProvider", () => {
  it("creates a run on the tenant's data region with an ids filter", async () => {
    const { client, calls } = setup(({ method }) => {
      if (method === "POST") return { id: "run-9", status: "started", result: "notAvailable" };
      return { id: "run-9", status: "finished", result: "succeeded", resultCount: 3 };
    });
    const provider = new LiveDiscoverRestProvider(client, tenant);
    expect(await provider.startRun(["e1"], { name: "probe", sql: "SELECT name FROM osquery_registry" })).toBe("run-9");
    expect(calls[0].url).toBe("https://api-eu01.central.sophos.com/live-discover/v1/queries/runs");
    expect(calls[0].headers["X-Tenant-ID"]).toBe("t-1");
    expect(calls[0].body).toEqual({
      adHocQuery: { name: "probe", template: "SELECT name FROM osquery_registry" },
      matchEndpoints: { filters: [{ ids: ["e1"] }] },
    });
    expect(await provider.getRun("run-9")).toEqual({ status: "finished", result: "succeeded", resultCount: 3 });
  });

  it("explains the documented 404 when no endpoint resolves", async () => {
    const fetchFn = vi.fn(async (input: string) =>
      input.includes("oauth2")
        ? new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }))
        : new Response(JSON.stringify({ error: "notFound" }), { status: 404 }),
    );
    const client = new SophosClient({ clientId: "id", clientSecret: "secret-0123456789", fetch: fetchFn, sleep: async () => {} });
    await expect(new LiveDiscoverRestProvider(client, tenant).startRun(["gone"], { name: "p", sql: "SELECT 1 FROM users" })).rejects.toThrow(
      "resolved none of the requested endpoints",
    );
  });

  it("pages endpoint statuses by page number", async () => {
    const seen: string[] = [];
    const { client } = setup(({ url }) => {
      const params = new URL(url).searchParams;
      seen.push(`${params.get("page")}/${params.get("pageSize")}/${params.get("pageTotal")}`);
      const page = Number(params.get("page"));
      return {
        items: [{ id: `e${page}`, status: "finished", result: page === 2 ? "timedOut" : "succeeded", statusMessage: null }],
        pages: { current: page, size: 1, total: 2, maxSize: 1000 },
      };
    });
    const states = await new LiveDiscoverRestProvider(client, tenant).getEndpointStatuses("run-9");
    expect(states.map((s) => [s.endpointId, s.result])).toEqual([
      ["e1", "succeeded"],
      ["e2", "timedOut"],
    ]);
    expect(seen).toEqual(["1/50/true", "2/50/true"]);
  });

  it("keeps only the query's columns, named by metadata.columns", async () => {
    const { client } = setup(({ url }) => {
      const key = new URL(url).searchParams.get("pageFromKey");
      if (key === "k2") {
        return {
          items: [{ endpointId: "e2", hostname: "PC-2", name: "programs" }],
          pages: { nextKey: "" },
          metadata: { columns: [{ name: "name", type: "text" }] },
        };
      }
      return {
        items: [{ endpointId: "e1", hostname: "PC-1", name: "users" }],
        pages: { nextKey: "k2" },
        metadata: { columns: [{ name: "name", type: "text" }] },
      };
    });
    const rows = await readAllResults(new LiveDiscoverRestProvider(client, tenant), "run-9");
    expect(rows).toEqual([
      { endpointId: "e1", columns: { name: "users" } },
      { endpointId: "e2", columns: { name: "programs" } },
    ]);
  });

  it("keeps a query column called hostname and has no cancel operation", async () => {
    const { client, calls } = setup(() => ({
      items: [{ endpointId: "e1", hostname: "PC-1", hardware_vendor: "Dell" }],
      pages: {},
      metadata: { columns: [{ name: "hostname", type: "text" }, { name: "hardware_vendor", type: "text" }] },
    }));
    const provider = new LiveDiscoverRestProvider(client, tenant);
    expect((await provider.getResults("run-9")).rows[0].columns).toEqual({ hostname: "PC-1", hardware_vendor: "Dell" });
    const before = calls.length;
    expect(await provider.cancel("run-9")).toBe(false);
    expect(calls).toHaveLength(before);
  });
});

describe("createQueryProvider", () => {
  it("uses Live Endpoint Search when it has a URL and falls back to REST otherwise", () => {
    const { client } = setup(() => ({}));
    expect(createQueryProvider(client, tenant, "live_endpoint_search", LES_URL)).toMatchObject({ fellBack: false });
    expect(createQueryProvider(client, tenant, "live_endpoint_search", LES_URL).provider.name).toBe("live_endpoint_search");
    const fallback = createQueryProvider(client, tenant, "live_endpoint_search", undefined);
    expect([fallback.provider.name, fallback.fellBack]).toEqual(["live_discover_rest", true]);
    expect(createQueryProvider(client, tenant, "live_discover_rest", LES_URL)).toMatchObject({ fellBack: false });
  });
});

describe("parseColumns", () => {
  it("accepts JSON strings and objects", () => {
    expect(parseColumns('{"a":1}')).toEqual({ a: 1 });
    expect(parseColumns({ b: 2 })).toEqual({ b: 2 });
    expect(parseColumns("not json")).toEqual({});
    expect(parseColumns([1])).toEqual({});
  });
});
