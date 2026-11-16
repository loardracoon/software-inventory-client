import { describe, expect, it, vi } from "vitest";
import {
  certainVulns,
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
