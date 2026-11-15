// Known vulnerabilities (Phase 10b): read models from *_vulnerabilities.sql. The CVE data comes from the
// Dictionary Hub; the matches against installed versions are computed in this app.
import type { Database } from "@/integrations/supabase/types";
import { db, orThrow } from "@/lib/supabase-query";
import { likePattern, type Page, type PageRequest, type TitleKind } from "@/features/inventory/api";

type Functions = Database["public"]["Functions"];

export type TitleVulnRow = Functions["title_vulns"]["Returns"][number];
export type VulnEventRow = Database["public"]["Views"]["v_vuln_events"]["Row"];
export type VulnFilter = "" | "any" | "kev" | "critical" | "high" | "possible";

export const VULN_FILTERS: { value: VulnFilter; label: string }[] = [
  { value: "", label: "Any" },
  { value: "any", label: "Has known CVEs" },
  { value: "high", label: "Critical or high" },
  { value: "critical", label: "Critical" },
  { value: "kev", label: "Known exploited (KEV)" },
  { value: "possible", label: "May apply (no version to compare)" },
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
  possible: number;
  possible_titles: number;
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

// Remediation findings (Stage 3): one row per vulnerability with its due date, from v_vuln_findings.
export type FindingRow = Database["public"]["Views"]["v_vuln_findings"]["Row"];
export type FindingStatus = "" | "open" | "overdue" | "resolved_in_time" | "resolved_late";
export type FindingFilters = { tenantId: string | null; status: FindingStatus; severity: string; kev: boolean; search: string };

export const FINDING_STATUS_LABEL: Record<Exclude<FindingStatus, "">, string> = {
  open: "Open",
  overdue: "Overdue",
  resolved_in_time: "Resolved in time",
  resolved_late: "Resolved late",
};

// "5 days left", "due today", "3 days overdue"; resolved findings show how long they took.
export function dueLabel(f: Pick<FindingRow, "status" | "due_at" | "days_open">, now = Date.now()): string {
  if (f.status?.startsWith("resolved")) return `Resolved after ${f.days_open} day${f.days_open === 1 ? "" : "s"}`;
  const days = Math.ceil((new Date(f.due_at ?? 0).getTime() - now) / 86_400_000);
  if (days > 0) return `${days} day${days === 1 ? "" : "s"} left`;
  if (days === 0) return "Due today";
  return `${-days} day${days === -1 ? "" : "s"} overdue`;
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}`.replace(/"/g, '""').replace(/^(.*)$/s, '"$1"') : /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function findingsToCsv(rows: FindingRow[]): string {
  const head = ["vuln_id", "software", "version", "severity", "kev", "status", "first_seen_at", "due_at", "resolved_at", "days_open", "computers"];
  const lines = rows.map((r) => [r.vuln_id, r.canonical_name, r.version, r.severity, r.kev, r.status, r.first_seen_at, r.due_at, r.resolved_at, r.days_open, r.computers].map(csvCell).join(","));
  return [head.join(","), ...lines].join("\r\n");
}

export async function fetchFindings(filters: FindingFilters, request: PageRequest): Promise<Page<FindingRow>> {
  let q = db().from("v_vuln_findings").select("*", { count: "exact" });
  if (filters.tenantId) q = q.eq("tenant_id", filters.tenantId);
  if (filters.status) q = q.eq("status", filters.status);
  else q = q.is("resolved_at", null);
  if (filters.severity) q = q.eq("severity", filters.severity);
  if (filters.kev) q = q.eq("kev", true);
  if (filters.search.trim()) {
    const p = likePattern(filters.search);
    q = q.or(`canonical_name.ilike.${p},vuln_id.ilike.${p}`);
  }
  const from = request.pageIndex * request.pageSize;
  const { data, error, count } = await q.order("due_at").range(from, from + request.pageSize - 1);
  if (error) throw new Error(error.message);
  return { rows: data ?? [], rowCount: count ?? 0 };
}

export type OverdueSummary = { overdue: number; critical: number; high: number };

export async function fetchOverdueSummary(tenantId: string | null): Promise<OverdueSummary> {
  const count = async (severity?: string) => {
    let q = db().from("v_vuln_findings").select("id", { count: "exact", head: true }).eq("status", "overdue");
    if (tenantId) q = q.eq("tenant_id", tenantId);
    if (severity) q = q.eq("severity", severity);
    const { error, count: n } = await q;
    if (error) throw new Error(error.message);
    return n ?? 0;
  };
  const [overdue, critical, high] = await Promise.all([count(), count("CRITICAL"), count("HIGH")]);
  return { overdue, critical, high };
}
