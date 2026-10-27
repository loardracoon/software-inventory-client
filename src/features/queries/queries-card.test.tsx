import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { AuthContext, type AppRole, type AuthContextValue } from "@/features/auth/auth-context";
import { TenantProvider } from "@/features/tenants/tenant-provider";
import { QueriesCard } from "./queries-card";
import * as api from "./queries";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("./queries", () => ({
  fetchQueryStatus: vi.fn(),
  fetchLatestProbes: vi.fn(),
  runProbe: vi.fn(),
}));

function status(name: string, platform: api.Platform, counts: [number, number, number], missing: string[] = [], enabled = true): api.QueryStatusRow {
  return {
    query_id: `${name}-${platform}`,
    name,
    version: 1,
    domain: "packages",
    platform,
    enabled,
    required_tables: [],
    tenants_ok: counts[0],
    tenants_missing: counts[1],
    tenants_not_probed: counts[2],
    missing_tables: missing,
    last_probed_at: "2026-10-26T12:00:00Z",
  };
}

const QUERIES: api.QueryStatusRow[] = [
  status("inv.packages", "windows", [1, 1, 0], ["chocolatey_packages"]),
  status("inv.packages", "macos", [0, 0, 1]),
  status("inv.packages", "linux", [0, 0, 0]),
  status("inv.programs", "windows", [2, 0, 0]),
  status("inv.programs.deb", "linux", [1, 0, 0], [], false),
];

function probe(status: string, platform: api.Platform = "windows"): api.ProbeRow {
  return {
    id: `p-${platform}`,
    tenant_id: "t1",
    tenant_name: "Lab",
    platform,
    computer_id: "c1",
    hostname: "LAB-WIN-01",
    provider: "live_endpoint_search",
    status,
    error: status === "failed" ? "osquery error" : null,
    table_count: status === "succeeded" ? 16 : null,
    started_at: "2026-10-26T12:00:00Z",
    finished_at: null,
  };
}

const RESULT: api.ProbeCallResult = { ok: true, started: 1, succeeded: 0, failed: 0, noResponse: 0, running: 1, fellBackToRest: false, errors: [] };

function renderCard(role: AppRole) {
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
      <TenantProvider tenants={[]}>
        <QueriesCard />
      </TenantProvider>
    </AuthContext.Provider>,
  );
}

describe("QueriesCard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.fetchQueryStatus).mockResolvedValue(QUERIES);
  });
  afterEach(() => vi.useRealTimers());

  it("shows each query's status per platform with words and icons", async () => {
    vi.mocked(api.fetchLatestProbes).mockResolvedValue([probe("succeeded"), probe("failed", "linux")]);
    renderCard("viewer");

    const table = await screen.findByRole("table", { name: "Query catalog" });
    const packages = within(table).getByText("inv.packages").closest("tr")!;
    expect(within(packages).getByText("Missing tables")).toBeInTheDocument();
    expect(within(packages).getByText("chocolatey_packages")).toBeInTheDocument();
    expect(within(packages).getByText("1 of 2 tenants")).toBeInTheDocument();
    expect(within(packages).getByText("Not probed")).toBeInTheDocument();
    expect(within(packages).getByText("No computers")).toBeInTheDocument();

    const programs = within(table).getByText("inv.programs").closest("tr")!;
    expect(within(programs).getByText("OK")).toBeInTheDocument();
    expect(within(programs).getAllByText("—")).toHaveLength(2);
    expect(within(within(table).getByText("inv.programs.deb").closest("tr")!).getByText("Disabled")).toBeInTheDocument();

    const probes = screen.getByRole("list", { name: "Latest probes" });
    expect(within(probes).getByText("Succeeded")).toBeInTheDocument();
    expect(within(probes).getByText("osquery error")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Probe again" })).toBeNull();
  });

  it("lets an admin start a probe and keeps polling while it runs", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.mocked(api.fetchLatestProbes).mockResolvedValueOnce([]).mockResolvedValue([probe("running")]);
    vi.mocked(api.runProbe).mockResolvedValue(RESULT);
    renderCard("admin");

    await user.click(await screen.findByRole("button", { name: "Probe again" }));
    expect(api.runProbe).toHaveBeenCalledWith("start");
    expect(await screen.findByText("Running")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(api.runProbe).toHaveBeenLastCalledWith("poll");
  });

  it("says which platforms had no computer online instead of claiming a probe started", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchLatestProbes).mockResolvedValue([]);
    vi.mocked(api.runProbe).mockResolvedValue({ ...RESULT, started: 0, running: 0, noneOnline: ["Lab · windows", "Lab · macos"] });
    renderCard("admin");

    await user.click(await screen.findByRole("button", { name: "Probe again" }));
    expect(toast.info).toHaveBeenCalledWith("No computer online, probe not started: Lab · windows, Lab · macos. Try again when one is on.");
    expect(toast.success).not.toHaveBeenCalled();
  });
});
