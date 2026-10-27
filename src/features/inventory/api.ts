// Read models for the screens (views and RPCs from *_screen_queries.sql). Lists page, sort and
// filter on the server; tenantId null = every tenant the user can see.
import type { SortingState } from "@tanstack/react-table";
import type { Database } from "@/integrations/supabase/types";
import { db, orThrow } from "@/lib/supabase-query";

type Views = Database["public"]["Views"];
type Functions = Database["public"]["Functions"];

export type ComputerRow = Views["v_computer_list"]["Row"];
export type InstallationRow = Views["v_installation_details"]["Row"];
export type ChangeRow = Views["v_change_log"]["Row"];
export type RetryRow = Views["v_retry_queue"]["Row"];
export type RunRow = Views["v_recent_runs"]["Row"];
export type TitleRow = Functions["search_titles"]["Returns"][number];
export type CycleRow = Functions["cycle_overview"]["Returns"][number];
export type AttentionRow = Functions["needs_attention"]["Returns"][number];
export type WeekRow = Functions["weekly_changes"]["Returns"][number];
export type BudgetRow = Functions["budget_overview"]["Returns"][number];
export type CategoryRow = Database["public"]["Tables"]["categories_cache"]["Row"];
export type Platform = Database["public"]["Enums"]["platform"];
export type TitleKind = Database["public"]["Enums"]["title_kind"];
export type AttentionLevel = Database["public"]["Enums"]["attention_level"];

export type Page<T> = { rows: T[]; rowCount: number };
export type PageRequest = { pageIndex: number; pageSize: number; sorting: SortingState; signal: AbortSignal };

export type OverviewStats = {
  computers: number;
  computers_by_platform: Record<string, number>;
  coverage_pct: number | null;
  titles: number;
  extension_installs: number;
  distinct_extensions: number;
  package_installs: number;
  package_managers: string[];
  changes_7d: number;
  added_7d: number;
  updated_7d: number;
  removed_7d: number;
};

const range = (r: PageRequest) => [r.pageIndex * r.pageSize, r.pageIndex * r.pageSize + r.pageSize - 1] as const;

// PostgREST "ilike" pattern; strips characters that have a meaning in filter syntax.
export function likePattern(text: string): string {
  return `%${text.replace(/[%_,()*\\]/g, " ").trim()}%`;
}

// Overview -----------------------------------------------------------------------------------------

export async function fetchOverviewStats(tenantId: string | null): Promise<OverviewStats> {
  return orThrow(await db().rpc("overview_stats", tenantId ? { p_tenant_id: tenantId } : {})) as unknown as OverviewStats;
}

export async function fetchWeeklyChanges(tenantId: string | null, weeks = 12): Promise<WeekRow[]> {
  return orThrow(await db().rpc("weekly_changes", { ...(tenantId ? { p_tenant_id: tenantId } : {}), p_weeks: weeks })) ?? [];
}

export async function fetchCycleOverview(tenantId: string | null): Promise<CycleRow[]> {
  return orThrow(await db().rpc("cycle_overview", tenantId ? { p_tenant_id: tenantId } : {})) ?? [];
}

export async function fetchNeedsAttention(tenantId: string | null, limit = 8): Promise<AttentionRow[]> {
  return orThrow(await db().rpc("needs_attention", { ...(tenantId ? { p_tenant_id: tenantId } : {}), p_limit: limit })) ?? [];
}

export async function fetchLatestChanges(tenantId: string | null, limit = 8): Promise<ChangeRow[]> {
  let q = db().from("v_change_log").select("*").order("detected_at", { ascending: false }).limit(limit);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  return orThrow(await q) ?? [];
}

export async function fetchCategories() {
  return orThrow(await db().from("categories_cache").select("slug, name, parent_slug, level").eq("deprecated", false).order("name")) ?? [];
}

export async function fetchLevel1Categories(): Promise<CategoryRow[]> {
  return orThrow(await db().from("categories_cache").select("*").eq("level", 1).eq("deprecated", false).order("name")) ?? [];
}

// Computers ----------------------------------------------------------------------------------------

export type ComputerFilters = {
  tenantId: string | null;
  status: "all" | "collected" | "retry_scheduled" | "error";
  platform: Platform | "";
  category: string; // level-1 slug among attention categories
  search: string;
};

const COMPUTER_SORT = new Set(["hostname", "associated_user", "last_collected_at", "cycle_status", "programs", "extensions", "packages", "platform"]);

export async function fetchComputers(filters: ComputerFilters, request: PageRequest): Promise<Page<ComputerRow>> {
  const sort = request.sorting[0];
  let q = db().from("v_computer_list").select("*", { count: "exact" }).is("retired_at", null);
  if (filters.tenantId) q = q.eq("tenant_id", filters.tenantId);
  if (filters.status !== "all") q = q.eq("cycle_status", filters.status);
  if (filters.platform) q = q.eq("platform", filters.platform);
  if (filters.category) q = q.contains("attention_level1_slugs", [filters.category]);
  if (filters.search.trim()) {
    const p = likePattern(filters.search);
    q = q.or(`hostname.ilike.${p},associated_user.ilike.${p},os_name.ilike.${p}`);
  }
  q = q.order(sort && COMPUTER_SORT.has(sort.id) ? sort.id : "hostname", { ascending: sort ? !sort.desc : true, nullsFirst: false });
  const [from, to] = range(request);
  const { data, error, count } = await q.range(from, to).abortSignal(request.signal);
  if (error) throw new Error(error.message);
  return { rows: data ?? [], rowCount: count ?? 0 };
}

export async function fetchComputer(id: string): Promise<ComputerRow | null> {
  return orThrow(await db().from("v_computer_list").select("*").eq("id", id).maybeSingle());
}

export async function fetchComputerTasks(id: string) {
  return orThrow(await db().rpc("computer_cycle_tasks", { p_computer_id: id })) ?? [];
}

export async function fetchHardware(computerId: string, asOf: string | null) {
  let q = db().from("hardware_versions").select("domain, item_key, attrs, valid_from, valid_to").eq("computer_id", computerId);
  q = asOf ? q.lte("valid_from", asOf).or(`valid_to.is.null,valid_to.gt.${asOf}`) : q.is("valid_to", null);
  return orThrow(await q.order("domain").order("item_key")) ?? [];
}

export type InventoryDomain = Database["public"]["Enums"]["inventory_domain"];
export type InstallationFilters = { tenantId?: string | null; computerId?: string; titleId?: string; domains?: InventoryDomain[]; asOf: string | null; search?: string };

const INSTALLATION_SORT = new Set(["canonical_name", "version", "hostname", "username", "source", "valid_from", "level2_name"]);

export async function fetchInstallations(filters: InstallationFilters, request: PageRequest): Promise<Page<InstallationRow>> {
  const sort = request.sorting[0];
  let q = db().from("v_installation_details").select("*", { count: "exact" });
  if (filters.tenantId) q = q.eq("tenant_id", filters.tenantId);
  if (filters.computerId) q = q.eq("computer_id", filters.computerId);
  if (filters.titleId) q = q.eq("title_id", filters.titleId);
  if (filters.domains?.length) q = q.in("domain", filters.domains);
  q = filters.asOf ? q.lte("valid_from", filters.asOf).or(`valid_to.is.null,valid_to.gt.${filters.asOf}`) : q.is("valid_to", null);
  if (filters.search?.trim()) {
    const p = likePattern(filters.search);
    q = q.or(`canonical_name.ilike.${p},vendor.ilike.${p},external_id.ilike.${p}`);
  }
  q = q.order(sort && INSTALLATION_SORT.has(sort.id) ? sort.id : "canonical_name", { ascending: sort ? !sort.desc : true, nullsFirst: false });
  const [from, to] = range(request);
  const { data, error, count } = await q.range(from, to).abortSignal(request.signal);
  if (error) throw new Error(error.message);
  return { rows: data ?? [], rowCount: count ?? 0 };
}

export async function scanNow(computerId: string): Promise<number> {
  return orThrow(await db().rpc("scan_now", { p_computer_id: computerId })) as number;
}

// Software -----------------------------------------------------------------------------------------

export type SoftwareFilters = {
  tenantId: string | null;
  query: string;
  kind: TitleKind | "";
  category: string; // level-1 or level-2 slug
  attention: AttentionLevel[];
  source: string;
  platform: Platform | "";
  user: string;
  versionBelow: string;
  asOf: string | null;
};

const TITLE_SORT = new Set(["computers", "versions", "first_seen", "canonical_name"]);

export async function searchTitles(filters: SoftwareFilters, request: PageRequest): Promise<Page<TitleRow>> {
  const sort = request.sorting[0];
  const { data, error } = await db()
    .rpc("search_titles", {
      ...(filters.tenantId ? { p_tenant_id: filters.tenantId } : {}),
      ...(filters.query.trim() ? { p_query: filters.query.trim() } : {}),
      ...(filters.kind ? { p_kind: filters.kind } : {}),
      ...(filters.category ? { p_category: filters.category } : {}),
      ...(filters.attention.length ? { p_attention: filters.attention } : {}),
      ...(filters.source ? { p_source: filters.source } : {}),
      ...(filters.platform ? { p_platform: filters.platform } : {}),
      ...(filters.user.trim() ? { p_user: filters.user.trim() } : {}),
      ...(filters.versionBelow.trim() ? { p_version_below: filters.versionBelow.trim() } : {}),
      ...(filters.asOf ? { p_as_of: filters.asOf } : {}),
      p_sort: sort && TITLE_SORT.has(sort.id) ? sort.id : "computers",
      p_desc: sort ? sort.desc : true,
      p_limit: request.pageSize,
      p_offset: request.pageIndex * request.pageSize,
    })
    .abortSignal(request.signal);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return { rows, rowCount: rows[0]?.total_count ?? 0 };
}

export async function fetchTitle(titleId: string) {
  const [title, classification] = await Promise.all([
    db().from("software_titles").select("*").eq("id", titleId).maybeSingle(),
    db().from("title_classification").select("*").eq("title_id", titleId).maybeSingle(),
  ]);
  return { title: orThrow(title), classification: orThrow(classification) };
}

export async function fetchTitleVersions(titleId: string, tenantId: string | null) {
  return orThrow(await db().rpc("title_versions", { p_title_id: titleId, ...(tenantId ? { p_tenant_id: tenantId } : {}) })) ?? [];
}

// Changes ------------------------------------------------------------------------------------------

export type ChangeFilters = {
  tenantId: string | null;
  change: "" | "added" | "updated" | "removed";
  kind: TitleKind | "";
  category: string; // level-1 slug
  from: string | null; // ISO instants
  to: string | null;
  search: string;
  computerId?: string;
  titleId?: string;
};

const CHANGE_SORT = new Set(["detected_at", "hostname", "canonical_name", "change"]);

export async function fetchChanges(filters: ChangeFilters, request: PageRequest): Promise<Page<ChangeRow>> {
  const sort = request.sorting[0];
  let q = db().from("v_change_log").select("*", { count: "exact" });
  if (filters.tenantId) q = q.eq("tenant_id", filters.tenantId);
  if (filters.change) q = q.eq("change", filters.change);
  if (filters.kind) q = q.eq("kind", filters.kind);
  if (filters.category) q = q.like("category_slug", `${filters.category}/%`);
  if (filters.from) q = q.gte("detected_at", filters.from);
  if (filters.to) q = q.lte("detected_at", filters.to);
  if (filters.computerId) q = q.eq("computer_id", filters.computerId);
  if (filters.titleId) q = q.eq("title_id", filters.titleId);
  if (filters.search.trim()) {
    const p = likePattern(filters.search);
    q = q.or(`canonical_name.ilike.${p},hostname.ilike.${p},external_id.ilike.${p}`);
  }
  q = q.order(sort && CHANGE_SORT.has(sort.id) ? sort.id : "detected_at", { ascending: sort ? !sort.desc : false });
  const [from, to] = range(request);
  const { data, error, count } = await q.range(from, to).abortSignal(request.signal);
  if (error) throw new Error(error.message);
  return { rows: data ?? [], rowCount: count ?? 0 };
}

// Scans --------------------------------------------------------------------------------------------

export async function fetchBudget(tenantId: string | null): Promise<BudgetRow[]> {
  return orThrow(await db().rpc("budget_overview", tenantId ? { p_tenant_id: tenantId } : {})) ?? [];
}

export async function fetchRetryQueue(tenantId: string | null, request: PageRequest): Promise<Page<RetryRow>> {
  let q = db().from("v_retry_queue").select("*", { count: "exact" });
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const [from, to] = range(request);
  const { data, error, count } = await q.order("next_attempt_at").order("hostname").range(from, to).abortSignal(request.signal);
  if (error) throw new Error(error.message);
  return { rows: data ?? [], rowCount: count ?? 0 };
}

export async function fetchRecentRuns(tenantId: string | null, request: PageRequest): Promise<Page<RunRow>> {
  let q = db().from("v_recent_runs").select("*", { count: "exact" });
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const [from, to] = range(request);
  const { data, error, count } = await q.order("started_at", { ascending: false }).range(from, to).abortSignal(request.signal);
  if (error) throw new Error(error.message);
  return { rows: data ?? [], rowCount: count ?? 0 };
}

export type ScanSettings = Database["public"]["Tables"]["scan_settings"]["Row"];

export async function fetchScanSettings(tenantId: string): Promise<ScanSettings | null> {
  return orThrow(await db().from("scan_settings").select("*").eq("tenant_id", tenantId).maybeSingle());
}

const EDITABLE_SETTINGS = [
  "cycle_weekday", "cycle_time", "retry_time", "timezone", "batch_size", "max_active_runs", "runs_per_minute",
  "daily_run_limit", "reserve_pct", "run_grace_minutes", "provider",
] as const;

// Only the editable columns; updated_at and updated_by are set by the database trigger.
export async function saveScanSettings(tenantId: string, values: Partial<ScanSettings>): Promise<void> {
  const changes = Object.fromEntries(EDITABLE_SETTINGS.filter((k) => values[k] !== undefined).map((k) => [k, values[k]])) as Database["public"]["Tables"]["scan_settings"]["Update"];
  orThrow(await db().from("scan_settings").update(changes).eq("tenant_id", tenantId));
}
