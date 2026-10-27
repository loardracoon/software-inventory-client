import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { Session } from "@supabase/supabase-js";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { AuthContext, type AuthContextValue, type AuthStatus } from "@/features/auth/auth-context";
import { TenantProvider } from "@/features/tenants/tenant-provider";
import App from "./App";

vi.mock("@/features/inventory/api", async () => (await import("@/test/inventory-mock")).inventoryApiMock());

vi.mock("@/features/sophos/sophos-connection", () => ({
  fetchSophosConnectionStatus: vi.fn(async () => ({ configured: false })),
  saveSophosCredential: vi.fn(),
  removeSophosCredential: vi.fn(),
}));

function renderApp(path: string, status: AuthStatus) {
  const signedIn = status === "signed_in";
  const auth: AuthContextValue = {
    status,
    session: signedIn ? ({ user: { id: "u1", email: "ana@example.com" } } as Session) : null,
    user: signedIn ? ({ id: "u1", email: "ana@example.com" } as Session["user"]) : null,
    profile: signedIn ? { id: "u1", email: "ana@example.com", display_name: null, role: "admin" } : null,
    sendMagicLink: vi.fn(async () => ({ error: null })),
    signOut: vi.fn(async () => {}),
  };
  return render(
    <ThemeProvider>
      <AuthContext.Provider value={auth}>
        <TenantProvider>
          <MemoryRouter initialEntries={[path]}>
            <App />
          </MemoryRouter>
        </TenantProvider>
      </AuthContext.Provider>
    </ThemeProvider>,
  );
}

describe("App routes", () => {
  it("sends signed-out users to the login page", () => {
    renderApp("/computers", "signed_out");
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it.each([
    ["/", "Overview"],
    ["/computers", "Computers"],
    ["/computers/abc", "Computer not found"],
    ["/software", "Software"],
    ["/software/t1", "Title not found"],
    ["/changes", "Changes"],
    ["/scans", "Scans"],
    ["/settings", "Settings"],
    ["/nope", "Page not found"],
  ])("renders %s inside the shell", async (path, title) => {
    renderApp(path, "signed_in");
    // Lazy route chunks load slowly when the whole suite runs in parallel.
    expect(await screen.findByRole("heading", { level: 1, name: title }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
  });

  it("routes the global search to /software?q=", async () => {
    const user = userEvent.setup();
    renderApp("/", "signed_in");
    await user.type(screen.getByRole("searchbox", { name: "Search the inventory" }), "anydesk{Enter}");
    expect(await screen.findByRole("searchbox", { name: "Search titles" })).toHaveValue("anydesk");
  });

  it("toggles the theme on <html>", async () => {
    const user = userEvent.setup();
    renderApp("/", "signed_in");
    const before = document.documentElement.dataset.theme;
    await user.click(screen.getByRole("button", { name: /Switch to (dark|light) theme/ }));
    expect(document.documentElement.dataset.theme).not.toBe(before);
  });
});
