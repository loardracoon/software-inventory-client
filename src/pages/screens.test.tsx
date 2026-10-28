import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthContext, type AppRole, type AuthContextValue } from "@/features/auth/auth-context";
import { TenantProvider } from "@/features/tenants/tenant-provider";
import * as dictionary from "@/features/dictionary/api";
import { ReclassifyDialog, validateReclassification } from "@/features/dictionary/reclassify-dialog";
import * as api from "@/features/inventory/api";
import { ChangesPage } from "./changes-page";
import { ComputerDetailPage } from "./computer-detail-page";
import { ComputersPage } from "./computers-page";
import { OverviewPage } from "./overview-page";
import { ScansPage } from "./scans-page";
import { SoftwarePage } from "./software-page";

vi.mock("@/features/inventory/api", async () => (await import("@/test/inventory-mock")).inventoryApiMock());
vi.mock("@/features/dictionary/api", async () => (await import("@/test/inventory-mock")).dictionaryApiMock());
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
  retired_at: null,
  cycle_status: "error",
  next_attempt_at: null,
  last_error: "osquery: no such table: chocolatey_packages",
  programs: 120,
  extensions: 14,
  packages: 3,
  attention: [{ slug: "remote-access/remote-desktop-and-support", level1: "Remote access", level2: "Remote desktop and support", attention: "review" }],
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
    expect(within(row).getByText("Remote desktop and support")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Query errors" }));
    await waitFor(() => expect(lastFilters(api.fetchComputers).status).toBe("error"));
    await user.click(screen.getByRole("button", { name: "Remote access" }));
    await waitFor(() => expect(lastFilters(api.fetchComputers).category).toBe("remote-access"));
    expect(lastFilters(api.fetchComputers).tenantId).toBeNull();
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
    expect(await screen.findByRole("option", { name: "Remote access + Proxy and tunnel" })).toBeInTheDocument();
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

    await screen.findByRole("option", { name: "Remote access / Remote desktop and support" });
    await user.selectOptions(screen.getByLabelText("Suggested category"), "remote-access/remote-desktop-and-support");
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
    expect(screen.getByText("148 added · 61 updated · 27 removed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Anonymizers/ })).toHaveAttribute("href", "/software?category=proxy-and-tunnel%2Fanonymizers");
    expect(screen.getByText("Not allowed")).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: /per week for the last 12 weeks/ })).toBeInTheDocument();
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

  it("is read-only for viewers", async () => {
    vi.mocked(api.fetchScanSettings).mockResolvedValue(settings);
    renderAt("/scans", "/scans", <ScansPage />, "viewer");
    expect(await screen.findByText("Only admins can change the schedule.")).toBeInTheDocument();
    expect(screen.getByLabelText("Computers per run")).toBeDisabled();
  });
});
