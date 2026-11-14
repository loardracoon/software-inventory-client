import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { formatDateTime } from "@/lib/format";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthContext, type AppRole, type AuthContextValue } from "@/features/auth/auth-context";
import { TenantProvider } from "@/features/tenants/tenant-provider";
import * as dictionary from "@/features/dictionary/api";
import { ReclassifyDialog, validateReclassification } from "@/features/dictionary/reclassify-dialog";
import * as api from "@/features/inventory/api";
import * as vulns from "@/features/vulns/api";
import * as audit from "@/features/audit/api";
import { AuditLogLink } from "@/features/audit/audit-log-link";
import * as users from "@/features/users/api";
import * as reports from "@/features/reports/api";
import { AuditLogPage } from "./audit-log-page";
import { ChangesPage } from "./changes-page";
import { ComputerDetailPage } from "./computer-detail-page";
import { ComputersPage } from "./computers-page";
import { csvToImportRows, parseCsv } from "@/features/inventory/computer-context";
import { OverviewPage } from "./overview-page";
import { ReportsPage } from "./reports-page";
import { ScansPage } from "./scans-page";
import { SoftwarePage } from "./software-page";
import { SoftwareTitlePage } from "./software-title-page";

vi.mock("@/features/inventory/api", async () => (await import("@/test/inventory-mock")).inventoryApiMock());
vi.mock("@/features/dictionary/api", async () => (await import("@/test/inventory-mock")).dictionaryApiMock());
vi.mock("@/features/vulns/api", async (original) => ({
  ...(await original<typeof import("@/features/vulns/api")>()),
  fetchVulnOverview: vi.fn(async () => ({ vulns: 0, critical: 0, high: 0, kev: 0, titles: 0, kev_installations: 0, kev_computers: 0, possible: 0, possible_titles: 0, cached: 0, synced_at: null, evaluated_at: null })),
  fetchTitleVulns: vi.fn(async () => []),
  fetchVulnEvents: vi.fn(async () => ({ rows: [], rowCount: 0 })),
}));
vi.mock("@/features/audit/api", async (original) => ({
  ...(await original<typeof import("@/features/audit/api")>()),
  fetchAuditLog: vi.fn(async () => []),
  verifyAuditLog: vi.fn(async () => ({ checked: 0, first_bad_id: null })),
  downloadCsv: vi.fn(),
}));
vi.mock("@/features/users/api", async (original) => ({
  ...(await original<typeof import("@/features/users/api")>()),
  fetchUsers: vi.fn(async () => []),
}));
vi.mock("@/features/reports/api", () => ({
  fetchAuditReports: vi.fn(async () => []),
  fetchScopeTags: vi.fn(async () => ["pci"]),
  generateAuditReport: vi.fn(async () => ({ report_id: "r1", manifest_sha256: "f".repeat(64) })),
  downloadAuditReport: vi.fn(async () => {}),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const TENANT = { id: "t1", name: "Lab" };

function renderAt(path: string, routePath: string, element: React.ReactNode, role: AppRole = "admin") {
  const auth: AuthContextValue = {
    status: "signed_in",
    session: null,
    user: null,
    profile: { id: "u1", email: "admin@example.com", display_name: null, role },
    sendMagicLink: vi.fn(),
    signOut: vi.fn(),
  };
  return render(
    <AuthContext.Provider value={auth}>
      <TenantProvider tenants={[TENANT]}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={routePath} element={element} />
          </Routes>
        </MemoryRouter>
      </TenantProvider>
    </AuthContext.Provider>,
  );
}

const lastFilters = <T,>(fn: (filters: T, request: api.PageRequest) => unknown) => vi.mocked(fn).mock.calls.at(-1)?.[0] as T;

const computer = {
  id: "c1",
  tenant_id: "t1",
  hostname: "LAB-WIN-01",
  platform: "windows",
  os_name: "Windows 11 Enterprise",
  os_version: "10.0",
  os_build: "22631",
  endpoint_type: "computer",
  health: "good",
  associated_user: null,
  user_masked: true,
  last_seen_at: "2026-10-26T12:00:00Z",
  last_collected_at: "2026-10-26T13:00:00Z",
  online: true,
  online_checked_at: "2026-10-26T13:05:00Z",
  retired_at: null,
  cycle_status: "error",
  next_attempt_at: null,
  last_error: "osquery: no such table: chocolatey_packages",
  programs: 120,
  extensions: 14,
  packages: 3,
  attention: [{ slug: "remote-access/remote-desktop-and-support", level1: "Remote access", level2: "Remote desktop and support", attention: "review", titles: ["AnyDesk"] }],
  vulns: {
    critical: 1,
    high: 0,
    medium: 2,
    low: 0,
    kev: 1,
    possible: 0,
    top: [{ id: "CVE-2099-0001", severity: "CRITICAL", score: 9.8, kev: true, uncertain: false, title: "AnyDesk" }],
  },
  attention_slugs: ["remote-access/remote-desktop-and-support"],
  attention_level1_slugs: ["remote-access"],
} as unknown as api.ComputerRow;

beforeEach(() => vi.clearAllMocks());

describe("Computers", () => {
  it("lists computers with masked users, status and attention, and filters on the server", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchComputers).mockResolvedValue({ rows: [computer], rowCount: 1 });
    vi.mocked(api.fetchNeedsAttention).mockResolvedValue([
      { category_slug: "remote-access/remote-desktop-and-support", level1_name: "Remote access", level2_name: "Remote desktop and support", attention_level: "review", titles: 1, computers: 1 },
    ]);
    renderAt("/computers", "/computers", <ComputersPage />);

    const row = (await screen.findByRole("link", { name: "LAB-WIN-01" })).closest("tr")!;
    expect(within(row).getByText("Hidden")).toBeInTheDocument();
    expect(within(row).getByText("Query error")).toBeInTheDocument();
    // Attention points are icons with a counter; the details are in the tooltip.
    expect(within(row).getByRole("button", { name: "Known exploited (CISA KEV): 1 CVE" })).toHaveTextContent("1");
    expect(within(row).getByRole("button", { name: "2 medium CVEs installed on this computer" })).toHaveTextContent("2");
    expect(within(row).queryByRole("button", { name: /high CVE/ })).toBeNull();
    await user.hover(within(row).getByRole("button", { name: "Review: 1 category" }));
    expect((await screen.findAllByText("Remote access / Remote desktop and support", {}, { timeout: 4000 })).length).toBeGreaterThan(0);
    expect(screen.getAllByText("AnyDesk").length).toBeGreaterThan(0);
    // Online status from Sophos Central, with the last seen time in the tooltip.
    await user.hover(within(row).getByRole("button", { name: "Online" }));
    expect((await screen.findAllByText("Online in Sophos Central", {}, { timeout: 4000 })).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Last seen Oct 26, 2026, 9:00 AM").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("tab", { name: "Query errors" }));
    await waitFor(() => expect(lastFilters(api.fetchComputers).status).toBe("error"));
    await user.click(screen.getByRole("button", { name: "Remote access" }));
    await waitFor(() => expect(lastFilters(api.fetchComputers).category).toBe("remote-access"));
    expect(lastFilters(api.fetchComputers).tenantId).toBeNull();
  });

  it("shows coverage per computer and filters by coverage from the URL and the select", async () => {
    const user = userEvent.setup();
    const at = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    vi.mocked(api.fetchComputers).mockResolvedValue({
      rows: [
        { ...computer, id: "n1", hostname: "NEVER-01", coverage_status: "never", inventoried_at: null, inventory_source: "none" },
        { ...computer, id: "s1", hostname: "STALE-01", coverage_status: "stale", inventoried_at: at(30.5), inventory_source: "data_lake" },
        { ...computer, id: "c1", hostname: "CURRENT-01", coverage_status: "current", inventoried_at: at(1), inventory_source: "live_endpoint_search" },
      ],
      rowCount: 3,
    });
    renderAt("/computers?coverage=stale", "/computers", <ComputersPage />);

    const cell = async (host: string) => (await screen.findByRole("link", { name: host })).closest("tr")!;
    expect(within(await cell("NEVER-01")).getByText("Never inventoried")).toBeInTheDocument();
    expect(within(await cell("STALE-01")).getByText("Stale (30 d)")).toBeInTheDocument();
    expect(within(await cell("CURRENT-01")).getByText("Current")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Coverage/ })).toBeInTheDocument();
    expect(lastFilters(api.fetchComputers).coverage).toBe("stale");

    await user.selectOptions(screen.getByLabelText("Coverage"), "never");
    await waitFor(() => expect(lastFilters(api.fetchComputers).coverage).toBe("never"));
  });
  it("shows owner, criticality and scope, filters on them and imports a CSV with the per-row errors", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchComputers).mockResolvedValue({
      rows: [{ ...computer, owner: "Alice Example", department: "Finance", criticality: "high", scope_tags: ["pci", "iso"] } as api.ComputerRow],
      rowCount: 1,
    });
    vi.mocked(api.importComputerContext).mockResolvedValue({ applied: 1, errors: [{ row: 2, message: 'No computer matches "NOPE"' }] });
    localStorage.setItem("endpoint-inventory.tenant", "t1");
    renderAt("/computers", "/computers", <ComputersPage />);
    const row = (await screen.findByRole("link", { name: "LAB-WIN-01" })).closest("tr")!;
    expect(within(row).getByText("Alice Example")).toBeInTheDocument();
    expect(within(row).getByText("high")).toBeInTheDocument();
    expect(within(row).getByText("pci")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Owner/ })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Criticality"), "high");
    await user.type(screen.getByLabelText("Scope tag"), "pci");
    await user.type(screen.getByLabelText("Owner"), "alice");
    await waitFor(() => expect(lastFilters(api.fetchComputers)).toMatchObject({ criticality: "high", scope: "pci", owner: "alice" }));

    const csv = "endpoint_id,hostname,owner,department,criticality,scope_tags\nep-1,,Alice,Finance,high,pci;iso\n,NOPE,Bob,,,\n";
    await user.upload(screen.getByLabelText("CSV file"), new File([csv], "context.csv", { type: "text/csv" }));
    expect(api.importComputerContext).toHaveBeenCalledWith("t1", [
      { endpoint_id: "ep-1", hostname: "", owner: "Alice", department: "Finance", criticality: "high", scope_tags: "pci;iso" },
      { endpoint_id: "", hostname: "NOPE", owner: "Bob", department: "", criticality: "", scope_tags: "" },
    ]);
    expect(await screen.findByText(/^1 applied/)).toBeInTheDocument();
    expect(screen.getByText(/Row 2/)).toHaveTextContent('No computer matches "NOPE"');
    localStorage.removeItem("endpoint-inventory.tenant");
  });

  it("has no Import CSV for viewers", async () => {
    renderAt("/computers", "/computers", <ComputersPage />, "viewer");
    expect(await screen.findByRole("heading", { level: 1, name: "Computers" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import CSV" })).toBeNull();
  });
});

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, CRLF, a BOM and blank lines", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\nlast,')).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["last", ""]]);
  });

  it("re-imports a file with the export header: scope tags and endpoint id are used", () => {
    const text = "Hostname,Tenant,Owner,Department,Criticality,Scope tags,Endpoint ID\r\nW1,Lab,Alice,Finance,high,pci;iso,ep-1\r\n";
    expect(csvToImportRows(text)).toEqual([{ endpoint_id: "ep-1", hostname: "W1", owner: "Alice", department: "Finance", criticality: "high", scope_tags: "pci;iso" }]);
  });

  it("removes the formula guard the export adds: '-ops imports as -ops, 'x stays 'x", () => {
    const text = `Hostname,Owner,Department,Coverage\r\nW1,"'-ops",'x,never\r\n`;
    expect(csvToImportRows(text)).toEqual([{ hostname: "W1", owner: "-ops", department: "'x" }]);
  });
});

describe("Software", () => {
  it("searches from the URL and shows the category origin", async () => {
    const user = userEvent.setup();
    vi.mocked(api.searchTitles).mockResolvedValue({
      rows: [
        {
          title_id: "x1",
          kind: "extension",
          source: "chrome",
          canonical_name: "Chrome Remote Desktop",
          vendor: null,
          external_id: "inomeogfingihgjfjlpeplalcfajhgai",
          category_slug: "remote-access/remote-desktop-and-support",
          level1_name: "Remote access",
          level2_name: "Remote desktop and support",
          attention_level: "review",
          origin: "hub",
          method: "jev_auto",
          confidence: 0.97,
          computers: 37,
          versions: 2,
          latest_version: "124.0",
          first_seen: "2026-10-05T13:00:00Z",
          total_count: 1,
        },
      ] as never,
      rowCount: 1,
    });
    renderAt("/software?q=remote", "/software", <SoftwarePage />);

    expect(await screen.findByRole("link", { name: "Chrome Remote Desktop" })).toHaveAttribute("href", "/software/x1");
    expect(screen.getByText("Hub · Jev 0.97")).toBeInTheDocument();
    expect(screen.getByText("Browser extension · Chrome")).toBeInTheDocument();
    expect(lastFilters(api.searchTitles).query).toBe("remote");

    await user.click(screen.getByRole("tab", { name: "Packages" }));
    await waitFor(() => expect(lastFilters(api.searchTitles).kind).toBe("package"));
    await user.type(screen.getByLabelText("Version below"), "2.45");
    await waitFor(() => expect(lastFilters(api.searchTitles).versionBelow).toBe("2.45"));
  });

  it("filters by policy class from the URL and shows the class with the deciding rule", async () => {
    vi.mocked(api.searchTitles).mockResolvedValue({
      rows: [
        {
          title_id: "x2",
          kind: "program",
          source: "programs",
          canonical_name: "Adobe Acrobat",
          vendor: "Adobe",
          external_id: null,
          category_slug: null,
          level1_name: null,
          level2_name: null,
          attention_level: null,
          origin: "unclassified",
          method: null,
          confidence: null,
          computers: 8,
          versions: 2,
          latest_version: "25.0",
          first_seen: "2026-10-05T13:00:00Z",
          policy_class: "unsanctioned_app",
          policy_rule_lineage_id: "l1",
          policy_rule_name: "Old Acrobat",
          mixed_versions: true,
          total_count: 1,
        },
      ] as never,
      rowCount: 1,
    });
    renderAt("/software?policy=unsanctioned-app", "/software", <SoftwarePage />);

    expect(await screen.findByRole("button", { name: "Unsanctioned" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Old Acrobat" })).toHaveAttribute("href", "/policies/rules/l1");
    expect(screen.getByText("Mixed versions")).toBeInTheDocument();
    expect(lastFilters(api.searchTitles).policy).toEqual(["unsanctioned_app"]);
    expect(screen.getByLabelText("Policy class")).toHaveValue("unsanctioned-app");
  });

  it("filters by known vulnerabilities from the URL and shows the CVE counts", async () => {
    vi.mocked(api.searchTitles).mockResolvedValue({
      rows: [
        {
          title_id: "x7",
          kind: "program",
          source: "programs",
          canonical_name: "7-Zip",
          vendor: "Igor Pavlov",
          origin: "unclassified",
          computers: 3,
          versions: 2,
          spellings: 2,
          vulns: 2,
          vulns_kev: 1,
          vulns_critical: 0,
          vulns_high: 2,
          vulns_possible: 1,
          vulns_medium: 0,
          vulns_low: 3,
          max_cvss: 7.8,
          vuln_top: [{ id: "CVE-2025-0411", severity: "HIGH", score: 7.0, kev: true, uncertain: false }],
          total_count: 1,
        },
      ] as never,
      rowCount: 1,
    });
    renderAt("/software?vuln=kev", "/software", <SoftwarePage />);

    expect(await screen.findByRole("button", { name: "Known exploited (CISA KEV): 1 CVE" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2 high CVEs in the installed versions" })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "3 low CVEs in the installed versions" })).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: "May apply: 1 CVE (no version to compare)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /medium CVE/ })).toBeNull();
    await userEvent.setup().hover(screen.getByRole("button", { name: "2 high CVEs in the installed versions" }));
    expect((await screen.findAllByText("CVE-2025-0411", {}, { timeout: 4000 })).length).toBeGreaterThan(0);
    expect(lastFilters(api.searchTitles).vuln).toBe("kev");
    expect(screen.getByLabelText("Vulnerabilities")).toHaveValue("kev");
  });

  it("reads every filter from the URL (saved searches are links)", async () => {
    vi.mocked(api.fetchCategories).mockResolvedValue([
      { slug: "remote-access", name: "Remote access", parent_slug: null, level: 1 },
      { slug: "proxy-and-tunnel", name: "Proxy and tunnel", parent_slug: null, level: 1 },
    ]);
    renderAt("/software?category=remote-access,proxy-and-tunnel&kind=extension&attention=not_allowed&platform=windows&below=2.0", "/software", <SoftwarePage />);

    await waitFor(() =>
      expect(lastFilters(api.searchTitles)).toMatchObject({
        category: "remote-access,proxy-and-tunnel",
        kind: "extension",
        attention: ["not_allowed"],
        platform: "windows",
        versionBelow: "2.0",
        policy: [],
      }),
    );
    expect(await screen.findByRole("combobox", { name: "Category" })).toHaveTextContent("Remote access + Proxy and tunnel");
    expect(screen.getByRole("tab", { name: "Browser extensions" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save search" })).toBeInTheDocument();
  });

  it("hides export and reclassification from viewers", async () => {
    vi.mocked(dictionary.useCanContribute).mockReturnValue(false);
    renderAt("/software", "/software", <SoftwarePage />, "viewer");
    expect(await screen.findByRole("heading", { level: 1, name: "Software" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export CSV" })).not.toBeInTheDocument();
    vi.mocked(dictionary.useCanContribute).mockReturnValue(true);
  });
});

describe("Software title", () => {
  it("shows each installed version with its policy class and CVE icons", async () => {
    vi.mocked(api.fetchTitle).mockResolvedValue({
      title: { id: "x7", kind: "program", source: "programs", canonical_name: "7-Zip", vendor: "Igor Pavlov", external_id: null, first_seen_at: "2026-10-01T00:00:00Z" },
      classification: null,
      spellings: [],
    } as never);
    vi.mocked(api.fetchTitleVersions).mockResolvedValue([
      { version: "26.05", computers: 2, policy_class: "sanctioned_app", vulns: { critical: 0, high: 0, medium: 0, low: 0, kev: 0, possible: 0, top: [] } },
      { version: "23.01", computers: 1, policy_class: "unsanctioned_app", vulns: { critical: 0, high: 1, medium: 0, low: 0, kev: 1, possible: 0, top: [{ id: "CVE-2025-0411", severity: "HIGH", score: 7, kev: true, uncertain: false }] } },
    ] as never);
    renderAt("/software/x7", "/software/:titleId", <SoftwareTitlePage />);

    const list = await screen.findByRole("list", { name: "Computers per version" });
    const old = within(list).getByText("23.01").closest("li")!;
    expect(within(old).getByRole("button", { name: "Unsanctioned" })).toBeInTheDocument();
    expect(within(old).getByRole("button", { name: "Known exploited (CISA KEV): 1 CVE" })).toBeInTheDocument();
    const current = within(list).getByText("26.05").closest("li")!;
    expect(within(current).getByRole("button", { name: "Sanctioned" })).toBeInTheDocument();
    expect(within(current).queryByRole("button", { name: /CVE/ })).toBeNull();
  });
});

describe("Request reclassification", () => {
  it("validates the form and sends the suggestion", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchCategories).mockResolvedValue([
      { slug: "remote-access", name: "Remote access", parent_slug: null, level: 1 },
      { slug: "remote-access/remote-desktop-and-support", name: "Remote desktop and support", parent_slug: "remote-access", level: 2 },
    ]);
    const onRequested = vi.fn();
    render(
      <ReclassifyDialog target={{ titleId: "t-1", name: "AnyDesk", currentCategory: null }} onOpenChange={vi.fn()} onRequested={onRequested} />,
    );

    expect(screen.getByLabelText("Current category")).toHaveValue("Unclassified");
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a suggested category");

    // The category is chosen by typing in a searchable list.
    await user.click(screen.getByRole("combobox", { name: "Suggested category" }));
    await user.type(await screen.findByRole("searchbox", { name: "Search categories" }), "remote desk");
    await user.click(await screen.findByRole("option", { name: "Remote access / Remote desktop and support" }));
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a reason");

    await user.type(screen.getByLabelText("Reason"), "Remote control tool");
    await user.type(screen.getByLabelText("Evidence URL (optional)"), "javascript:alert(1)");
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(screen.getByRole("alert")).toHaveTextContent("http(s) link");

    await user.clear(screen.getByLabelText("Evidence URL (optional)"));
    await user.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(onRequested).toHaveBeenCalledWith("t-1", "REQ-0001"));
    expect(dictionary.requestReclassification).toHaveBeenCalledWith({
      titleId: "t-1",
      suggestedCategorySlug: "remote-access/remote-desktop-and-support",
      reason: "Remote control tool",
      evidenceUrl: "",
    });
  });

  it("limits the reason to 500 characters", () => {
    expect(validateReclassification("x", "a".repeat(501), "")).toMatch(/at most 500/);
    expect(validateReclassification("x", "ok", "https://example.com/doc")).toBeNull();
  });
});

describe("Computer detail", () => {
  beforeEach(() => {
    vi.mocked(api.fetchComputer).mockResolvedValue({ ...computer, cycle_status: "collected" } as api.ComputerRow);
    vi.mocked(api.fetchHardware).mockResolvedValue([
      { domain: "hardware", item_key: "", attrs: { hardware_vendor: "Dell Inc.", hardware_model: "Latitude 7440", physical_memory: "17179869184" }, valid_from: "", valid_to: null },
      { domain: "disks", item_key: "C:", attrs: { type: "Fixed", file_system: "NTFS", size: "511101108224", free_space: "200000000000" }, valid_from: "", valid_to: null },
    ] as never);
    vi.mocked(api.fetchComputerTasks).mockResolvedValue([
      { query_name: "inv.packages", domain: "packages", status: "skipped", attempts: 0, next_attempt_at: "", last_error: "Skipped: missing osquery tables chocolatey_packages", updated_at: "" },
    ]);
  });

  it("shows hardware and cycle tasks, filters by date and lets admins scan now", async () => {
    const user = userEvent.setup();
    vi.mocked(api.scanNow).mockResolvedValue(6);
    renderAt("/computers/c1", "/computers/:id", <ComputerDetailPage />);

    expect(await screen.findByRole("heading", { level: 1, name: "LAB-WIN-01" })).toBeInTheDocument();
    expect(await screen.findByText("Dell Inc. Latitude 7440")).toBeInTheDocument();
    expect(screen.getByText("16 GB")).toBeInTheDocument();
    expect(screen.getByText(/511 GB · 200 GB free/)).toBeInTheDocument();
    expect(screen.getByText("Skipped")).toBeInTheDocument();
    expect(screen.getByText(/chocolatey_packages/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Inventory as of"), "2026-10-15");
    await waitFor(() => expect(lastFilters(api.fetchInstallations).asOf).toBe("2026-10-16T02:59:59.000Z"));

    await user.click(screen.getByRole("button", { name: "Scan now" }));
    expect(api.scanNow).toHaveBeenCalledWith("c1");
  });

  it("shows the Data Lake snapshot in the header only when set", async () => {
    vi.mocked(api.fetchComputer).mockResolvedValue({ ...computer, data_lake_snapshot_at: "2026-10-26T12:00:00Z" } as api.ComputerRow);
    const { unmount } = renderAt("/computers/c1", "/computers/:id", <ComputerDetailPage />);
    expect(await screen.findByText(`Data Lake snapshot ${formatDateTime("2026-10-26T12:00:00Z")}`, { exact: false })).toBeInTheDocument();
    unmount();
    vi.mocked(api.fetchComputer).mockResolvedValue({ ...computer, data_lake_snapshot_at: null } as api.ComputerRow);
    renderAt("/computers/c1", "/computers/:id", <ComputerDetailPage />);
    expect(await screen.findByRole("heading", { level: 1, name: "LAB-WIN-01" })).toBeInTheDocument();
    expect(screen.queryByText(/Data Lake/)).toBeNull();
  });

  it("shows the context and lets admins edit it, but not viewers", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchComputer).mockResolvedValue({ ...computer, owner: "Alice Example", department: "Finance", criticality: "high", scope_tags: ["pci"] } as api.ComputerRow);
    const { unmount } = renderAt("/computers/c1", "/computers/:id", <ComputerDetailPage />);
    expect(await screen.findByText(/Owner Alice Example · Department Finance · Criticality high · Scope pci/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit context" }));
    await user.clear(screen.getByLabelText("Owner"));
    await user.type(screen.getByLabelText("Owner"), "Bob Example");
    await user.selectOptions(screen.getByLabelText("Criticality"), "critical");
    await user.clear(screen.getByLabelText("Scope tags"));
    await user.type(screen.getByLabelText("Scope tags"), "pci, cde");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(api.setComputerContext).toHaveBeenCalledWith(["c1"], { owner: "Bob Example", department: "Finance", criticality: "critical", scopeTags: ["pci", "cde"] });
    unmount();
    renderAt("/computers/c1", "/computers/:id", <ComputerDetailPage />, "viewer");
    expect(await screen.findByText(/Owner Alice Example/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit context" })).toBeNull();
  });

  it("has no Scan now for viewers", async () => {
    renderAt("/computers/c1", "/computers/:id", <ComputerDetailPage />, "viewer");
    expect(await screen.findByRole("heading", { level: 1, name: "LAB-WIN-01" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Scan now" })).toBeNull();
  });
});

describe("Overview", () => {
  it("shows KPIs, attention and the weekly chart", async () => {
    vi.mocked(api.fetchOverviewStats).mockResolvedValue({
      computers: 11,
      computers_by_platform: { windows: 9, macos: 2 },
      coverage_never: 1,
      coverage_stale: 2,
      coverage_current: 8,
      coverage_pct: 94.4,
      titles: 1284,
      extension_installs: 3906,
      distinct_extensions: 312,
      package_installs: 2177,
      package_managers: ["npm", "pip"],
      changes_7d: 236,
      added_7d: 148,
      updated_7d: 61,
      removed_7d: 27,
    });
    vi.mocked(api.fetchNeedsAttention).mockResolvedValue([
      { category_slug: "proxy-and-tunnel/anonymizers", level1_name: "Proxy and tunnel", level2_name: "Anonymizers", attention_level: "not_allowed", titles: 1, computers: 1 },
    ]);
    vi.mocked(api.fetchWeeklyChanges).mockResolvedValue([{ week_start: "2026-10-19", added: 3, updated: 2, removed: 1 }]);
    renderAt("/", "/", <OverviewPage />);

    expect(await screen.findByText("1,284")).toBeInTheDocument();
    expect(screen.getByText("9 Windows · 2 macOS")).toBeInTheDocument();
    expect(screen.getByText("94.4")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Never inventoried/ })).toHaveAttribute("href", "/computers?coverage=never");
    expect(screen.getByRole("link", { name: /Never inventoried/ })).toHaveTextContent("1");
    expect(screen.getByRole("link", { name: /Stale/ })).toHaveAttribute("href", "/computers?coverage=stale");
    expect(screen.getByRole("link", { name: /Stale/ })).toHaveTextContent("2");
    expect(screen.getByRole("link", { name: /Current/ })).toHaveAttribute("href", "/computers?coverage=current");
    expect(screen.getByText("148 added · 61 updated · 27 removed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Anonymizers/ })).toHaveAttribute("href", "/software?category=proxy-and-tunnel%2Fanonymizers");
    expect(screen.getByText("Not allowed")).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: /per week for the last 12 weeks/ })).toBeInTheDocument();
  });

  it("shows the known vulnerabilities card with links to the filtered Software list", async () => {
    vi.mocked(api.fetchOverviewStats).mockResolvedValue({ computers: 3, computers_by_platform: {}, coverage_never: 0, coverage_stale: 0, coverage_current: 3, coverage_pct: null, titles: 1, extension_installs: 0, distinct_extensions: 0, package_installs: 0, package_managers: [], changes_7d: 0, added_7d: 0, updated_7d: 0, removed_7d: 0 });
    vi.mocked(vulns.fetchVulnOverview).mockResolvedValue({ vulns: 4, critical: 1, high: 2, kev: 1, titles: 2, kev_installations: 3, kev_computers: 2, possible: 9, possible_titles: 1, cached: 40, synced_at: null, evaluated_at: null });
    renderAt("/", "/", <OverviewPage />);

    expect(await screen.findByRole("link", { name: /Known exploited CVEs/ })).toHaveAttribute("href", "/software?vuln=kev");
    expect(screen.getByText("3 installations on 2 computers")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Critical CVEs/ })).toHaveAttribute("href", "/software?vuln=critical");
    // CVEs without a version to compare are counted apart, so the card does not read as "nothing found".
    expect(screen.getByRole("link", { name: /CVEs that may apply/ })).toHaveAttribute("href", "/software?vuln=possible");
    expect(screen.getByText("1 title · no version to compare")).toBeInTheDocument();
  });
});

describe("Changes", () => {
  it("filters by type and date range on the server", async () => {
    const user = userEvent.setup();
    renderAt("/changes", "/changes", <ChangesPage />);
    await user.click(await screen.findByRole("tab", { name: "Removed" }));
    await waitFor(() => expect(lastFilters(api.fetchChanges).change).toBe("removed"));
    await user.type(screen.getByLabelText("From"), "2026-10-01");
    await waitFor(() => expect(lastFilters(api.fetchChanges).from).toBe("2026-10-01T02:59:59.000Z"));
  });

  it("lists new CVEs that affect installed software", async () => {
    const user = userEvent.setup();
    vi.mocked(vulns.fetchVulnEvents).mockResolvedValue({
      rows: [{ id: 1, tenant_id: "t1", title_id: "x7", kind: "program", canonical_name: "7-Zip", vendor: "Igor Pavlov", version: "23.01", vuln_id: "CVE-2025-0411", severity: "HIGH", cvss_score: 7, kev_added: "2025-02-06", epss: 0.5, summary: "Mark-of-the-Web bypass", detected_at: "2026-10-28T12:00:00Z" }],
      rowCount: 1,
    });
    renderAt("/changes", "/changes", <ChangesPage />);
    await user.click(await screen.findByRole("tab", { name: "New CVE" }));
    expect(await screen.findByRole("link", { name: "CVE-2025-0411" })).toHaveAttribute("href", "https://nvd.nist.gov/vuln/detail/CVE-2025-0411");
    expect(screen.getByText("High 7.0")).toBeInTheDocument();
    expect(screen.getByText("Known exploited")).toBeInTheDocument();
  });
});

describe("Scans", () => {
  it("shows the API budget with numbers, not colour alone", async () => {
    vi.mocked(api.fetchBudget).mockResolvedValue([
      {
        tenant_id: "t1",
        tenant_name: "Lab",
        runs_this_minute: 3,
        runs_per_minute: 10,
        runs_today: 703,
        daily_run_limit: 1000,
        reserve_pct: 20,
        normal_left: 97,
        reserve_left: 200,
        active_runs: 1,
        max_active_runs: 4,
      },
    ]);
    renderAt("/scans", "/scans", <ScansPage />);
    expect(await screen.findByText("703 / 1,000")).toBeInTheDocument();
    expect(screen.getByText("3 / 10")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Active runs" })).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByText("97 normal runs left today · 200 of 200 in reserve")).toBeInTheDocument();
  });

  const settings = {
    tenant_id: "t1",
    cycle_weekday: 1,
    cycle_time: "10:00:00",
    retry_time: "11:00:00",
    timezone: "America/Sao_Paulo",
    batch_size: 50,
    max_active_runs: 4,
    runs_per_minute: 10,
    daily_run_limit: 1000,
    reserve_pct: 20,
    run_grace_minutes: 10,
    provider: "live_endpoint_search",
    data_lake_inventory: false,
    stale_after_days: 30,
    updated_at: "2026-10-26T12:00:00Z",
    updated_by: null,
  } as api.ScanSettings;

  it("lets admins change the schedule of the tenant", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchScanSettings).mockResolvedValue(settings);
    vi.mocked(api.fetchRetryQueue).mockResolvedValue({
      rows: [{ id: "r1", tenant_id: "t1", computer_id: "c2", hostname: "LAB-MAC-01", platform: "macos", last_seen_at: null, query_name: "inv.programs", domain: "programs", status: "retry_scheduled", attempts: 1, next_attempt_at: "2026-10-27T14:00:00Z", last_error: null, updated_at: "" }],
      rowCount: 1,
    } as never);
    renderAt("/scans", "/scans", <ScansPage />);

    expect(await screen.findByText("LAB-MAC-01")).toBeInTheDocument();
    const batch = await screen.findByLabelText("Computers per run");
    await user.clear(batch);
    await user.type(batch, "25");
    await user.click(screen.getByRole("button", { name: "Save schedule" }));
    await waitFor(() => expect(api.saveScanSettings).toHaveBeenCalledWith("t1", expect.objectContaining({ batch_size: 25, cycle_time: "10:00:00" })));
  });

  it("saves the stale-after days of the schedule", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchScanSettings).mockResolvedValue(settings);
    renderAt("/scans", "/scans", <ScansPage />);
    const days = await screen.findByLabelText("Stale after (days)");
    expect(days).toHaveValue(30);
    await user.clear(days);
    await user.type(days, "45");
    await user.click(screen.getByRole("button", { name: "Save schedule" }));
    await waitFor(() => expect(api.saveScanSettings).toHaveBeenCalledWith("t1", expect.objectContaining({ stale_after_days: 45 })));
  });

  it("has a Data Lake switch that saves, and the provider select has no Data Lake option", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchScanSettings).mockResolvedValue(settings);
    renderAt("/scans", "/scans", <ScansPage />);
    const sw = await screen.findByRole("switch", { name: "Fill gaps from the Sophos Data Lake" });
    expect(sw).not.toBeChecked();
    expect(within(screen.getByLabelText("Query provider")).getAllByRole("option")).toHaveLength(2);
    await user.click(sw);
    await user.click(screen.getByRole("button", { name: "Save schedule" }));
    await waitFor(() => expect(api.saveScanSettings).toHaveBeenCalledWith("t1", expect.objectContaining({ data_lake_inventory: true })));
  });

  it("disables the Data Lake switch for viewers", async () => {
    vi.mocked(api.fetchScanSettings).mockResolvedValue(settings);
    renderAt("/scans", "/scans", <ScansPage />, "viewer");
    expect(await screen.findByRole("switch", { name: "Fill gaps from the Sophos Data Lake" })).toBeDisabled();
  });

  it("labels Data Lake runs", async () => {
    vi.mocked(api.fetchRecentRuns).mockResolvedValue({
      rows: [{ id: "run1", tenant_id: "t1", started_at: "2026-10-26T12:00:00Z", query_name: "softwareinfo", domain: "programs", query_version: 1, platform: "windows", provider: "data_lake", priority: false, endpoints: 3, collected: 3, no_response: 0, duration_seconds: 5, status: "completed" }],
      rowCount: 1,
    } as never);
    renderAt("/scans", "/scans", <ScansPage />);
    await userEvent.setup().click(await screen.findByRole("tab", { name: "Recent runs" }));
    expect(await screen.findByText(/Sophos Data Lake/, { selector: "span" })).toBeInTheDocument();
  });

  describe("run detail drawer", () => {
    const run = { id: "run1", tenant_id: "t1", started_at: "2026-10-26T12:00:00Z", query_name: "inv.programs", domain: "programs", query_version: 2, platform: "windows", provider: "live_endpoint_search", priority: false, endpoints: 2, collected: 1, no_response: 1, errors: 0, duration_seconds: 40, status: "finished" };
    const longPath = "C:\\Users\\alice\\AppData\\Local\\" + "x".repeat(120);
    const detail = (preview: boolean) => ({
      run: { id: "run1", provider: "live_endpoint_search", domain: "programs", platform: "windows", query_name: "inv.programs", query_version: 2, status: "finished", cancelled: false, error: null, started_at: "2026-10-26T12:00:00Z", finished_at: "2026-10-26T12:00:40Z", endpoints: 2 },
      preview_allowed: preview,
      computers: [
        { computer_id: "c1", hostname: "LAB-WIN-01", endpoint_id: "e1", task_status: "collected", last_error: null, row_count: 25, bytes: 5120, received_at: "2026-10-26T12:00:30Z", ingested_at: "2026-10-26T12:01:00Z", ingest_error: null,
          rows: preview ? [{ name: "7-Zip 23.01 (x64)", version: "23.01", install_location: longPath }, { name: "Git", version: "2.45.1", count: 3 }] : null },
        { computer_id: "c2", hostname: "LAB-WIN-02", endpoint_id: "e2", task_status: "no_response", last_error: "The computer did not answer before the run timed out.", row_count: null, bytes: null, received_at: null, ingested_at: null, ingest_error: null, rows: null },
      ],
    });
    async function openDrawer(preview: boolean, role?: "viewer") {
      vi.mocked(api.fetchRecentRuns).mockResolvedValue({ rows: [run], rowCount: 1 } as never);
      vi.mocked(api.fetchRunDetail).mockResolvedValue(detail(preview) as never);
      renderAt("/scans", "/scans", <ScansPage />, role);
      const user = userEvent.setup();
      await user.click(await screen.findByRole("tab", { name: "Recent runs" }));
      await user.click(await screen.findByText("inv.programs.v2"));
      return within(await screen.findByRole("dialog"));
    }

    it("opens on a click and shows status, size and a tabular preview per computer", async () => {
      const d = await openDrawer(true);
      expect(api.fetchRunDetail).toHaveBeenCalledWith("run1");
      expect(await d.findByText("LAB-WIN-01")).toBeInTheDocument();
      expect(d.getByText(/25 rows · 5\.0 KB/)).toBeInTheDocument();
      expect(d.getByText(/first 2 of 25 rows/)).toBeInTheDocument();
      expect(d.getByRole("columnheader", { name: "install_location" })).toBeInTheDocument();
      expect(d.getByRole("columnheader", { name: "count" })).toBeInTheDocument();
      const cut = d.getByTitle(longPath);
      expect(cut.textContent!.length).toBeLessThanOrEqual(81);
      expect(d.getByText("3")).toBeInTheDocument();
      expect(d.getByText("LAB-WIN-02")).toBeInTheDocument();
      expect(d.getByText("The computer did not answer before the run timed out.")).toBeInTheDocument();
    });

    it("opens with the keyboard", async () => {
      vi.mocked(api.fetchRecentRuns).mockResolvedValue({ rows: [run], rowCount: 1 } as never);
      vi.mocked(api.fetchRunDetail).mockResolvedValue(detail(true) as never);
      renderAt("/scans", "/scans", <ScansPage />);
      const user = userEvent.setup();
      await user.click(await screen.findByRole("tab", { name: "Recent runs" }));
      (await screen.findByText("inv.programs.v2")).closest("tr")!.focus();
      await user.keyboard("{Enter}");
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });

    it("shows counts but no rows when the preview is not allowed", async () => {
      const d = await openDrawer(false, "viewer");
      expect(await d.findByText(/25 rows · 5\.0 KB/)).toBeInTheDocument();
      expect(d.getByText(/Only admins and operators see the rows/)).toBeInTheDocument();
      expect(d.queryByRole("columnheader", { name: "install_location" })).toBeNull();
    });
  });

  it("is read-only for viewers", async () => {
    vi.mocked(api.fetchScanSettings).mockResolvedValue(settings);
    renderAt("/scans", "/scans", <ScansPage />, "viewer");
    expect(await screen.findByText("Only admins can change the schedule.")).toBeInTheDocument();
    expect(screen.getByLabelText("Computers per run")).toBeDisabled();
  });
});

describe("Audit log", () => {
  const rows = [
    { id: 7, created_at: "2026-11-01T10:00:00Z", user_id: "u1", action: "update computers", target: "computers:c1", data: { note: "=cmd" }, prev_hash: "aa", row_hash: "bb" },
  ] as audit.AuditRow[];

  beforeEach(() => {
    vi.mocked(audit.fetchAuditLog).mockResolvedValue(rows);
    vi.mocked(users.fetchUsers).mockResolvedValue([{ id: "u1", email: "admin@example.com" }] as users.UserRow[]);
  });

  it("lists rows with the user email and shows the verified chain badge", async () => {
    vi.mocked(audit.verifyAuditLog).mockResolvedValue({ checked: 1, first_bad_id: null });
    renderAt("/settings/audit-log", "/settings/audit-log", <AuditLogPage />);
    expect(await screen.findByText("update computers")).toBeInTheDocument();
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
    expect(await screen.findByText("Chain verified ✓ (1 rows)")).toBeInTheDocument();
  });

  it("shows where the chain is broken", async () => {
    vi.mocked(audit.verifyAuditLog).mockResolvedValue({ checked: 9, first_bad_id: 5 });
    renderAt("/settings/audit-log", "/settings/audit-log", <AuditLogPage />);
    expect(await screen.findByText("Chain broken at #5")).toBeInTheDocument();
  });

  it("filters by date range on the server", async () => {
    const user = userEvent.setup();
    vi.mocked(audit.verifyAuditLog).mockResolvedValue({ checked: 1, first_bad_id: null });
    renderAt("/settings/audit-log", "/settings/audit-log", <AuditLogPage />);
    await user.type(await screen.findByLabelText("From"), "2026-11-01");
    await waitFor(() => expect(vi.mocked(audit.fetchAuditLog).mock.calls.at(-1)?.[0]).toBe("2026-11-01"));
  });

  it("builds the CSV with the audit columns and neutralises formulas", () => {
    const csv = audit.auditCsv(rows, new Map([["u1", "admin@example.com"]]));
    const [head, line] = csv.split("\r\n");
    expect(head).toBe("id,created_at,user,action,target,data,prev_hash,row_hash");
    expect(line).toBe(`7,2026-11-01T10:00:00Z,admin@example.com,update computers,computers:c1,"{""note"":""=cmd""}",aa,bb`);
    expect(audit.auditCsv([{ ...rows[0], action: "=1+1" }], new Map()).split("\r\n")[1]).toContain("'=1+1");
  });

  it("exports every page, oldest first", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 502 }, (_, i) => ({ ...rows[0], id: 502 - i, action: `act-${502 - i}` })) as audit.AuditRow[];
    vi.mocked(audit.fetchAuditLog).mockImplementation(async (_f, _t, _l, before) => (before === undefined ? many.slice(0, 500) : many.slice(500)));
    vi.mocked(audit.verifyAuditLog).mockResolvedValue({ checked: 502, first_bad_id: null });
    renderAt("/settings/audit-log", "/settings/audit-log", <AuditLogPage />);
    await user.click(await screen.findByRole("button", { name: /export csv/i }));
    await waitFor(() => expect(audit.downloadCsv).toHaveBeenCalled());
    const lines = vi.mocked(audit.downloadCsv).mock.calls[0][0].split("\r\n");
    expect(lines).toHaveLength(503);
    expect(lines[1]).toContain("act-1,");
    expect(lines[502]).toContain("act-502,");
  });

  it("shows the menu link to admins only", () => {
    const { unmount } = renderAt("/settings", "/settings", <AuditLogLink />, "admin");
    expect(screen.getByRole("link", { name: /audit log/i })).toBeInTheDocument();
    unmount();
    renderAt("/settings", "/settings", <AuditLogLink />, "operator");
    expect(screen.queryByRole("link", { name: /audit log/i })).not.toBeInTheDocument();
  });
});

describe("Reports", () => {
  const report = { id: "r1", tenant_id: "t1", as_of: "2026-11-01T12:00:00Z", scope_tag: null, generated_by: "u1", generated_by_email: "admin@example.com", generated_at: "2026-11-14T12:00:00Z", manifest: {}, manifest_sha256: "abcdef0123456789".repeat(4), archive_bytes: 10, users_masked: false };

  it("lists packages with the short hash and lets an admin generate and download", async () => {
    const user = userEvent.setup();
    vi.mocked(reports.fetchAuditReports).mockResolvedValue([report]);
    renderAt("/reports", "/reports", <ReportsPage />, "admin");
    expect(await screen.findByText("abcdef012345")).toBeInTheDocument();
    await user.selectOptions(await screen.findByLabelText("Scope tag (optional)"), "pci");
    await user.click(screen.getByRole("button", { name: "Generate package" }));
    await waitFor(() => expect(reports.generateAuditReport).toHaveBeenCalledWith({ tenantId: "t1", asOf: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), scopeTag: "pci" }));
    await user.click(screen.getByRole("button", { name: "Download" }));
    expect(reports.downloadAuditReport).toHaveBeenCalledWith("r1");
  });

  it("shows viewers the table but no form and no download", async () => {
    vi.mocked(reports.fetchAuditReports).mockResolvedValue([report]);
    renderAt("/reports", "/reports", <ReportsPage />, "viewer");
    expect(await screen.findByText("abcdef012345")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate package" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    expect(screen.getByText(/only admins and operators can download/i)).toBeInTheDocument();
  });
});
