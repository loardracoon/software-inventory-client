import { vi } from "vitest";

const emptyPage = async () => ({ rows: [], rowCount: 0 });

// Default fakes for "@/features/inventory/api": empty inventory. Tests override what they need with
// vi.mocked(api.fn).mockResolvedValue(...).
// Usage: vi.mock("@/features/inventory/api", async () => (await import("@/test/inventory-mock")).inventoryApiMock());
export function inventoryApiMock() {
  return {
    likePattern: (text: string) => `%${text}%`,
    fetchOverviewStats: vi.fn(async () => ({
      computers: 0,
      computers_by_platform: {},
      coverage_pct: null,
      titles: 0,
      extension_installs: 0,
      distinct_extensions: 0,
      package_installs: 0,
      package_managers: [],
      changes_7d: 0,
      added_7d: 0,
      updated_7d: 0,
      removed_7d: 0,
    })),
    fetchWeeklyChanges: vi.fn(async () => []),
    fetchCycleOverview: vi.fn(async () => []),
    fetchNeedsAttention: vi.fn(async () => []),
    fetchLatestChanges: vi.fn(async () => []),
    fetchCategories: vi.fn(async () => []),
    fetchLevel1Categories: vi.fn(async () => []),
    fetchComputers: vi.fn(emptyPage),
    fetchComputer: vi.fn(async () => null),
    fetchComputerTasks: vi.fn(async () => []),
    fetchHardware: vi.fn(async () => []),
    fetchInstallations: vi.fn(emptyPage),
    scanNow: vi.fn(async () => 0),
    searchTitles: vi.fn(emptyPage),
    fetchTitle: vi.fn(async () => ({ title: null, classification: null })),
    fetchTitleVersions: vi.fn(async () => []),
    fetchChanges: vi.fn(emptyPage),
    fetchBudget: vi.fn(async () => []),
    fetchRetryQueue: vi.fn(emptyPage),
    fetchRecentRuns: vi.fn(emptyPage),
    fetchScanSettings: vi.fn(async () => null),
    saveScanSettings: vi.fn(async () => {}),
  };
}

// Default fakes for "@/features/dictionary/api": an analyst-or-admin with no requests and a healthy hub.
// Usage: vi.mock("@/features/dictionary/api", async () => (await import("@/test/inventory-mock")).dictionaryApiMock());
export function dictionaryApiMock() {
  return {
    REASON_MAX: 500,
    useCanContribute: vi.fn(() => true),
    fetchOpenRequestTitleIds: vi.fn(async () => new Set<string>()),
    fetchTitleRequests: vi.fn(async () => []),
    fetchLocalOverride: vi.fn(async () => null),
    saveLocalOverride: vi.fn(async () => {}),
    removeLocalOverride: vi.fn(async () => {}),
    requestReclassification: vi.fn(async () => ({ id: "REQ-0001", status: "open" })),
    exportCsv: vi.fn(async () => {}),
    fetchHubStatus: vi.fn(async () => ({ configured: true, delayed: false, synced_at: null, next_attempt_at: null })),
    saveHubConnection: vi.fn(async () => {}),
    removeHubConnection: vi.fn(async () => {}),
    setHubSharing: vi.fn(async () => {}),
    syncHub: vi.fn(async () => ({ ok: true })),
  };
}
