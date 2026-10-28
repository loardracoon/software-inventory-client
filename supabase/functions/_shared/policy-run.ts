// Stores the policy class of every installed (title, version) of a tenant under its published policy
// (Phase 9). Used by the policy-evaluate Edge Function (after a publish) and by the collector step
// "policy" (new pairs after an ingest, everything after a dictionary change). Runtime-neutral: the
// database is any client with rpc(), so Vitest drives it with a fake.

import { evaluate, type PolicyClass, type PolicyInput, type PolicyRule } from "./policy.ts";

export type RpcClient = {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
};

type PublishedPolicy = { id: string; version: number; default_class: PolicyClass; rules: PolicyRule[] };
type InputRow = PolicyInput & { title_id: string; version: string };
type DueRow = { tenant_id: string; policy_id: string; full_run: boolean };

export type PolicyRunSummary = { tenants: number; evaluated: number; changed: number; alerts: number; complete: boolean; errors: string[] };

const PAGE = 1000;
const MIN_TIME_LEFT_MS = 8_000;

async function call<T>(db: RpcClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw Object.assign(new Error(`${fn}: ${error.message}`), { code: error.code });
  return data as T;
}

// One tenant: every pair (full) or only pairs without a class under the published version.
async function runTenant(db: RpcClient, due: DueRow, full: boolean, alert: boolean, timeLeft: () => number, summary: PolicyRunSummary): Promise<boolean> {
  const policy = await call<PublishedPolicy | null>(db, "policy_published", { p_tenant_id: due.tenant_id });
  if (!policy) return true;
  let after: { title: string; version: string } | null = null;
  for (;;) {
    if (timeLeft() < MIN_TIME_LEFT_MS) return false;
    const rows: InputRow[] = await call<InputRow[]>(db, "policy_eval_inputs", {
      p_tenant_id: due.tenant_id,
      p_only_new: !full,
      p_after_title: after?.title ?? null,
      p_after_version: after?.version ?? null,
      p_limit: PAGE,
    });
    if (!rows?.length) break;
    const results = rows.map((row) => {
      const r = evaluate(policy.rules, row, policy.default_class);
      return { title_id: row.title_id, version: row.version, class: r.class, rule_id: r.ruleId };
    });
    const stored = await call<{ stored: number; changed: number; alerts: number }>(db, "policy_store_results", {
      p_tenant_id: due.tenant_id,
      p_policy_id: policy.id,
      p_results: results,
      p_alert: alert && !full,
    });
    summary.evaluated += stored.stored;
    summary.changed += stored.changed;
    summary.alerts += stored.alerts;
    if (rows.length < PAGE) break;
    const last: InputRow = rows[rows.length - 1];
    after = { title: last.title_id, version: last.version };
  }
  if (full) await call(db, "policy_evaluation_finished", { p_policy_id: policy.id });
  return true;
}

// tenantId set: that tenant only, fully (after a publish). Otherwise every tenant with a published
// policy, fully when due (never evaluated since publish, or the dictionary changed), else new pairs.
export async function runPolicyEvaluation(
  db: RpcClient,
  options: { tenantId?: string; alert: boolean; timeLeft: () => number },
): Promise<PolicyRunSummary> {
  const summary: PolicyRunSummary = { tenants: 0, evaluated: 0, changed: 0, alerts: 0, complete: true, errors: [] };
  const due = (await call<DueRow[]>(db, "policy_due_tenants", {})) ?? [];
  for (const row of due) {
    if (options.tenantId && row.tenant_id !== options.tenantId) continue;
    summary.tenants++;
    try {
      const done = await runTenant(db, row, options.tenantId ? true : row.full_run, options.alert, options.timeLeft, summary);
      if (!done) {
        summary.complete = false;
        break;
      }
    } catch (e) {
      // 40001: a publish happened during the run; the next run evaluates the new version.
      const error = e as Error & { code?: string };
      summary.errors.push(error.code === "40001" ? "The policy changed during the evaluation; it runs again next time" : error.message);
      summary.complete = false;
    }
  }
  return summary;
}
