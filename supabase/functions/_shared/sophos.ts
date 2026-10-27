// Sophos Central API client: OAuth2 token, whoami, tenant listing and the Endpoint API.
// Runtime-neutral (Deno and Node). Tokens never leave this module: call logs carry method, host,
// path, status and timing only.

import { fetchWithRetry, realSleep, type AttemptInfo, type FetchLike, type Sleep } from "./http.ts";

export const SOPHOS_ID_URL = "https://id.sophos.com";
export const SOPHOS_GLOBAL_URL = "https://api.central.sophos.com";

export type IdType = "tenant" | "partner" | "organization";

export type WhoAmI = {
  id: string;
  idType: IdType;
  apiHosts: { global: string; dataRegion?: string };
};

export type SophosTenant = {
  id: string;
  name: string;
  apiHost: string;
};

// Fields this app reads from GET /endpoint/v1/endpoints. Everything is optional on purpose: the
// shape is validated in the lab (docs/spec.md › Riscos e pontos a validar).
export type SophosEndpoint = {
  id?: string;
  type?: string;
  hostname?: string;
  health?: { overall?: string };
  os?: { platform?: string; name?: string; majorVersion?: number | string; minorVersion?: number | string; build?: number | string };
  associatedPerson?: { name?: string; viaLogin?: string };
  lastSeenAt?: string;
};

export type ApiCallLog = {
  method: string;
  host: string;
  path: string;
  status: number | null;
  attempt: number;
  durationMs: number;
  error?: string;
};

export class SophosApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly errorCode?: string,
  ) {
    super(`Sophos Central returned HTTP ${status} for ${path}${errorCode ? ` (${errorCode})` : ""}`);
    this.name = "SophosApiError";
  }
}

export class SophosAuthError extends SophosApiError {
  constructor(status: number, errorCode?: string) {
    super(status, "/api/v2/oauth2/token", errorCode);
    this.name = "SophosAuthError";
    this.message = `Sophos Central rejected the credential (HTTP ${status}${errorCode ? `, ${errorCode}` : ""}). Check the client ID and secret.`;
  }
}

type CachedToken = { token: string; expiresAt: number };

// Per isolate; refreshed 60 s before expiry.
const tokenCache = new Map<string, CachedToken>();
const TOKEN_MARGIN_MS = 60_000;
const MAX_PAGES = 10_000;

export function clearTokenCache() {
  tokenCache.clear();
}

export type SophosClientOptions = {
  clientId: string;
  clientSecret: string;
  fetch?: FetchLike;
  sleep?: Sleep;
  random?: () => number;
  now?: () => number;
  idUrl?: string;
  globalUrl?: string;
  onCall?: (log: ApiCallLog) => void;
};

export class SophosClient {
  private readonly fetchFn: FetchLike;
  private readonly sleep: Sleep;
  private readonly now: () => number;
  private readonly idUrl: string;
  private readonly globalUrl: string;

  constructor(private readonly options: SophosClientOptions) {
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? realSleep;
    this.now = options.now ?? Date.now;
    this.idUrl = trimSlash(options.idUrl ?? SOPHOS_ID_URL);
    this.globalUrl = trimSlash(options.globalUrl ?? SOPHOS_GLOBAL_URL);
  }

  async getToken(): Promise<string> {
    const cached = tokenCache.get(this.options.clientId);
    if (cached && cached.expiresAt - TOKEN_MARGIN_MS > this.now()) return cached.token;

    const url = `${this.idUrl}/api/v2/oauth2/token`;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      scope: "token",
    });
    const response = await this.send("POST", url, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = (await safeJson(response)) as { access_token?: string; expires_in?: number; errorCode?: string };
    if (!response.ok || !data.access_token) throw new SophosAuthError(response.status, data.errorCode);

    const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
    tokenCache.set(this.options.clientId, { token: data.access_token, expiresAt: this.now() + expiresIn * 1000 });
    return data.access_token;
  }

  async whoami(): Promise<WhoAmI> {
    const data = (await this.getJson(`${this.globalUrl}/whoami/v1`, {})) as WhoAmI;
    if (!data.id || !["tenant", "partner", "organization"].includes(data.idType)) {
      throw new Error("Unexpected whoami response from Sophos Central");
    }
    return data;
  }

  async listTenants(who: WhoAmI): Promise<SophosTenant[]> {
    if (who.idType === "tenant") {
      if (!who.apiHosts.dataRegion) throw new Error("whoami returned no data region for this tenant");
      return [{ id: who.id, name: "Sophos Central tenant", apiHost: who.apiHosts.dataRegion }];
    }
    const base = who.idType === "partner" ? `${this.globalUrl}/partner/v1/tenants` : `${this.globalUrl}/organization/v1/tenants`;
    const header = who.idType === "partner" ? "X-Partner-ID" : "X-Organization-ID";
    const tenants: SophosTenant[] = [];
    let total = 1;
    for (let page = 1; page <= total && page <= MAX_PAGES; page++) {
      // pageTotal only on the first request, as the Sophos guide says.
      const url = page === 1 ? `${base}?pageTotal=true` : `${base}?page=${page}`;
      const data = (await this.getJson(url, { [header]: who.id })) as {
        pages?: { total?: number };
        items?: { id: string; name?: string; showAs?: string; apiHost?: string }[];
      };
      if (page === 1) total = data.pages?.total ?? 1;
      for (const item of data.items ?? []) {
        if (!item.id || !item.apiHost) continue;
        tenants.push({ id: item.id, name: item.showAs || item.name || item.id, apiHost: item.apiHost });
      }
    }
    return tenants;
  }

  // Reads every page (key-based paging). The first page uses the default size; later pages use the
  // maxSize the API reports.
  async listEndpoints(tenant: SophosTenant): Promise<SophosEndpoint[]> {
    const base = `${trimSlash(tenant.apiHost)}/endpoint/v1/endpoints`;
    const endpoints: SophosEndpoint[] = [];
    let nextKey: string | undefined;
    let pageSize: number | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams();
      if (nextKey) params.set("pageFromKey", nextKey);
      if (pageSize) params.set("pageSize", String(pageSize));
      const url = params.size > 0 ? `${base}?${params}` : base;
      const data = (await this.getJson(url, { "X-Tenant-ID": tenant.id })) as {
        items?: SophosEndpoint[];
        pages?: { nextKey?: string; maxSize?: number };
      };
      endpoints.push(...(data.items ?? []));
      nextKey = data.pages?.nextKey;
      pageSize = data.pages?.maxSize ?? pageSize;
      if (!nextKey) return endpoints;
    }
    throw new Error(`Endpoint listing for tenant ${tenant.id} exceeded ${MAX_PAGES} pages`);
  }

  private getJson(url: string, headers: Record<string, string>): Promise<unknown> {
    return this.requestJson("GET", url, headers);
  }

  // Authenticated JSON request with retries; used by the query providers (Live Discover).
  async requestJson(
    method: "GET" | "POST" | "DELETE",
    url: string,
    headers: Record<string, string>,
    body?: unknown,
    retriedAuth = false,
  ): Promise<unknown> {
    const token = await this.getToken();
    const response = await this.send(method, url, {
      headers: {
        ...headers,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 401 && !retriedAuth) {
      // Token revoked or expired early: fetch a new one once.
      await response.body?.cancel();
      tokenCache.delete(this.options.clientId);
      return this.requestJson(method, url, headers, body, true);
    }
    if (!response.ok) {
      const data = (await safeJson(response)) as { error?: string; errorCode?: string };
      throw new SophosApiError(response.status, new URL(url).pathname, data.errorCode ?? data.error);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  private send(method: string, url: string, init: RequestInit): Promise<Response> {
    const { host, pathname } = new URL(url);
    return fetchWithRetry(this.fetchFn, url, { ...init, method }, {
      sleep: this.sleep,
      random: this.options.random,
      onAttempt: (info: AttemptInfo) =>
        this.options.onCall?.({
          method,
          host,
          path: pathname,
          status: info.status,
          attempt: info.attempt,
          durationMs: info.durationMs,
          ...(info.error ? { error: info.error } : {}),
        }),
    });
  }
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
