import { describe, expect, it } from "vitest";
import { runEolEvaluation, type RpcClient } from "./eol-run.ts";

const T1 = "10000000-0000-0000-0000-00000000000a";
const SEVENZIP = "program|igor pavlov|7-zip";
const releases = {
  [SEVENZIP]: [
    { name: "23", label: "23", is_eol: true, eol_from: "2024-06-01", latest_name: "23.01" },
    { name: "26", label: "26", is_eol: false, eol_from: "2028-01-01", latest_name: "26.05" },
  ],
  "os:windows": [
    { name: "11-24h2-w", label: "11 24H2 (W)", is_eol: false, eol_from: "2026-12-01", latest_name: "10.0.26100" },
    { name: "11-24h2-e", label: "11 24H2 (E)", is_eol: false, eol_from: "2027-10-12", latest_name: "10.0.26100" },
  ],
  "os:macos": [{ name: "15", label: "15", is_eol: false, eol_from: null, latest_name: "15.1" }],
} as Record<string, unknown[]>;

function fakeDb(over: { due?: string[]; pairs?: Record<string, unknown>[]; os?: Record<string, unknown>[] } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db: RpcClient = {
    rpc: async (fn, args = {}) => {
      calls.push({ fn, args });
      switch (fn) {
        case "eol_due_tenants":
          return { data: (over.due ?? [T1]).map((tenant_id) => ({ tenant_id })), error: null };
        case "eol_inputs": {
          const all = over.pairs ?? [
            { title_id: "t1", version: "23.01", product_key: SEVENZIP },
            { title_id: "t1", version: "26.05", product_key: SEVENZIP },
            { title_id: "t1", version: "", product_key: SEVENZIP },
          ];
          return { data: args.p_after_title ? [] : all, error: null };
        }
        case "eol_cache_get":
          return { data: (args.p_product_keys as string[]).filter((k) => releases[k]).map((k) => ({ product_key: k, releases: releases[k] })), error: null };
        case "eol_os_inputs":
          return {
            data: over.os ?? [
              { computer_id: "c1", platform: "windows", os_name: "Windows 11 Pro", os_version: "10.0", os_build: "26100" },
              { computer_id: "c2", platform: "windows", os_name: "Windows 11 Enterprise", os_version: "10.0", os_build: "26100" },
              { computer_id: "c3", platform: "windows", os_name: "Windows 11 Pro", os_version: "10.0", os_build: "99999" },
              { computer_id: "c4", platform: "macos", os_name: "macOS", os_version: "15.1", os_build: null },
              { computer_id: "c5", platform: "linux", os_name: "Ubuntu", os_version: "22.04", os_build: null },
            ],
            error: null,
          };
        case "eol_replace":
          return { data: { titles: (args.p_titles as unknown[]).length, computers: (args.p_computers as unknown[]).length }, error: null };
        default:
          return { data: null, error: { message: `unexpected ${fn}` } };
      }
    },
  };
  return { db, calls };
}

const TODAY = new Date("2026-11-13T12:00:00Z");

describe("runEolEvaluation", () => {
  it("matches every installed version and every OS of a due tenant and stores one full run", async () => {
    const { db, calls } = fakeDb();
    const summary = await runEolEvaluation(db, { timeLeft: () => 1e6, today: TODAY });
    const replace = calls.find((c) => c.fn === "eol_replace")!;
    expect(replace.args.p_tenant_id).toBe(T1);
    expect(replace.args.p_titles).toEqual([
      { title_id: "t1", version: "23.01", product_key: SEVENZIP, release: "23", eol_from: "2024-06-01", status: "eol" },
      { title_id: "t1", version: "26.05", product_key: SEVENZIP, release: "26", eol_from: "2028-01-01", status: "supported" },
    ]);
    // c1 Pro → -w, ends 2026-12-01 (18 days: ending soon); c2 Enterprise → -e; c3 insider build and c5 Linux: unknown, not stored; c4 macOS 15 has no end date
    expect(replace.args.p_computers).toEqual([
      { computer_id: "c1", release: "11-24h2-w", eol_from: "2026-12-01", status: "ending_soon" },
      { computer_id: "c2", release: "11-24h2-e", eol_from: "2027-10-12", status: "supported" },
      { computer_id: "c4", release: "15", eol_from: null, status: "supported" },
    ]);
    expect(summary).toMatchObject({ tenants: 1, titles: 2, computers: 3, complete: true, errors: [] });
  });

  it("does nothing when no tenant is due", async () => {
    const { db, calls } = fakeDb({ due: [] });
    const summary = await runEolEvaluation(db, { timeLeft: () => 1e6, today: TODAY });
    expect(calls.map((c) => c.fn)).toEqual(["eol_due_tenants"]);
    expect(summary).toMatchObject({ tenants: 0, complete: true });
  });

  it("asks the cache once for the OS keys when no title matches", async () => {
    const { db, calls } = fakeDb({ pairs: [] });
    await runEolEvaluation(db, { timeLeft: () => 1e6, today: TODAY });
    const gets = calls.filter((c) => c.fn === "eol_cache_get");
    expect(gets).toHaveLength(1);
    expect(gets[0].args.p_product_keys).toEqual(["os:windows", "os:macos"]);
  });

  it("does not ask the cache for a tenant with nothing to match and still stores the empty run", async () => {
    const { db, calls } = fakeDb({ pairs: [], os: [] });
    await runEolEvaluation(db, { timeLeft: () => 1e6, today: TODAY });
    expect(calls.filter((c) => c.fn === "eol_cache_get")).toHaveLength(0);
    expect(calls.find((c) => c.fn === "eol_replace")!.args).toMatchObject({ p_titles: [], p_computers: [] });
  });

  it("stops before the time limit and says the run is not complete", async () => {
    const { db, calls } = fakeDb({ due: [T1, "20000000-0000-0000-0000-00000000000b"] });
    let left = 20_000;
    const summary = await runEolEvaluation(db, { timeLeft: () => (left -= 9_000), today: TODAY });
    expect(summary.complete).toBe(false);
    expect(calls.filter((c) => c.fn === "eol_replace").length).toBe(1);
  });

  it("a failing tenant is reported and the next one still runs", async () => {
    const { db } = fakeDb({ due: ["bad", T1] });
    const original = db.rpc.bind(db);
    db.rpc = async (fn, args) => (fn === "eol_inputs" && args?.p_tenant_id === "bad" ? { data: null, error: { message: "boom" } } : original(fn, args));
    const summary = await runEolEvaluation(db, { timeLeft: () => 1e6, today: TODAY });
    expect(summary.errors).toEqual(["bad: eol_inputs: boom"]);
    expect(summary.tenants).toBe(1);
  });
});
