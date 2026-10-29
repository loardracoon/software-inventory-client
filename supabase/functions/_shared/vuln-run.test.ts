import { describe, expect, it } from "vitest";
import { matchPairs, runVulnEvaluation, type RpcClient } from "./vuln-run.ts";

const SEVEN = "program|igor pavlov|7-zip";
const ranges = [{ product_key: SEVEN, vuln_id: "CVE-2025-0411", ranges: [{ version_end: "24.09", end_inclusive: false }] }];

function fakeDb(pairs: { title_id: string; version: string; product_key: string }[], due = [{ tenant_id: "t1" }]) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db: RpcClient = {
    async rpc(fn, args = {}) {
      calls.push({ fn, args });
      const data: Record<string, unknown> = {
        vuln_due_tenants: due,
        vuln_eval_inputs: args.p_after_title ? [] : pairs,
        vuln_product_ranges: ranges.filter((r) => (args.p_product_keys as string[] | undefined)?.includes(r.product_key)),
        vuln_store_matches: { stored: (args.p_matches as unknown[] | undefined)?.length ?? 0, new: 1, alerts: 0 },
        vuln_finish_eval: { removed: 2, changed: true },
      };
      return { data: data[fn] ?? null, error: null };
    },
  };
  return { db, calls };
}

describe("runVulnEvaluation", () => {
  it("matches each due tenant in one run and finishes it", async () => {
    const { db, calls } = fakeDb([
      { title_id: "a", version: "23.01", product_key: SEVEN },
      { title_id: "a", version: "26.05", product_key: SEVEN },
      { title_id: "b", version: "", product_key: SEVEN },
    ]);
    const s = await runVulnEvaluation(db, { timeLeft: () => 100_000 });
    expect(calls.map((c) => c.fn)).toEqual(["vuln_due_tenants", "vuln_eval_inputs", "vuln_product_ranges", "vuln_store_matches", "vuln_finish_eval"]);
    const store = calls[3].args;
    expect(store.p_matches).toEqual([
      { title_id: "a", version: "23.01", product_key: SEVEN, vuln_id: "CVE-2025-0411", uncertain: false, fixed_in: "24.09" },
      { title_id: "b", version: "", product_key: SEVEN, vuln_id: "CVE-2025-0411", uncertain: true, fixed_in: "24.09" },
    ]);
    // The same run id stores and finishes.
    expect(calls[4].args).toEqual({ p_tenant_id: "t1", p_run_id: store.p_run_id, p_changed: true });
    expect(s).toMatchObject({ tenants: 1, pairs: 3, matches: 2, new: 1, removed: 2, complete: true, errors: [] });
  });

  it("does not finish a tenant when time runs out (its old matches stay)", async () => {
    const { db, calls } = fakeDb([{ title_id: "a", version: "23.01", product_key: SEVEN }]);
    const s = await runVulnEvaluation(db, { timeLeft: () => 1_000 });
    expect(calls.some((c) => c.fn === "vuln_finish_eval")).toBe(false);
    expect(s.complete).toBe(false);
  });

  it("reads the ranges of a product once per run", async () => {
    const { db, calls } = fakeDb([{ title_id: "a", version: "1", product_key: SEVEN }], [{ tenant_id: "t1" }, { tenant_id: "t2" }]);
    await runVulnEvaluation(db, { timeLeft: () => 100_000 });
    expect(calls.filter((c) => c.fn === "vuln_product_ranges")).toHaveLength(1);
    expect(calls.filter((c) => c.fn === "vuln_finish_eval")).toHaveLength(2);
  });
});

describe("matchPairs", () => {
  it("skips products without CVEs", () => {
    expect(matchPairs([{ title_id: "x", version: "1", product_key: "program|x|y" }], new Map())).toEqual([]);
  });
});
