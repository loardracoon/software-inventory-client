// Known vulnerabilities (Phase 10b): read models from *_vulnerabilities.sql. The CVE data comes from the
// Dictionary Hub; the matches against installed versions are computed in this app.
import type { Database } from "@/integrations/supabase/types";
import { db, orThrow } from "@/lib/supabase-query";
import { likePattern, type Page, type PageRequest, type TitleKind } from "@/features/inventory/api";

type Functions = Database["public"]["Functions"];

export type TitleVulnRow = Functions["title_vulns"]["Returns"][number];
export type VulnEventRow = Database["public"]["Views"]["v_vuln_events"]["Row"];
export type VulnFilter = "" | "any" | "kev" | "critical" | "high";

export const VULN_FILTERS: { value: VulnFilter; label: string }[] = [
  { value: "", label: "Any" },
  { value: "any", label: "Has known CVEs" },
  { value: "high", label: "Critical or high" },
  { value: "critical", label: "Critical" },
  { value: "kev", label: "Known exploited (KEV)" },
];

export const vulnFromParam = (v: string | null): VulnFilter => (VULN_FILTERS.some((f) => f.value === v) ? (v as VulnFilter) : "");

export type VulnOverview = {
  vulns: number;
  critical: number;
  high: number;
  kev: number;
  titles: number;
  kev_installations: number;
  kev_computers: number;
  cached: number;
  synced_at: string | null;
  evaluated_at: string | null;
};

export async function fetchVulnOverview(tenantId: string | null): Promise<VulnOverview> {
  return orThrow(await db().rpc("vuln_overview", tenantId ? { p_tenant_id: tenantId } : {})) as unknown as VulnOverview;
}

export async function fetchTitleVulns(titleId: string, tenantId: string | null): Promise<TitleVulnRow[]> {
  return orThrow(await db().rpc("title_vulns", { p_title_id: titleId, ...(tenantId ? { p_tenant_id: tenantId } : {}) })) ?? [];
}

export type VulnEventFilters = { tenantId: string | null; kind: TitleKind | ""; search: string; from: string | null; to: string | null };

export async function fetchVulnEvents(filters: VulnEventFilters, request: PageRequest): Promise<Page<VulnEventRow>> {
  let q = db().from("v_vuln_events").select("*", { count: "exact" });
  if (filters.tenantId) q = q.eq("tenant_id", filters.tenantId);
  if (filters.kind) q = q.eq("kind", filters.kind);
  if (filters.search.trim()) {
    const p = likePattern(filters.search);
    q = q.or(`canonical_name.ilike.${p},vuln_id.ilike.${p}`);
  }
  if (filters.from) q = q.gte("detected_at", filters.from);
  if (filters.to) q = q.lte("detected_at", filters.to);
  const from = request.pageIndex * request.pageSize;
  const { data, error, count } = await q
    .order("detected_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + request.pageSize - 1)
    .abortSignal(request.signal);
  if (error) throw new Error(error.message);
  return { rows: data ?? [], rowCount: count ?? 0 };
}

export const nvdUrl = (id: string) => (id.startsWith("CVE-") ? `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(id)}` : `https://osv.dev/vulnerability/${encodeURIComponent(id)}`);
