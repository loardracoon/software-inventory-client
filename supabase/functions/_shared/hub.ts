// Dictionary Hub client API (docs/phases/hub-H2-client-api.md). Bearer client key on every call;
// 429 and 5xx are retried by http.ts. Runtime-neutral (Deno and Node) so Vitest can test it.
// What leaves this app is limited here: titles carry only the six metadata fields, never hostnames,
// users, tenant names or install counts.

import { fetchWithRetry, type AttemptInfo, type FetchLike, type Sleep } from "./http.ts";
import type { ApiCallLog } from "./sophos.ts";

export const SUBMIT_BATCH = 500;
export const DESCRIPTION_MAX = 1000;
export const REASON_MAX = 500;

export type HubCategory = {
  id: string;
  slug: string;
  parent_id: string | null;
  name: string;
  description?: string | null;
  attention_level?: string | null;
  sophos_firewall_category?: string | null;
  revision?: number;
  seq?: number;
  deprecated?: boolean;
};

export type HubEntry = {
  kind: string;
  source: string;
  match_key: string;
  canonical_name?: string;
  vendor?: string | null;
  description?: string | null;
  category_id?: string;
  attention_level?: string | null;
  confidence?: number | null;
  method?: string;
  revision?: number;
  status: string;
  seq?: number;
};

export type DictionaryPage = { entries: HubEntry[]; categories: HubCategory[]; next_seq: number; has_more: boolean };

export type TitleSubmission = {
  kind: string;
  source: string;
  match_key: string;
  name: string;
  vendor: string | null;
  description: string | null;
};

export type RequestStatus = { id: string; status: string; admin_note: string | null };

export class HubError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    detail?: string,
  ) {
    super(`Dictionary Hub returned HTTP ${status} for ${path}${detail ? `: ${detail}` : ""}`);
    this.name = "HubError";
  }
}

// Copies only the allowed fields, whatever else the row carries.
export function toSubmission(row: { kind: string; source: string; match_key: string; name: string; vendor?: string | null; description?: string | null }): TitleSubmission {
  return {
    kind: row.kind,
    source: row.source,
    match_key: row.match_key,
    name: row.name,
    vendor: row.vendor ?? null,
    description: row.description ? row.description.slice(0, DESCRIPTION_MAX) : null,
  };
}

export type HubClientOptions = {
  url: string; // project URL; functions live under /functions/v1
  key: string;
  fetchFn?: FetchLike;
  sleep?: Sleep;
  onCall?: (log: ApiCallLog) => void;
};

export class HubClient {
  private readonly base: string;

  constructor(private readonly options: HubClientOptions) {
    this.base = `${options.url.replace(/\/+$/, "")}/functions/v1`;
  }

  async dictionaryChanges(since: number, limit = 1000): Promise<DictionaryPage> {
    const page = (await this.request("GET", `/dictionary-changes?since=${since}&limit=${limit}`)) as Partial<DictionaryPage>;
    if (typeof page?.next_seq !== "number") throw new HubError(200, "/dictionary-changes", "response has no next_seq");
    return { entries: page.entries ?? [], categories: page.categories ?? [], next_seq: page.next_seq, has_more: page.has_more === true };
  }

  // Sends in batches of 500; returns how many titles were accepted.
  async submitTitles(titles: TitleSubmission[]): Promise<number> {
    let sent = 0;
    for (let i = 0; i < titles.length; i += SUBMIT_BATCH) {
      const batch = titles.slice(i, i + SUBMIT_BATCH).map(toSubmission);
      await this.request("POST", "/titles-submit", { titles: batch });
      sent += batch.length;
    }
    return sent;
  }

  async createRequest(request: {
    kind: string;
    source: string;
    match_key: string;
    suggested_category_id: string | null;
    reason: string;
    evidence_url: string | null;
  }): Promise<{ id: string; status: string }> {
    const result = (await this.request("POST", "/reclassification-requests", request)) as { id?: string; status?: string };
    if (!result?.id) throw new HubError(200, "/reclassification-requests", "response has no id");
    return { id: result.id, status: result.status ?? "open" };
  }

  async requestStatus(ids: string[]): Promise<RequestStatus[]> {
    if (ids.length === 0) return [];
    const result = (await this.request("GET", `/reclassification-requests?ids=${ids.map(encodeURIComponent).join(",")}`)) as
      | RequestStatus[]
      | { requests?: RequestStatus[] };
    return Array.isArray(result) ? result : (result?.requests ?? []);
  }

  private async request(method: "GET" | "POST", pathAndQuery: string, body?: unknown): Promise<unknown> {
    const url = `${this.base}${pathAndQuery}`;
    const { host, pathname } = new URL(url);
    const response = await fetchWithRetry(
      this.options.fetchFn ?? fetch,
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.options.key}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      {
        sleep: this.options.sleep,
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
      },
    );
    const text = await response.text();
    if (!response.ok) {
      let detail: string | undefined;
      try {
        detail = (JSON.parse(text) as { error?: string }).error;
      } catch {
        detail = undefined;
      }
      throw new HubError(response.status, pathname, detail);
    }
    return text ? JSON.parse(text) : null;
  }
}
