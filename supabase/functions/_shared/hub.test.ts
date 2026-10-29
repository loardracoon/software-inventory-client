import { describe, expect, it, vi } from "vitest";
import { HubClient, HubError, toSubmission, type TitleSubmission } from "./hub.ts";
import type { ApiCallLog } from "./sophos.ts";

const KEY = "hub-client-key-0123456789";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function hub(handler: (url: URL, init: RequestInit) => Response) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const logs: ApiCallLog[] = [];
  const fetchFn = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    calls.push({ url, init });
    if ((init.headers as Record<string, string>).Authorization !== `Bearer ${KEY}`) return json({ error: "Invalid client key" }, 401);
    return handler(url, init);
  });
  const client = new HubClient({ url: "https://hub.example.com/", key: KEY, fetchFn, sleep: async () => {}, onCall: (l) => logs.push(l) });
  return { client, calls, logs };
}

const title = (i: number): TitleSubmission => ({ kind: "program", source: "programs", match_key: `t${i}|`, name: `T${i}`, vendor: null, description: null });

describe("HubClient", () => {
  it("reads a page of dictionary changes", async () => {
    const { client, calls, logs } = hub(() => json({ entries: [{ kind: "program", status: "published" }], categories: [], next_seq: 42, has_more: true }));
    const page = await client.dictionaryChanges(7);
    expect(page).toMatchObject({ next_seq: 42, has_more: true, categories: [] });
    expect(page.entries).toHaveLength(1);
    expect(calls[0].url.toString()).toBe("https://hub.example.com/functions/v1/dictionary-changes?since=7&limit=1000");
    expect(JSON.stringify(logs)).not.toContain(KEY);
  });

  it("reads a page of vulnerability changes; a Hub without the feed (404) gives null", async () => {
    const item = { product_key: "program|igor pavlov|7-zip", vuln_id: "CVE-2025-0411", removed: false, ranges: [{ version_start: null, start_inclusive: null, version_end: "24.09", end_inclusive: false, exact_version: null }] };
    const { client, calls } = hub(() => json({ items: [item], next_seq: 9, has_more: false }));
    expect(await client.vulnerabilityChanges(3)).toEqual({ items: [item], next_seq: 9, has_more: false });
    expect(calls[0].url.toString()).toBe("https://hub.example.com/functions/v1/vulnerability-changes?since=3&limit=1000");
    const old = hub(() => json({ error: "Not found" }, 404));
    expect(await old.client.vulnerabilityChanges(0)).toBeNull();
  });

  it("sends only the six title fields, 500 per call, descriptions cut at 1,000 characters", async () => {
    const { client, calls } = hub(() => json({ ok: true }));
    const rows = Array.from({ length: 1201 }, (_, i) => ({
      ...title(i),
      id: `row-${i}`,
      hostname: "W1",
      username: "alice",
      tenant: "Acme",
      computers: 3,
      description: i === 0 ? "x".repeat(1500) : null,
    }));
    expect(await client.submitTitles(rows)).toBe(1201);
    const bodies = calls.map((c) => JSON.parse(String(c.init.body)) as { titles: Record<string, unknown>[] });
    expect(bodies.map((b) => b.titles.length)).toEqual([500, 500, 201]);
    for (const b of bodies) for (const t of b.titles) expect(Object.keys(t).sort()).toEqual(["description", "kind", "match_key", "name", "source", "vendor"]);
    expect((bodies[0].titles[0].description as string).length).toBe(1000);
  });

  it("creates a request and reads statuses", async () => {
    const { client, calls } = hub((url, init) =>
      init.method === "POST" ? json({ id: "REQ-0042", status: "open" }) : json([{ id: "REQ-0042", status: "accepted", admin_note: "Agreed" }]),
    );
    const created = await client.createRequest({
      kind: "program",
      source: "programs",
      match_key: "anydesk|anydesk",
      suggested_category_id: null,
      reason: "Remote tool",
      evidence_url: null,
    });
    expect(created).toEqual({ id: "REQ-0042", status: "open" });
    expect(await client.requestStatus(["REQ-0042", "REQ-0043"])).toEqual([{ id: "REQ-0042", status: "accepted", admin_note: "Agreed" }]);
    expect(calls[1].url.search).toBe("?ids=REQ-0042,REQ-0043");
    expect(await client.requestStatus([])).toEqual([]);
  });

  it("raises HubError with the hub's message; 503 is retried before giving up", async () => {
    const bad = new HubClient({ url: "https://hub.example.com", key: "wrong-key-0123456789", fetchFn: async () => json({ error: "Invalid client key" }, 401) });
    await expect(bad.dictionaryChanges(0)).rejects.toThrow(new HubError(401, "/functions/v1/dictionary-changes", "Invalid client key"));

    const { client, calls } = hub(() => json({ error: "down" }, 503));
    await expect(client.dictionaryChanges(0)).rejects.toBeInstanceOf(HubError);
    expect(calls).toHaveLength(5);
  });

  it("toSubmission drops anything that is not metadata", () => {
    const row = { ...title(1), hostname: "W1", username: "alice" } as TitleSubmission & Record<string, unknown>;
    expect(toSubmission(row)).toEqual(title(1));
  });
});
