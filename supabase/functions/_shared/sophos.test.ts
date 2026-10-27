import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearTokenCache, SophosApiError, SophosAuthError, SophosClient, type ApiCallLog, type WhoAmI } from "./sophos.ts";

const SECRET = "client-secret-value-0123456789";
const TOKEN = "jwt-token-abc";

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fakeFetch(routes: Record<string, Handler>) {
  return vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const handler = routes[`${init.method ?? "GET"} ${url.host}${url.pathname}`];
    if (!handler) throw new Error(`No route for ${init.method} ${input}`);
    return handler(url, init);
  });
}

const tokenRoute: Handler = (_url, init) => {
  const body = new URLSearchParams(String(init.body));
  if (body.get("client_secret") !== SECRET) return json({ errorCode: "client.invalid" }, 401);
  expect(body.get("grant_type")).toBe("client_credentials");
  expect(body.get("scope")).toBe("token");
  return json({ access_token: TOKEN, expires_in: 3600, errorCode: "success" });
};

function client(routes: Record<string, Handler>, extra: Partial<ConstructorParameters<typeof SophosClient>[0]> = {}) {
  const fetchFn = fakeFetch({ "POST id.sophos.com/api/v2/oauth2/token": tokenRoute, ...routes });
  const logs: ApiCallLog[] = [];
  const sophos = new SophosClient({
    clientId: "client-id",
    clientSecret: SECRET,
    fetch: fetchFn,
    sleep: async () => {},
    onCall: (log) => logs.push(log),
    ...extra,
  });
  return { sophos, fetchFn, logs };
}

const tenantWho: WhoAmI = {
  id: "t-1",
  idType: "tenant",
  apiHosts: { global: "https://api.central.sophos.com", dataRegion: "https://api-eu01.central.sophos.com" },
};

beforeEach(() => clearTokenCache());

describe("SophosClient", () => {
  it("caches the token until 60 s before expiry", async () => {
    let now = 0;
    const { sophos, fetchFn } = client(
      { "GET api.central.sophos.com/whoami/v1": () => json(tenantWho) },
      { now: () => now },
    );
    await sophos.whoami();
    await sophos.whoami();
    const tokenCalls = () => fetchFn.mock.calls.filter(([u]) => String(u).includes("oauth2")).length;
    expect(tokenCalls()).toBe(1);
    now = 3600_000 - 59_000;
    await sophos.whoami();
    expect(tokenCalls()).toBe(2);
  });

  it("sends the bearer token and reports a rejected credential without secrets", async () => {
    const { sophos } = client({
      "GET api.central.sophos.com/whoami/v1": (_u, init) => {
        expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
        return json(tenantWho);
      },
    });
    expect((await sophos.whoami()).idType).toBe("tenant");

    clearTokenCache();
    const bad = new SophosClient({ clientId: "client-id", clientSecret: "wrong-secret-0123456789", fetch: fakeFetch({ "POST id.sophos.com/api/v2/oauth2/token": tokenRoute }), sleep: async () => {} });
    const error = await bad.getToken().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SophosAuthError);
    expect(String((error as Error).message)).toContain("HTTP 401");
    expect(String((error as Error).message)).not.toContain("wrong-secret");
  });

  it("lists a tenant credential as one tenant", async () => {
    const { sophos } = client({});
    expect(await sophos.listTenants(tenantWho)).toEqual([
      { id: "t-1", name: "Sophos Central tenant", apiHost: "https://api-eu01.central.sophos.com" },
    ]);
  });

  it("pages partner tenants with pageTotal only on the first request", async () => {
    const seen: string[] = [];
    const { sophos } = client({
      "GET api.central.sophos.com/partner/v1/tenants": (url, init) => {
        expect((init.headers as Record<string, string>)["X-Partner-ID"]).toBe("p-1");
        seen.push(url.search);
        const page = Number(url.searchParams.get("page") ?? 1);
        return json({
          pages: { current: page, total: 3 },
          items: [{ id: `t-${page}`, name: `Tenant ${page}`, showAs: page === 2 ? "Shown 2" : undefined, apiHost: "https://api-us01.central.sophos.com" }],
        });
      },
    });
    const tenants = await sophos.listTenants({ id: "p-1", idType: "partner", apiHosts: { global: "https://api.central.sophos.com" } });
    expect(seen).toEqual(["?pageTotal=true", "?page=2", "?page=3"]);
    expect(tenants.map((t) => t.name)).toEqual(["Tenant 1", "Shown 2", "Tenant 3"]);
  });

  it("uses X-Organization-ID for organization credentials", async () => {
    const { sophos } = client({
      "GET api.central.sophos.com/organization/v1/tenants": (_u, init) => {
        expect((init.headers as Record<string, string>)["X-Organization-ID"]).toBe("o-1");
        return json({ pages: { total: 1 }, items: [{ id: "t-9", name: "Org tenant", apiHost: "https://api-us02.central.sophos.com" }] });
      },
    });
    const tenants = await sophos.listTenants({ id: "o-1", idType: "organization", apiHosts: { global: "x" } });
    expect(tenants).toHaveLength(1);
  });

  it("follows nextKey and switches to maxSize for endpoints", async () => {
    const seen: string[] = [];
    const { sophos } = client({
      "GET api-eu01.central.sophos.com/endpoint/v1/endpoints": (url, init) => {
        expect((init.headers as Record<string, string>)["X-Tenant-ID"]).toBe("t-1");
        seen.push(url.search);
        const key = url.searchParams.get("pageFromKey");
        if (!key) return json({ items: [{ id: "e1" }], pages: { nextKey: "k2", maxSize: 500 } });
        if (key === "k2") return json({ items: [{ id: "e2" }], pages: { nextKey: "k3", maxSize: 500 } });
        return json({ items: [{ id: "e3" }], pages: { maxSize: 500 } });
      },
    });
    const endpoints = await sophos.listEndpoints({ id: "t-1", name: "T", apiHost: "https://api-eu01.central.sophos.com/" });
    expect(endpoints.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    expect(seen).toEqual(["", "?pageFromKey=k2&pageSize=500", "?pageFromKey=k3&pageSize=500"]);
  });

  it("refreshes the token once on 401 and raises API errors", async () => {
    let first = true;
    const { sophos, fetchFn } = client({
      "GET api.central.sophos.com/whoami/v1": () => {
        if (first) {
          first = false;
          return json({}, 401);
        }
        return json(tenantWho);
      },
      "GET api-eu01.central.sophos.com/endpoint/v1/endpoints": () => json({ error: "forbidden" }, 403),
    });
    expect((await sophos.whoami()).id).toBe("t-1");
    expect(fetchFn.mock.calls.filter(([u]) => String(u).includes("oauth2"))).toHaveLength(2);
    await expect(sophos.listEndpoints({ id: "t-1", name: "T", apiHost: "https://api-eu01.central.sophos.com" })).rejects.toBeInstanceOf(
      SophosApiError,
    );
  });

  it("logs calls without tokens or secrets", async () => {
    const { sophos, logs } = client({ "GET api.central.sophos.com/whoami/v1": () => json(tenantWho) });
    await sophos.whoami();
    expect(logs.map((l) => `${l.method} ${l.host}${l.path} ${l.status}`)).toEqual([
      "POST id.sophos.com/api/v2/oauth2/token 200",
      "GET api.central.sophos.com/whoami/v1 200",
    ]);
    const text = JSON.stringify(logs);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(SECRET);
  });
});
