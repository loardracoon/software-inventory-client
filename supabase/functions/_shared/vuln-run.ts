// Matches every installed (title, version) of the due tenants against the CVEs in vuln_cache (Phase 10b)
// and stores the result in title_version_vulns. Used by the collector step "vulns" and by hub-sync after
// a pull. A tenant is due when it was never matched, the CVE data or the dictionary changed, or new
// inventory arrived. Each tenant run is full and has a run id: vuln_finish_eval removes the matches the
// run did not store. A run that stops for time is not finished; the next one starts again.
// Runtime-neutral: the database is any client with rpc(), so Vitest drives it with a fake.

import { matchVersion, rangesFor, type VersionMatch, type VulnRange } from "./vuln-match.ts";

export type RpcClient = {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
};

// platforms: the OS of the computers where the pair is installed.
type Pair = { title_id: string; version: string; product_key: string; platforms?: string[] | null };
type ProductVuln = { product_key: string; vuln_id: string; ranges: VulnRange[] };
// platforms: the OS of the pair's computers the CVE affects; null = every computer of the pair.
export type VulnMatch = { title_id: string; version: string; product_key: string; vuln_id: string; uncertain: boolean; fixed_in: string | null; platforms: string[] | null };

export type VulnRunSummary = { tenants: number; pairs: number; matches: number; new: number; removed: number; alerts: number; complete: boolean; errors: string[] };

const PAGE = 1000;
const STORE_BATCH = 2000;
const KEYS_BATCH = 50;
const MIN_TIME_LEFT_MS = 8_000;

async function call<T>(db: RpcClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

// The matches of one page of pairs. A range with an OS applies only on that OS, so each OS of the pair
// is matched with its own ranges; the match keeps the OS where it holds (null when it holds on all).
export function matchPairs(pairs: Pair[], vulnsByProduct: Map<string, ProductVuln[]>): VulnMatch[] {
  const out: VulnMatch[] = [];
  for (const p of pairs) {
    const platforms = p.platforms?.length ? p.platforms : null;
    for (const v of vulnsByProduct.get(p.product_key) ?? []) {
      const ranges = v.ranges ?? [];
      let best: VersionMatch | null = null;
      let on: string[] | null = null;
      if (!platforms || ranges.every((r) => !r.platforms?.length)) {
        best = matchVersion(p.version, ranges);
      } else {
        on = [];
        for (const os of platforms) {
          const m = matchVersion(p.version, rangesFor(ranges, os));
          if (!m) continue;
          on.push(os);
          if (!best || (best.uncertain && !m.uncertain)) best = m;
        }
        if (on.length === platforms.length) on = null;
      }
      if (best) out.push({ title_id: p.title_id, version: p.version, product_key: p.product_key, vuln_id: v.vuln_id, uncertain: best.uncertain, fixed_in: best.fixed_in, platforms: on });
    }
  }
  return out;
}

async function loadProducts(db: RpcClient, keys: string[], cache: Map<string, ProductVuln[]>) {
  const missing = [...new Set(keys)].filter((k) => !cache.has(k));
  for (let i = 0; i < missing.length; i += KEYS_BATCH) {
    const batch = missing.slice(i, i + KEYS_BATCH);
    for (const k of batch) cache.set(k, []);
    for (const row of (await call<ProductVuln[]>(db, "vuln_product_ranges", { p_product_keys: batch })) ?? []) cache.get(row.product_key)?.push(row);
  }
}

async function runTenant(db: RpcClient, tenantId: string, timeLeft: () => number, cache: Map<string, ProductVuln[]>, s: VulnRunSummary): Promise<boolean> {
  const runId = crypto.randomUUID();
  let after: Pair | null = null;
  let fresh = 0;
  for (;;) {
    if (timeLeft() < MIN_TIME_LEFT_MS) return false;
    const pairs: Pair[] = (await call<Pair[]>(db, "vuln_eval_inputs", {
      p_tenant_id: tenantId,
      p_after_title: after?.title_id ?? null,
      p_after_version: after?.version ?? null,
      p_limit: PAGE,
    })) ?? [];
    if (!pairs.length) break;
    await loadProducts(db, pairs.map((p) => p.product_key), cache);
    const matches = matchPairs(pairs, cache);
    for (let i = 0; i < matches.length; i += STORE_BATCH) {
      const stored = await call<{ stored: number; new: number; alerts: number }>(db, "vuln_store_matches", {
        p_tenant_id: tenantId,
        p_run_id: runId,
        p_matches: matches.slice(i, i + STORE_BATCH),
      });
      s.matches += stored.stored;
      s.new += stored.new;
      s.alerts += stored.alerts;
      fresh += stored.new;
    }
    s.pairs += pairs.length;
    if (pairs.length < PAGE) break;
    after = pairs[pairs.length - 1];
  }
  const done = await call<{ removed: number }>(db, "vuln_finish_eval", { p_tenant_id: tenantId, p_run_id: runId, p_changed: fresh > 0 });
  s.removed += done.removed;
  return true;
}

export async function runVulnEvaluation(db: RpcClient, options: { timeLeft: () => number }): Promise<VulnRunSummary> {
  const s: VulnRunSummary = { tenants: 0, pairs: 0, matches: 0, new: 0, removed: 0, alerts: 0, complete: true, errors: [] };
  const due = (await call<{ tenant_id: string }[]>(db, "vuln_due_tenants", {})) ?? [];
  const cache = new Map<string, ProductVuln[]>();
  for (const row of due) {
    s.tenants++;
    try {
      if (!(await runTenant(db, row.tenant_id, options.timeLeft, cache, s))) {
        s.complete = false;
        break;
      }
    } catch (e) {
      s.errors.push((e as Error).message);
      s.complete = false;
    }
  }
  return s;
}
