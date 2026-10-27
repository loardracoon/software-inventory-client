import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthContext, type AppRole, type AuthContextValue } from "@/features/auth/auth-context";
import { SophosConnectionCard } from "./sophos-connection-card";
import * as api from "./sophos-connection";

vi.mock("./sophos-connection", () => ({
  fetchSophosConnectionStatus: vi.fn(),
  saveSophosCredential: vi.fn(),
  removeSophosCredential: vi.fn(),
  testSophosConnection: vi.fn(),
  syncComputers: vi.fn(),
}));

const NOT_CONFIGURED: api.SophosConnectionStatus = {
  configured: false,
  client_id_hint: null as unknown as string,
  configured_at: null as unknown as string,
  configured_by_email: null as unknown as string,
  last_test_at: null as unknown as string,
  last_test_ok: null as unknown as boolean,
  last_test_message: null as unknown as string,
  id_type: null as unknown as string,
  data_region_host: null as unknown as string,
  last_sync_at: null as unknown as string,
  last_sync_ok: null as unknown as boolean,
  last_sync_message: null as unknown as string,
};

const CONFIGURED: api.SophosConnectionStatus = {
  ...NOT_CONFIGURED,
  configured: true,
  client_id_hint: "••••7777",
  configured_at: "2026-10-26T13:00:00Z",
  configured_by_email: "admin@example.com",
};

function renderCard(role: AppRole, onSynced?: () => void) {
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
      <SophosConnectionCard onSynced={onSynced} />
    </AuthContext.Provider>,
  );
}

describe("SophosConnectionCard", () => {
  beforeEach(() => vi.resetAllMocks());

  it("lets an admin save a credential and never shows the secret again", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchSophosConnectionStatus).mockResolvedValueOnce(NOT_CONFIGURED).mockResolvedValueOnce(CONFIGURED);
    vi.mocked(api.saveSophosCredential).mockResolvedValue();
    renderCard("admin");

    expect(await screen.findByText("Not configured")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Client ID"), " 11111111-2222-3333-4444-555566667777 ");
    await user.type(screen.getByLabelText("Client secret"), "super-secret-value-0123456789");
    await user.click(screen.getByRole("button", { name: "Save credential" }));

    expect(api.saveSophosCredential).toHaveBeenCalledWith(
      "11111111-2222-3333-4444-555566667777",
      "super-secret-value-0123456789",
    );
    expect(await screen.findByText("Configured")).toBeInTheDocument();
    expect(screen.getByText("••••7777")).toBeInTheDocument();
    expect(screen.getByText(/by admin@example.com/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Client secret")).toBeNull();
    expect(document.body.textContent).not.toContain("super-secret-value");
  });

  it("shows server validation errors", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchSophosConnectionStatus).mockResolvedValue(NOT_CONFIGURED);
    vi.mocked(api.saveSophosCredential).mockRejectedValue(new Error("Client secret is not valid"));
    renderCard("admin");

    await user.type(await screen.findByLabelText("Client ID"), "11111111-2222");
    await user.type(screen.getByLabelText("Client secret"), "x");
    await user.click(screen.getByRole("button", { name: "Save credential" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Client secret is not valid");
  });

  it("lets an admin replace or remove a saved credential", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchSophosConnectionStatus).mockResolvedValueOnce(CONFIGURED).mockResolvedValueOnce(NOT_CONFIGURED);
    vi.mocked(api.removeSophosCredential).mockResolvedValue();
    renderCard("admin");

    await user.click(await screen.findByRole("button", { name: "Replace credential" }));
    expect(screen.getByRole("button", { name: "Save new credential" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(await screen.findByRole("button", { name: "Remove credential" }));
    await waitFor(() => expect(api.removeSophosCredential).toHaveBeenCalled());
    expect(await screen.findByText("Not configured")).toBeInTheDocument();
  });

  it("tests the connection and syncs computers", async () => {
    const user = userEvent.setup();
    const synced = { ...CONFIGURED, last_sync_at: "2026-10-26T14:00:00Z", last_sync_ok: true, last_sync_message: "2 tenants · 4 computers · 4 new · 0 retired" };
    vi.mocked(api.fetchSophosConnectionStatus).mockResolvedValueOnce(CONFIGURED).mockResolvedValue(synced);
    vi.mocked(api.testSophosConnection).mockResolvedValue({ ok: true, idType: "partner", regions: [], tenantCount: 2, message: "Connected as partner · 2 tenants" });
    vi.mocked(api.syncComputers).mockResolvedValue({ ok: true, message: "2 tenants · 4 computers · 4 new · 0 retired" });
    const onSynced = vi.fn();
    renderCard("admin", onSynced);

    expect(await screen.findByText("Never synced")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(api.testSophosConnection).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(onSynced).toHaveBeenCalled());
    expect(await screen.findByText("2 tenants · 4 computers · 4 new · 0 retired")).toBeInTheDocument();
    expect(screen.getByText("Passed")).toBeInTheDocument();
  });

  it("is read-only for other roles", async () => {
    vi.mocked(api.fetchSophosConnectionStatus).mockResolvedValue({ ...NOT_CONFIGURED, configured: true });
    renderCard("analyst");

    expect(await screen.findByText("Configured")).toBeInTheDocument();
    expect(screen.getByText("Only admins can change the connection.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Client ID")).toBeNull();
    expect(screen.queryByRole("button", { name: "Replace credential" })).toBeNull();
  });
});
