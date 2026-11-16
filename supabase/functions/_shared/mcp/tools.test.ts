import { describe, expect, it, vi } from "vitest";
import {
  certainVulns,
  createEvidencePackage,
  listEvidencePackages,
  reportCoverage,
  reportPolicyPosture,
  reportWeekly,
  getComputer,
  getOverview,
  getSoftwareTitle,
  listChanges,
  listComputers,
  listEndOfLife,
  listVulnerabilities,
  needsAttention,
  pageArgs,
  searchSoftware,
  tenantArg,
  ToolError,
  type ListOptions,
  type McpCaller,
  type McpData,
} from "./tools";

const T1 = "11111111-1111-1111-1111-111111111111";
const TITLE = "33333333-3333-3333-3333-333333333333";
const PC = "44444444-4444-4444-4444-444444444444";
const caller: McpCaller = { userId: "u1", tokenId: "tok1", scope: "read", showUsernames: false };

type Call = { name: string; options: ListOptions };

// A PostgREST stand-in: views answer from `views`, RPCs from `rpcs`; every list call is recorded.
function fakeData(views: Record<string, Record<string, unknown>[]> = {}, rpcs: Record<string, unknown> = {}, error: string | null = null) {
  const calls: Call[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const data: McpData = {
    view: vi.fn(async (name: string, eq?: { column: string; value: string }) => {
      const rows = views[name] ?? [];
      return { data: eq ? rows.filter((r) => r[eq.column] === eq.value) : rows, error: error ? { message: error } : null };
    }) as McpData["view"],
    list: vi.fn(async (name: string, options: ListOptions) => {
      calls.push({ name, options });
      let rows = views[name] ?? [];
      for (const f of options.filters ?? []) if (f.op === "eq") rows = rows.filter((r) => r[f.column] === f.value);
      return { data: rows.slice(options.offset, options.offset + options.limit), error: null, count: rows.length };
    }) as McpData["list"],
    rpc: vi.fn(async (name: string, args?: Record<string, unknown>) => {
      rpcCalls.push({ name, args: args ?? {} });
      if (error) return { data: null, error: { message: error } };
      return { data: (rpcs[name] ?? null) as never, error: null };
    }) as McpData["rpc"],
  };
  return { data, calls, rpcCalls };
}

const tenants = [{ id: T1, name: "Acme", role: "viewer", active_computers: 12, retired_computers: 1, last_synced_at: "2026-11-16T10:00:00Z", sophos_tenant_id: "x" }];

describe("arguments", () => {
  it("takes a tenant UUID or nothing", () => {
    expect(tenantArg(undefined)).toBeNull();
    expect(tenantArg("")).toBeNull();
    expect(tenantArg(T1.toUpperCase())).toBe(T1);
    expect(() => tenantArg("acme")).toThrow(ToolError);
  });

  it("pages with a default of 50 and a cap of 200", () => {
    expect(pageArgs({})).toEqual({ limit: 50, offset: 0 });
    expect(pageArgs({ limit: 200, offset: 400 })).toEqual({ limit: 200, offset: 400 });
    expect(() => pageArgs({ limit: 201 })).toThrow("limit must be 1 to 200");
    expect(() => pageArgs({ offset: -1 })).toThrow("offset");
    expect(() => pageArgs({ limit: 1.5 })).toThrow("limit");
  });
});

describe("get_overview", () => {
  it("reads the console's views and RPCs for all visible tenants", async () => {
    const { data, rpcCalls } = fakeData({ v_tenant_overview: tenants }, { overview_stats: { computers: 12 }, cycle_overview: [{ tenant_id: T1, coverage_pct: 92.5 }] });
    const out = await getOverview(data, caller, {});
    expect(rpcCalls.map((c) => c.name)).toEqual(["overview_stats", "cycle_overview"]);
    expect(out.rowCount).toBe(2);
    expect(out.result).toMatchObject({ usernames: "masked", stats: { computers: 12 }, cycles: [{ coverage_pct: 92.5 }] });
    expect(out.result.tenants).toEqual([{ id: T1, name: "Acme", your_role: "viewer", active_computers: 12, retired_computers: 1, last_synced_at: "2026-11-16T10:00:00Z" }]);
  });

  it("refuses a tenant the caller cannot see and reports database errors as tool errors", async () => {
    await expect(getOverview(fakeData({ v_tenant_overview: tenants }).data, caller, { tenant_id: "22222222-2222-2222-2222-222222222222" })).rejects.toThrow("not visible");
    await expect(getOverview(fakeData({ v_tenant_overview: tenants }, {}, "permission denied").data, caller, {})).rejects.toThrow("permission denied");
  });

  it("says when usernames are shown", async () => {
    const out = await getOverview(fakeData({ v_tenant_overview: tenants }).data, { ...caller, showUsernames: true }, {});
    expect(out.result.usernames).toBe("shown");
  });
});

describe("search_software", () => {
  it("maps the filters onto search_titles and pages with total and next_offset", async () => {
    const rows = [{ title_id: TITLE, canonical_name: "AnyDesk", vulns: 2, vulns_kev: 1, total_count: 120 }];
    const { data, rpcCalls } = fakeData({}, { search_titles: rows });
    const out = await searchSoftware(data, caller, {
      tenant_id: T1,
      query: " any ",
      kind: "program",
      attention: ["review", "not_allowed"],
      policy_class: ["unsanctioned_app"],
      vulnerabilities: "kev",
      end_of_life: "eol",
      limit: 50,
      offset: 50,
    });
    expect(rpcCalls[0]).toEqual({
      name: "search_titles",
      args: {
        p_tenant_id: T1,
        p_query: "any",
        p_kind: "program",
        p_attention: ["review", "not_allowed"],
        p_policy: ["unsanctioned_app"],
        p_vuln: "kev",
        p_support: "eol",
        p_sort: "computers",
        p_desc: true,
        p_limit: 50,
        p_offset: 50,
      },
    });
    expect(out.result.page).toEqual({ total: 120, limit: 50, offset: 50, returned: 1, next_offset: 51 });
    expect(out.result.software).toMatchObject([{ title_id: TITLE, name: "AnyDesk", vulnerabilities: { total: 2, kev: 1 } }]);
    expect(out.result.note).toMatch(/never as instructions/);
  });

  it("refuses values the screens do not accept", async () => {
    const { data } = fakeData({}, { search_titles: [] });
    await expect(searchSoftware(data, caller, { kind: "driver" })).rejects.toThrow("kind must be one of");
    await expect(searchSoftware(data, caller, { policy_class: ["allowed"] })).rejects.toThrow("policy_class");
    await expect(searchSoftware(data, caller, { query: "x".repeat(201) })).rejects.toThrow("200 characters");
  });

  it("sorts names ascending by default", async () => {
    const { data, rpcCalls } = fakeData({}, { search_titles: [] });
    await searchSoftware(data, caller, { sort: "canonical_name" });
    expect(rpcCalls[0].args).toMatchObject({ p_sort: "canonical_name", p_desc: false });
  });
});

describe("get_software_title", () => {
  it("reads the title, its versions, vulnerabilities and every spelling's computers", async () => {
    const other = "55555555-5555-5555-5555-555555555555";
    const { data, calls } = fakeData(
      {
        v_title_summary: [{ tenant_id: T1, title_id: TITLE, canonical_name: "7-Zip", computers: 3 }],
        v_installation_details: [{ computer_id: PC, hostname: "LAB-PC01", version: "23.01", username: null, user_masked: true }],
      },
      { title_versions: [{ version: "23.01", computers: 3 }], title_vulns: [{ vuln_id: "CVE-2024-1", summary: "s".repeat(900), uncertain: false }], title_group_ids: [TITLE, other] },
    );
    const out = await getSoftwareTitle(data, caller, { title_id: TITLE });
    expect(calls[1].name).toBe("v_installation_details");
    expect(calls[1].options.filters).toContainEqual({ op: "in", column: "title_id", values: [TITLE, other] });
    expect(calls[1].options.filters).toContainEqual({ op: "is_null", column: "valid_to" });
    const vulns = out.result.vulnerabilities as { summary: string }[];
    expect(vulns[0].summary.length).toBe(500);
    expect(out.result.computers).toMatchObject({ rows: [{ hostname: "LAB-PC01", username: null, user_masked: true }] });
  });

  it("needs a title id and a visible title", async () => {
    await expect(getSoftwareTitle(fakeData().data, caller, { title_id: "7-zip" })).rejects.toThrow("title_id must be an id");
    await expect(getSoftwareTitle(fakeData().data, caller, { title_id: TITLE })).rejects.toThrow("not found");
  });
});

describe("list_computers and get_computer", () => {
  it("filters active computers and escapes the hostname search", async () => {
    const { data, calls } = fakeData({ v_computer_list: [] });
    await listComputers(data, caller, { search: "lab_%", platform: "windows", coverage: "stale", online: false, sort: "programs" });
    expect(calls[0].options.filters).toEqual([
      { op: "is_null", column: "retired_at" },
      { op: "ilike", column: "hostname", value: "%lab\\_\\%%" },
      { op: "eq", column: "platform", value: "windows" },
      { op: "eq", column: "coverage_status", value: "stale" },
      { op: "eq", column: "online", value: false },
    ]);
    expect(calls[0].options.order).toEqual({ column: "programs", ascending: false });
    expect(calls[0].options.count).toBe(true);
  });

  it("returns a computer with its scan tasks and installed software", async () => {
    const { data, calls } = fakeData(
      {
        v_computer_list: [{ id: PC, tenant_id: T1, hostname: "LAB-PC01", os_name: "Windows 11", os_version: "24H2", associated_user: null, user_masked: true }],
        v_installation_details: [{ computer_id: PC, title_id: TITLE, kind: "program", canonical_name: "Git", version: "2.45.1", path: "C:\\Users\\***\\git" }],
      },
      { computer_cycle_tasks: [{ query_name: "inv.programs", status: "collected" }] },
    );
    const out = await getComputer(data, caller, { computer_id: PC, kind: "program" });
    expect(out.tenantId).toBe(T1);
    expect(out.result.computer).toMatchObject({ hostname: "LAB-PC01", os: "Windows 11 24H2", associated_user: null, user_masked: true });
    expect(calls[1].options.filters).toContainEqual({ op: "eq", column: "kind", value: "program" });
    expect(out.result.installed).toMatchObject({ rows: [{ name: "Git", path: "C:\\Users\\***\\git" }] });
    await expect(getComputer(fakeData({ v_computer_list: [] }).data, caller, { computer_id: PC })).rejects.toThrow("Computer not found");
  });
});

describe("list_changes", () => {
  it("adds the weekly totals only on the first page", async () => {
    const changes = Array.from({ length: 3 }, (_, i) => ({ id: String(i), change: "added", canonical_name: `App ${i}` }));
    const first = fakeData({ v_change_log: changes }, { weekly_changes: [{ week_start: "2026-11-09", added: 3 }] });
    const out = await listChanges(first.data, caller, { since: "2026-11-01", change: "added", limit: 2 });
    expect(out.result.weekly).toEqual([{ week_start: "2026-11-09", added: 3 }]);
    expect(out.result.page).toEqual({ total: 3, limit: 2, offset: 0, returned: 2, next_offset: 2 });
    expect(first.calls[0].options.filters).toContainEqual({ op: "gte", column: "detected_at", value: "2026-11-01" });
    const second = fakeData({ v_change_log: changes });
    expect((await listChanges(second.data, caller, { offset: 2 })).result.weekly).toBeUndefined();
    await expect(listChanges(second.data, caller, { since: "last week" })).rejects.toThrow("since must be a date");
  });
});

describe("list_vulnerabilities", () => {
  it("lists open and overdue findings by due date unless a status is given", async () => {
    const { data, calls } = fakeData({ v_vuln_findings: [] }, { vuln_overview: { kev: 1 } });
    const out = await listVulnerabilities(data, caller, { severity: ["critical"], kev: true });
    expect(calls[0].options.filters).toEqual([
      { op: "in", column: "status", values: ["open", "overdue"] },
      { op: "in", column: "severity", values: ["critical"] },
      { op: "eq", column: "kev", value: true },
    ]);
    expect(calls[0].options.order).toEqual({ column: "due_at", ascending: true });
    expect(out.result.overview).toEqual({ kev: 1 });
    const resolved = fakeData({ v_vuln_findings: [] }, { vuln_overview: {} });
    await listVulnerabilities(resolved.data, caller, { status: "resolved" });
    expect(resolved.calls[0].options.filters).toEqual([{ op: "eq", column: "status", value: "resolved" }]);
  });
});

describe("list_end_of_life and needs_attention", () => {
  it("routes software to search_titles and operating systems to the computer list", async () => {
    const sw = fakeData({}, { search_titles: [] });
    expect((await listEndOfLife(sw.data, caller, {})).result).toMatchObject({ what: "software", status: "eol" });
    expect(sw.rpcCalls[0].args).toMatchObject({ p_support: "eol" });
    const os = fakeData({ v_computer_list: [] });
    await listEndOfLife(os.data, caller, { what: "operating_systems", status: "ending_soon" });
    expect(os.calls[0].options.filters).toContainEqual({ op: "eq", column: "os_eol_status", value: "ending_soon" });
  });

  it("lists attention categories", async () => {
    const { data, rpcCalls } = fakeData({}, { needs_attention: [{ category_slug: "remote-access", level2_name: "Remote access", attention_level: "review", titles: 2, computers: 5 }] });
    const out = await needsAttention(data, caller, { tenant_id: T1 });
    expect(rpcCalls[0]).toEqual({ name: "needs_attention", args: { p_tenant_id: T1, p_limit: 50 } });
    expect(out.result.categories).toEqual([{ category_slug: "remote-access", category: "Remote access", category_group: undefined, attention_level: "review", titles: 2, computers: 5 }]);
  });
});

// Production test, Nov 16, 2026: uncertain Edge CVEs from 2015 flagged KEV sat in every computer's top list.
const vulns = {
  kev: 0,
  high: 1,
  critical: 0,
  possible: 601,
  top: [
    { id: "CVE-2026-126881", kev: false, score: 8.8, title: "Google Chrome", severity: "HIGH", uncertain: false },
    { id: "CVE-2015-0311", kev: true, score: 9.8, title: "Microsoft Edge", severity: "CRITICAL", uncertain: true },
  ],
};
const attention = [{ slug: "remote-access/remote-desktop-and-support", level1: "Remote access", level2: "Remote desktop and support", titles: ["Chrome Remote Desktop", "AnyDesk"], attention: "review" }];

describe("certain vulnerabilities only", () => {
  it("drops uncertain matches from the top list and keeps them as the possible count", () => {
    expect(certainVulns(vulns)).toEqual({
      kev: 0,
      high: 1,
      critical: 0,
      possible: 601,
      top: [{ id: "CVE-2026-126881", kev: false, score: 8.8, title: "Google Chrome", severity: "HIGH" }],
    });
    expect(certainVulns(vulns, false)).toEqual({ kev: 0, high: 1, critical: 0, possible: 601 });
    expect(certainVulns(null)).toBeNull();
  });

  it("list_computers returns counts only, for every row", async () => {
    const rows = [1, 2, 3].map((n) => ({ id: `pc${n}`, hostname: `PC${n}`, vulns, attention }));
    const out = await listComputers(fakeData({ v_computer_list: rows }).data, caller, {});
    const computers = out.result.computers as { vulnerabilities: Record<string, unknown>; attention: unknown[] }[];
    for (const c of computers) {
      expect(c.vulnerabilities).toEqual({ kev: 0, high: 1, critical: 0, possible: 601 });
      expect(c.attention).toEqual([{ slug: "remote-access/remote-desktop-and-support", category: "Remote desktop and support", attention: "review", titles: 2 }]);
    }
    expect(JSON.stringify(out.result)).not.toContain("CVE-2015-0311");
  });

  it("get_computer keeps the titles and the certain top CVEs", async () => {
    const { data } = fakeData({ v_computer_list: [{ id: PC, tenant_id: T1, hostname: "PC1", vulns, attention }], v_installation_details: [] }, { computer_cycle_tasks: [] });
    const out = await getComputer(data, caller, { computer_id: PC });
    const computer = out.result.computer as { vulnerabilities: { top: { id: string }[] }; attention: unknown[] };
    expect(computer.vulnerabilities.top.map((t) => t.id)).toEqual(["CVE-2026-126881"]);
    expect(computer.attention).toEqual(attention);
  });

  it("get_software_title filters each version's summary", async () => {
    const { data } = fakeData(
      { v_title_summary: [{ tenant_id: T1, title_id: TITLE, canonical_name: "Microsoft Edge" }], v_installation_details: [] },
      { title_versions: [{ version: "142.0", computers: 4, vulns }], title_vulns: [], title_group_ids: [TITLE] },
    );
    const out = await getSoftwareTitle(data, caller, { title_id: TITLE });
    expect(JSON.stringify(out.result.versions)).not.toContain("CVE-2015-0311");
  });
});

describe("reports", () => {
  const two = [...tenants, { ...tenants[0], id: "22222222-2222-2222-2222-222222222222", name: "Beta" }];

  it("report_weekly summarises the period's changes by type, kind and title", async () => {
    const changes = [
      { change: "added", kind: "program", title_id: "t1", canonical_name: "Zoom", computer_id: "c1" },
      { change: "added", kind: "program", title_id: "t1", canonical_name: "Zoom", computer_id: "c2" },
      { change: "added", kind: "extension", title_id: "t2", canonical_name: "Grammarly", computer_id: "c1" },
      { change: "removed", kind: "program", title_id: "t3", canonical_name: "7-Zip", computer_id: "c1" },
    ];
    const { data, calls } = fakeData(
      { v_change_log: changes, v_vuln_events: [{ vuln_id: "CVE-1", canonical_name: "Zoom" }], v_policy_class_changes: [] },
      { overview_stats: { computers: 2 }, cycle_overview: [], weekly_changes: [], needs_attention: [] },
    );
    const out = await reportWeekly(data, caller, { since: "2026-11-09", until: "2026-11-16" });
    expect(out.result.period).toEqual({ since: "2026-11-09", until: "2026-11-16" });
    expect(out.result.changes).toMatchObject({
      total: 4,
      by_type_and_kind: { added: { program: 2, extension: 1 }, removed: { program: 1 } },
      top_added: [
        { name: "Zoom", computers: 2 },
        { name: "Grammarly", computers: 1 },
      ],
      top_removed: [{ name: "7-Zip", computers: 1 }],
    });
    expect(calls[0].options.filters).toEqual([
      { op: "gte", column: "detected_at", value: "2026-11-09" },
      { op: "lte", column: "detected_at", value: "2026-11-16" },
    ]);
    expect(out.result.new_vulnerabilities).toMatchObject({ total: 1 });
  });

  it("report_weekly refuses a reversed or too long period", async () => {
    await expect(reportWeekly(fakeData().data, caller, { since: "2026-11-16", until: "2026-11-01" })).rejects.toThrow("before until");
    await expect(reportWeekly(fakeData().data, caller, { since: "2026-01-01", until: "2026-11-01" })).rejects.toThrow("92 days");
  });

  it("per-tenant reports need tenant_id when several tenants are visible", async () => {
    await expect(reportPolicyPosture(fakeData({ v_tenant_overview: two }).data, caller, {})).rejects.toThrow("pass tenant_id");
  });

  it("report_policy_posture hides the publisher's email while usernames are masked", async () => {
    const overview = {
      classes: [{ class: "unsanctioned_app", titles: 3, installations: 7 }],
      exceptions: [{ name: "Legacy CAD", owner: "Eng", review_by: "2026-11-01", overdue: true }],
      published: { version: 4, published_by: "admin@example.com" },
    };
    const rpcs = { policy_overview: overview, search_titles: [{ title_id: "t9", canonical_name: "uTorrent", computers: 2, total_count: 3 }] };
    const masked = await reportPolicyPosture(fakeData({ v_tenant_overview: tenants }, rpcs).data, caller, {});
    expect(masked.result.published_policy).toEqual({ version: 4 });
    expect(masked.result.exceptions_due).toMatchObject({ overdue: 1, rows: [{ rule: "Legacy CAD", overdue: true }] });
    expect(masked.result.unsanctioned_titles).toMatchObject({ total: 3, rows: [{ name: "uTorrent", computers: 2 }] });
    const shown = await reportPolicyPosture(fakeData({ v_tenant_overview: tenants }, rpcs).data, { ...caller, showUsernames: true }, {});
    expect(shown.result.published_policy).toEqual({ version: 4, published_by: "admin@example.com" });
  });

  it("report_coverage counts computers per coverage status and lists the gaps", async () => {
    const computers = [
      { id: "c1", hostname: "A", coverage_status: "current", online: true },
      { id: "c2", hostname: "B", coverage_status: "stale", online: false },
      { id: "c3", hostname: "C", coverage_status: "never", online: false },
    ];
    const { data } = fakeData({ v_computer_list: computers, v_tenant_overview: tenants }, { cycle_overview: [], budget_overview: [], inventory_review_status: [{ overdue: true, last_reviewer: "x@example.com" }] });
    const out = await reportCoverage(data, caller, {});
    expect(out.result.computers_by_coverage).toEqual({ current: 1, stale: 1, never: 1, offline: 2 });
    expect(out.result.inventory_reviews).toEqual([{ tenant_id: T1, tenant: "Acme", overdue: true }]);
  });

  it("lists evidence packages and creates one only through the audit-report function", async () => {
    const pkg = [{ id: "r1", tenant_id: T1, as_of: "2026-11-16", manifest_sha256: "abc", generated_by_email: "a@example.com", users_masked: false }];
    const listed = await listEvidencePackages(fakeData({ v_tenant_overview: tenants, v_audit_reports: pkg }).data, caller, {});
    expect(listed.result.packages).toEqual([{ report_id: "r1", as_of: "2026-11-16", scope_tag: undefined, generated_at: undefined, archive_bytes: undefined, manifest_sha256: "abc", users_masked: false }]);
    const { data } = fakeData({ v_tenant_overview: tenants });
    await expect(createEvidencePackage(data, caller, {})).rejects.toThrow("not available");
    const createEvidence = vi.fn(async () => ({ data: { report_id: "r2", manifest_sha256: "def" }, error: null }));
    const out = await createEvidencePackage({ ...data, createEvidence }, caller, { as_of: "2026-11-15", scope_tag: " lab " });
    expect(createEvidence).toHaveBeenCalledWith({ tenant_id: T1, as_of: "2026-11-15", scope_tag: "lab" });
    expect(out.result).toMatchObject({ report_id: "r2", manifest_sha256: "def" });
    await expect(createEvidencePackage({ ...data, createEvidence }, caller, { as_of: "2999-01-01" })).rejects.toThrow("future");
    const failing = vi.fn(async () => ({ data: null, error: { message: "Only admins and operators can do this" } }));
    await expect(createEvidencePackage({ ...data, createEvidence: failing }, caller, {})).rejects.toThrow("Only admins and operators");
  });
});
