// Matches the installed (title, version) pairs and the OS of every due tenant against the release cycles in eol_cache
// (Stage 3). A tenant run is full: eol_replace swaps the results of the tenant in one transaction. Used by the collector
// step "eol" and by hub-sync after a pull. Runtime-neutral: the database is any client with rpc().

import { macosRelease, matchRelease, supportStatus, windowsRelease, type EolRelease, type SupportStatus } from "./eol-match.ts";

export type RpcClient = {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
};

export type EolRunSummary = { tenants: number; titles: number; computers: number; complete: boolean; errors: string[] };

type Pair = { title_id: string; version: string; product_key: string };
type OsRow = { computer_id: string; platform: string; os_name: string | null; os_version: string | null; os_build: string | null };

const PAGE = 1000;
const KEYS_BATCH = 50;
const MIN_TIME_LEFT_MS = 8_000;

async function call<T>(db: RpcClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

async function loadReleases(db: RpcClient, keys: string[]): Promise<Map<string, EolRelease[]>> {
  const cache = new Map<string, EolRelease[]>();
  for (let i = 0; i < keys.length; i += KEYS_BATCH) {
    const rows = (await call<{ product_key: string; releases: EolRelease[] }[]>(db, "eol_cache_get", { p_product_keys: keys.slice(i, i + KEYS_BATCH) })) ?? [];
    for (const r of rows) cache.set(r.product_key, r.releases ?? []);
  }
  return cache;
}

async function runTenant(db: RpcClient, tenantId: string, today: Date): Promise<{ titles: number; computers: number }> {
  const pairs: Pair[] = [];
  for (let after: Pair | null = null; ; ) {
    const page: Pair[] = (await call<Pair[]>(db, "eol_inputs", {
      p_tenant_id: tenantId,
      p_after_title: after?.title_id ?? null,
      p_after_version: after?.version ?? null,
      p_limit: PAGE,
    })) ?? [];
    pairs.push(...page);
    if (page.length < PAGE) break;
    after = page[page.length - 1];
  }
  const os = (await call<OsRow[]>(db, "eol_os_inputs", { p_tenant_id: tenantId })) ?? [];
  const keys = [...new Set([...pairs.map((p) => p.product_key), ...(os.some((o) => o.platform === "windows") ? ["os:windows"] : []), ...(os.some((o) => o.platform === "macos") ? ["os:macos"] : [])])];
  const cache = keys.length > 0 ? await loadReleases(db, keys) : new Map<string, EolRelease[]>();

  const titles: { title_id: string; version: string; product_key: string; release: string; eol_from: string | null; status: SupportStatus }[] = [];
  for (const p of pairs) {
    const release = matchRelease(p.version, cache.get(p.product_key) ?? []);
    if (release) titles.push({ title_id: p.title_id, version: p.version, product_key: p.product_key, release: release.name, eol_from: release.eol_from, status: supportStatus(release, today) });
  }
  const computers: { computer_id: string; release: string; eol_from: string | null; status: SupportStatus }[] = [];
  for (const c of os) {
    const release =
      c.platform === "windows" ? windowsRelease(c.os_name, c.os_build, cache.get("os:windows") ?? []) : c.platform === "macos" ? macosRelease(c.os_version, cache.get("os:macos") ?? []) : null;
    if (release) computers.push({ computer_id: c.computer_id, release: release.name, eol_from: release.eol_from, status: supportStatus(release, today) });
  }
  await call(db, "eol_replace", { p_tenant_id: tenantId, p_titles: titles, p_computers: computers });
  return { titles: titles.length, computers: computers.length };
}

export async function runEolEvaluation(db: RpcClient, opts: { timeLeft: () => number; today?: Date }): Promise<EolRunSummary> {
  const summary: EolRunSummary = { tenants: 0, titles: 0, computers: 0, complete: true, errors: [] };
  const due = (await call<{ tenant_id: string }[]>(db, "eol_due_tenants")) ?? [];
  for (const { tenant_id } of due) {
    if (opts.timeLeft() < MIN_TIME_LEFT_MS) {
      summary.complete = false;
      break;
    }
    try {
      const r = await runTenant(db, tenant_id, opts.today ?? new Date());
      summary.tenants++;
      summary.titles += r.titles;
      summary.computers += r.computers;
    } catch (error) {
      summary.errors.push(`${tenant_id}: ${(error as Error).message}`);
    }
  }
  return summary;
}
