import { describe, expect, it } from "vitest";
import { runPolicyEvaluation, type RpcClient } from "./policy-run.ts";

const TENANT = "t-1";
const policy = {
  id: "p-1",
  version: 3,
  default_class: "unsanctioned_app",
  rules: [
    { id: "r-old", name: "Old", class: "unsanctioned_app", match: "all", kinds: ["program"], enabled: true, conditions: [{ field: "version", operator: "lt", value: "24" }] },
    { id: "r-adobe", name: "Adobe", class: "sanctioned_app", match: "all", kinds: ["program"], enabled: true, conditions: [{ field: "vendor", operator: "equals", value: "Adobe" }] },
  ],
};
const pair = (title: string, version: string, vendor = "Adobe") => ({ title_id: title, version, kind: "program", name: title, vendor });

function fakeDb(pages: unknown[][], options: { fullRun?: boolean; storeError?: { message: string; code: string } } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let page = 0;
  const db: RpcClient = {
    async rpc(fn, args = {}) {
      calls.push({ fn, args });
      switch (fn) {
        case "policy_due_tenants":
          return { data: [{ tenant_id: TENANT, policy_id: policy.id, full_run: options.fullRun ?? false }], error: null };
        case "policy_published":
          return { data: policy, error: null };
        case "policy_eval_inputs":
          return { data: pages[page++] ?? [], error: null };
        case "policy_store_results": {
          if (options.storeError) return { data: null, error: options.storeError };
          const results = args.p_results as unknown[];
          return { data: { stored: results.length, changed: 1, alerts: 0 }, error: null };
        }
        default:
          return { data: null, error: null };
      }
    },
  };
  return { db, calls };
}

describe("runPolicyEvaluation", () => {
  it("evaluates each installed version and stores the class with the deciding rule", async () => {
    const { db, calls } = fakeDb([[pair("acrobat", "23.0"), pair("acrobat", "25.0"), pair("zip", "24.0", "Igor Pavlov")]]);
    const summary = await runPolicyEvaluation(db, { alert: true, timeLeft: () => 60_000 });
    const store = calls.find((c) => c.fn === "policy_store_results")!;
    expect(store.args.p_results).toEqual([
      { title_id: "acrobat", version: "23.0", class: "unsanctioned_app", rule_id: "r-old" },
      { title_id: "acrobat", version: "25.0", class: "sanctioned_app", rule_id: "r-adobe" },
      { title_id: "zip", version: "24.0", class: "unsanctioned_app", rule_id: null },
    ]);
    expect(store.args.p_alert).toBe(true); // new pairs after an ingest may alert
    expect(calls.find((c) => c.fn === "policy_eval_inputs")!.args.p_only_new).toBe(true);
    expect(calls.some((c) => c.fn === "policy_evaluation_finished")).toBe(false);
    expect(summary).toMatchObject({ tenants: 1, evaluated: 3, complete: true });
  });

  it("a full run pages with a keyset, never alerts and marks the evaluation finished", async () => {
    const first = Array.from({ length: 1000 }, (_, i) => pair(`t${String(i).padStart(4, "0")}`, "25"));
    const { db, calls } = fakeDb([first, [pair("u", "1")]], { fullRun: true });
    const summary = await runPolicyEvaluation(db, { alert: true, timeLeft: () => 60_000 });
    const inputs = calls.filter((c) => c.fn === "policy_eval_inputs");
    expect(inputs).toHaveLength(2);
    expect(inputs[1].args).toMatchObject({ p_only_new: false, p_after_title: "t0999", p_after_version: "25" });
    expect(calls.filter((c) => c.fn === "policy_store_results").every((c) => c.args.p_alert === false)).toBe(true);
    expect(calls.at(-1)).toEqual({ fn: "policy_evaluation_finished", args: { p_policy_id: "p-1" } });
    expect(summary.evaluated).toBe(1001);
  });

  it("a tenant id forces a full run of that tenant", async () => {
    const { db, calls } = fakeDb([[pair("a", "1")]]);
    await runPolicyEvaluation(db, { tenantId: TENANT, alert: false, timeLeft: () => 60_000 });
    expect(calls.find((c) => c.fn === "policy_eval_inputs")!.args.p_only_new).toBe(false);
    expect(calls.some((c) => c.fn === "policy_evaluation_finished")).toBe(true);
  });

  it("stops before the time limit and reports an incomplete run", async () => {
    const { db, calls } = fakeDb([[pair("a", "1")]]);
    const summary = await runPolicyEvaluation(db, { alert: false, timeLeft: () => 1_000 });
    expect(calls.some((c) => c.fn === "policy_eval_inputs")).toBe(false);
    expect(summary.complete).toBe(false);
  });

  it("a publish during the run is reported, not thrown", async () => {
    const { db } = fakeDb([[pair("a", "1")]], { storeError: { message: "not the published policy", code: "40001" } });
    const summary = await runPolicyEvaluation(db, { alert: false, timeLeft: () => 60_000 });
    expect(summary.complete).toBe(false);
    expect(summary.errors).toEqual(["The policy changed during the evaluation; it runs again next time"]);
  });
});
