import { describe, expect, it } from "vitest";
import { DataLakeError, DataLakeOverLimitError } from "./data-lake.ts";
import { syncDataLake } from "./data-lake-run.ts";
import type { TenantRow } from "./probe-runner.ts";

const W1 = "11111111-1111-1111-1111-111111111111";
const W2 = "22222222-2222-2222-2222-222222222222";
const NOW = Date.parse("2026-11-13T12:00:00Z");
const tenant = (over: Partial<TenantRow> = {}, on = true) =>
  ({ id: "t-1", sophos_tenant_id: "st-1", name: "Acme", data_lake_attempt_at: null, scan_settings: { data_lake_inventory: on }, ...over }) as unknown as TenantRow;

const app = (host: string, time: number, name: string) => ({ host_id: host, time, product: { name, version: "1", vendor_name: "V", uid: name, type_id: "TYPE_ID_APPLICATION" } });
const ext = (host: string, time: number, name: string) => ({ host_id: host, time, product: { name, uid: name, type_id: "TYPE_ID_BROWSER_EXTENSION", source: "CHROME" } });
const ROWS = [app(W1, 1000, "A"), ext(W1, 1000, "X"), ext(W2, 2000, "Y"), app(W2, 2000, "Z")];

function fake(targetPages: unknown[][], search: (ql: string) => Promise<{ urn: string; rows: Record<string, unknown>[] }>) {
  const calls: { fn: string; args: Record<string, any> }[] = [];
  const updates: unknown[] = [];
  let page = 0;
  const admin = {
    from: () => ({ update: (v: unknown) => ({ eq: async () => (updates.push(v), { error: null }) }) }),
    async rpc(fn: string, args: Record<string, any>) {
      calls.push({ fn, args });
      if (fn === "data_lake_targets") return { data: targetPages[page++] ?? [], error: null };
      return { data: 3, error: null };
    },
  };
  const logs: { level: string; message: string }[] = [];
  const searches: string[] = [];
  const run = (t: TenantRow) =>
    syncDataLake(admin as never, null as never, { add: (level: string, message: string) => logs.push({ level, message }) } as never, t, () => 120_000, NOW, () => ({
      search: async (ql: string) => (searches.push(ql), search(ql)),
    }));
  return { run, calls, logs, updates, searches };
}
const targets = [
  { computer_id: "c1", sophos_endpoint_id: W1, domains: ["programs", "extensions"] },
  { computer_id: "c2", sophos_endpoint_id: W2, domains: ["extensions"] },
];

describe("syncDataLake", () => {
  it("does nothing when the setting is off", async () => {
    const f = fake([targets], async () => ({ urn: "u", rows: ROWS }));
    expect(await f.run(tenant({}, false))).toEqual({ searches: 0, rawResults: 0 });
    expect(f.calls).toEqual([]);
  });

  it("waits an hour after an attempt", async () => {
    const f = fake([targets], async () => ({ urn: "u", rows: ROWS }));
    await f.run(tenant({ data_lake_attempt_at: new Date(NOW - 600_000).toISOString() }));
    expect(f.calls).toEqual([]);
  });

  it("stores one call with an item per host and domain", async () => {
    const f = fake([targets, []], async () => ({ urn: "urn:1", rows: ROWS }));
    expect(await f.run(tenant())).toEqual({ searches: 1, rawResults: 3 });
    expect(f.updates).toEqual([{ data_lake_attempt_at: new Date(NOW).toISOString() }]);
    const stores = f.calls.filter((c) => c.fn === "store_data_lake_results");
    expect(stores).toHaveLength(1);
    expect(stores[0].args.p_search_urn).toBe("urn:1");
    expect(stores[0].args.p_results.map((i: any) => [i.computer_id, i.domain, i.collected_at])).toEqual([
      ["c1", "programs", new Date(1000).toISOString()],
      ["c1", "extensions", new Date(1000).toISOString()],
      ["c2", "extensions", new Date(2000).toISOString()],
    ]);
  });

  it("writes nothing for a host without rows but still marks it checked", async () => {
    const f = fake([targets, []], async () => ({ urn: "u", rows: ROWS.filter((r) => r.host_id === W1) }));
    await f.run(tenant());
    const store = f.calls.find((c) => c.fn === "store_data_lake_results")!;
    expect(store.args.p_results.every((i: any) => i.computer_id === "c1")).toBe(true);
    expect(store.args.p_checked).toEqual(["c1", "c2"]);
  });

  it("logs a warning and stores nothing when the search fails", async () => {
    const f = fake([targets], async () => {
      throw new DataLakeError("timed out");
    });
    expect(await f.run(tenant())).toEqual({ searches: 0, rawResults: 0 });
    expect(f.logs).toEqual([{ level: "warn", message: "Data Lake search failed for Acme: Data Lake: timed out" }]);
    expect(f.calls.some((c) => c.fn === "store_data_lake_results")).toBe(false);
  });

  it("asks for targets until none are left", async () => {
    const f = fake([targets, []], async () => ({ urn: "u", rows: ROWS }));
    await f.run(tenant());
    expect(f.calls.filter((c) => c.fn === "data_lake_targets").map((c) => c.args.p_limit)).toEqual([20, 20]);
    expect(f.searches).toHaveLength(1);
  });

  it("sends an empty item for a domain without rows when the host reported", async () => {
    const f = fake([[targets[0]], []], async () => ({ urn: "u", rows: [app(W1, 1000, "A")] }));
    await f.run(tenant());
    const store = f.calls.find((c) => c.fn === "store_data_lake_results")!;
    expect(store.args.p_results.map((i: any) => [i.domain, i.rows.length])).toEqual([["programs", 1], ["extensions", 0]]);
  });

  // Over the row limit: split the batch down to one host; one host still over the limit is only stamped.
  const perHost = (overLimit: (ql: string) => boolean) => async (ql: string) => {
    if (overLimit(ql)) throw new DataLakeOverLimitError();
    const host = ql.includes(W1) ? W1 : W2;
    return { urn: `urn:${host}`, rows: ROWS.filter((r) => r.host_id === host) };
  };
  const stores = (f: ReturnType<typeof fake>) =>
    f.calls.filter((c) => c.fn === "store_data_lake_results").map((c) => ({
      urn: c.args.p_search_urn, checked: c.args.p_checked, items: c.args.p_results.map((i: any) => `${i.computer_id}:${i.domain}`),
    }));

  it("splits a batch over the row limit and stores each half", async () => {
    const f = fake([targets, []], perHost((ql) => ql.includes(W1) && ql.includes(W2)));
    expect(await f.run(tenant())).toEqual({ searches: 2, rawResults: 6 });
    expect(f.searches).toHaveLength(3);
    expect(stores(f)).toEqual([
      { urn: `urn:${W1}`, checked: ["c1"], items: ["c1:programs", "c1:extensions"] },
      { urn: `urn:${W2}`, checked: ["c2"], items: ["c2:extensions"] },
    ]);
    expect(f.logs).toEqual([]);
  });

  it("stamps a single host over the row limit and stores the others", async () => {
    const f = fake([targets, []], perHost((ql) => ql.includes(W1)));
    await f.run(tenant());
    expect(stores(f)).toEqual([
      { urn: null, checked: ["c1"], items: [] },
      { urn: `urn:${W2}`, checked: ["c2"], items: ["c2:extensions"] },
    ]);
    expect(f.logs).toEqual([{ level: "warn", message: `Data Lake: endpoint ${W1} of Acme is over the 10,000-row limit; it is skipped until its next turn` }]);
  });

  it("stamps a computer whose endpoint id is not a UUID without searching it", async () => {
    const f = fake([[...targets, { computer_id: "c3", sophos_endpoint_id: "ep-3", domains: ["programs"] }], []], async () => ({ urn: "u", rows: ROWS }));
    expect(await f.run(tenant())).toEqual({ searches: 1, rawResults: 3 });
    expect(f.searches[0]).not.toContain("ep-3");
    expect(stores(f)).toEqual([
      { urn: null, checked: ["c3"], items: [] },
      { urn: "u", checked: ["c1", "c2"], items: ["c1:programs", "c1:extensions", "c2:extensions"] },
    ]);
    expect(f.logs).toEqual([{ level: "warn", message: "Data Lake: 1 computer(s) of Acme have an endpoint id that is not a UUID; they are skipped" }]);
  });
});
