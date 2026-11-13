import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalize } from "./normalize.ts";
import { clearTokenCache, SophosClient } from "./sophos.ts";
import {
  DataLakeClient,
  DataLakeError,
  DataLakeOverLimitError,
  latestSnapshots,
  searchWindow,
  snapshotTime,
  softwareInfoQl,
  toExtensionRows,
  toProgramRows,
  type DataLakeRow,
} from "./data-lake.ts";

const H1 = "11111111-1111-4111-8111-111111111111";
const H2 = "22222222-2222-4222-8222-222222222222";
const NEW = 1794554258096;
const OLD = NEW - 86_400_000;
const W = { earliest: "2026-11-12T05:00:00Z", latest: "2026-11-13T07:00:00Z" };

function app(host: string, time: number, name: string | null, original: unknown, extra: Record<string, unknown> = {}): DataLakeRow {
  return {
    host_id: host,
    time,
    product: { name, version: "1.0", vendor_name: "Vendor", uid: "uid-1", type_id: "TYPE_ID_APPLICATION", path: null, source: "src", url_string: null, ...extra },
    original_data: typeof original === "string" ? original : JSON.stringify(original),
  };
}
function ext(profile: string): DataLakeRow {
  const path = `C:\\Users\\alice\\AppData\\Local\\Google\\Chrome\\User Data\\${profile}\\Extensions\\ghbmnnjooekpmoecnnnilnnbdlolhkhi\\1.111.1_0`;
  return {
    host_id: H1,
    time: NEW,
    product: { name: "Google Docs Offline", version: "1.111.1", vendor_name: "x@example.com", uid: "ghbmnnjooekpmoecnnnilnnbdlolhkhi", type_id: "TYPE_ID_BROWSER_EXTENSION", path, source: "Chrome", url_string: "https://example.test/crx" },
    original_data: JSON.stringify({ browser: "Chrome", username: "alice", path }),
  };
}

const rows: DataLakeRow[] = [
  app(H1, OLD, "OldApp", {}),
  app(H1, NEW, "7-Zip 26.05 (x64)", { installDate: "2022-11-29T00:00:00Z" }, { vendor_name: "Igor Pavlov", uid: "7z" }),
  app(H1, NEW, null, '{"id":"Microsoft Edge Update","source":"softwareInventory","version":"1.3.315.17"}'),
  app(H1, NEW - 1000, null, "not json"),
  ext("Default"),
  ext("Profile 1"),
  app(H2, OLD, "Other", {}),
];

describe("pure helpers", () => {
  it("searchWindow ends at the last whole UTC hour at least 15 minutes ago", () => {
    expect(searchWindow(Date.parse("2026-11-13T07:40:12Z"))).toEqual(W);
    expect(searchWindow(Date.parse("2026-11-13T07:10:00Z")).latest).toBe("2026-11-13T06:00:00Z");
  });

  it("softwareInfoQl builds the exact query and rejects bad ids", () => {
    expect(softwareInfoQl([H1, H2], W)).toBe(
      `from softwareinfo where normalizer = 'sophos-xdr-it-hygiene-ingestor' and host_id in ('${H1}', '${H2}') earliest='${W.earliest}' latest='${W.latest}' | fields host_id, time, product.name, product.version, product.vendor_name, product.uid, product.type_id, product.path, product.source, product.url_string, original_data`,
    );
    expect(() => softwareInfoQl(["x' or '1'='1"], W)).toThrow(DataLakeError);
    expect(() => softwareInfoQl([], W)).toThrow(DataLakeError);
    expect(() => softwareInfoQl(Array.from({ length: 20 }, () => H1), W)).not.toThrow();
    expect(() => softwareInfoQl(Array.from({ length: 21 }, () => H1), W)).toThrow(DataLakeError);
  });

  it("latestSnapshots keeps the newest snapshot per host", () => {
    const snaps = latestSnapshots([...rows, { host_id: null, time: NEW }, { host_id: H1, time: "x" }]);
    expect(snaps.get(H1)).toHaveLength(5);
    expect(snaps.get(H2)).toHaveLength(1);
    expect(snapshotTime(snaps.get(H1)!)).toBe(new Date(NEW).toISOString());
  });

  it("toProgramRows drops nameless rows and maps the rest", () => {
    const out = toProgramRows(latestSnapshots(rows).get(H1)!);
    expect(out).toEqual([
      { name: "7-Zip 26.05 (x64)", version: "1.0", publisher: "Igor Pavlov", install_location: null, install_date: "2022-11-29T00:00:00Z", identifying_number: "7z" },
    ]);
    const n = normalize("programs", "windows", "dl.programs", out, 2);
    expect(n.kind === "software" && n.items[0].title.match_key).toBe("7-zip|igor pavlov");
  });

  it("toProgramRows falls back to original_data.name", () => {
    const out = toProgramRows([app(H1, NEW, null, { name: "Named In Original" })]);
    expect(out[0].name).toBe("Named In Original");
  });

  it("toExtensionRows feed normalize with one scope per profile", () => {
    const n = normalize("extensions", "windows", "dl.extensions", toExtensionRows(rows), 2);
    expect(n.kind === "software" && n.items.map((i) => [i.title.source, i.scope_key])).toEqual([
      ["chrome", "alice|Default"],
      ["chrome", "alice|Profile 1"],
    ]);
  });
});

describe("DataLakeClient", () => {
  beforeEach(() => clearTokenCache());

  function setup(respond: (query: string, variables: Record<string, unknown>) => unknown) {
    const headers: Record<string, string>[] = [];
    const fetchFn = vi.fn(async (input: string, init: RequestInit = {}) => {
      if (input.includes("oauth2")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
      headers.push(init.headers as Record<string, string>);
      const { query, variables } = JSON.parse(String(init.body));
      return new Response(JSON.stringify(respond(query, variables)), { status: 200 });
    });
    const sophos = new SophosClient({ clientId: "id", clientSecret: "secret-0123456789", fetch: fetchFn, sleep: async () => {} });
    return { dl: new DataLakeClient(sophos, "t-1", undefined, async () => {}), headers };
  }
  const status = (success: string, st = "COMPLETE", over = false) => ({
    urn: "urn:s:1", status: st, outcome: { success, errors: [] }, overThreshold: over, errors: null,
  });
  const far = Date.now() + 60_000;

  function happy(total: number, success = "ALL") {
    return (query: string, v: Record<string, unknown>) => {
      if (query.includes("getOrCreateSearch")) return { data: { getOrCreateSearch: status(success, "RUNNING") } };
      if (query.includes("searchResults")) {
        const second = v.cursor === "c2";
        return { data: { searchResults: { values: second ? JSON.stringify([rows[2]]) : [rows[0], rows[1]], nextCursor: second ? null : "c2", totals: { total: { value: total } } } } };
      }
      return { data: { search: status(success) } };
    };
  }

  it("polls, pages and returns every row with the URN", async () => {
    const queries: string[] = [];
    const inner = happy(3);
    const { dl, headers } = setup((q, v) => (queries.push(q), inner(q, v)));
    const res = await dl.search("from softwareinfo", far);
    expect(res.urn).toBe("urn:s:1");
    expect(queries[0]).toContain("$input: CreateSearchInput");
    expect(queries[0]).toContain("getOrCreateSearch");
    expect(res.rows).toHaveLength(3);
    expect(headers.every((h) => h["X-Tenant-ID"] === "t-1")).toBe(true);
  });

  it("refuses a partial search", async () => {
    await expect(setup(happy(3, "PARTIAL")).dl.search("q", far)).rejects.toThrow(DataLakeError);
  });

  it("refuses a truncated search", async () => {
    const respond = (query: string, v: Record<string, unknown>) => {
      if (query.includes("searchResults")) {
        const vals = Array.from({ length: 10_000 }, () => ({ host_id: H1 }));
        return { data: { searchResults: { values: vals, nextCursor: null, totals: { total: { value: 10_500 } } } } };
      }
      return happy(3)(query, v);
    };
    await expect(setup(respond).dl.search("q", far)).rejects.toThrow(DataLakeOverLimitError);
  });

  it("refuses exactly 10,000 rows without totals", async () => {
    const respond = (query: string, v: Record<string, unknown>) => {
      if (query.includes("searchResults")) {
        return { data: { searchResults: { values: Array.from({ length: 10_000 }, () => ({ host_id: H1 })), nextCursor: null } } };
      }
      return happy(3)(query, v);
    };
    await expect(setup(respond).dl.search("q", far)).rejects.toThrow(DataLakeOverLimitError);
  });

  // Live, 2026-11-13: overThreshold was true on a search that returned 0 rows with totals 0, so it does not mean
  // "rows were cut". Only the totals and the row cap decide.
  it("accepts overThreshold when every row was read", async () => {
    const respond = (query: string, v: Record<string, unknown>) =>
      query.includes("search(urn") ? { data: { search: status("ALL", "COMPLETE", true) } } : happy(3)(query, v);
    expect((await setup(respond).dl.search("q", far)).rows).toHaveLength(3);
  });

  it("stops at once on a failed search", async () => {
    let polls = 0;
    const respond = (query: string, v: Record<string, unknown>) =>
      query.includes("search(urn") ? (polls++, { data: { search: status("NONE", "FAILED") } }) : happy(3)(query, v);
    await expect(setup(respond).dl.search("q", far)).rejects.toThrow("FAILED");
    expect(polls).toBe(1);
  });

  it("surfaces GraphQL errors", async () => {
    const { dl } = setup(() => ({ errors: [{ message: "bad query", extensions: { code: "BAD_USER_INPUT" } }] }));
    await expect(dl.search("q", far)).rejects.toThrow("bad query");
  });

  it("times out while the search is running", async () => {
    const { dl } = setup((query) => ({ data: { [query.includes("getOrCreateSearch") ? "getOrCreateSearch" : "search"]: status("ALL", "RUNNING") } }));
    await expect(dl.search("q", Date.now() - 1)).rejects.toThrow("timed out");
  });
});
