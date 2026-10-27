import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AuthContext, type AuthContextValue } from "@/features/auth/auth-context";
import { SavedSearchNav } from "./saved-search-nav";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchSavedSearches: vi.fn(async () => [
    { id: "s1", name: "Remote access & tunnels", params: { category: "remote-access,proxy-and-tunnel" }, owner_id: null, pinned: true, created_by: null, created_at: "" },
    { id: "s2", name: "My Git", params: { q: "git", kind: "program" }, owner_id: "u1", pinned: true, created_by: "u1", created_at: "" },
    { id: "s3", name: "Unpinned", params: {}, owner_id: "u1", pinned: false, created_by: "u1", created_at: "" },
  ]),
}));

function renderNav(role: "admin" | "viewer", path = "/") {
  const auth: AuthContextValue = {
    status: "signed_in",
    session: null,
    user: null,
    profile: { id: "u1", email: "u1@example.com", display_name: null, role },
    sendMagicLink: vi.fn(),
    signOut: vi.fn(),
  };
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <SavedSearchNav />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("SavedSearchNav", () => {
  it("links the pinned searches to /software with their filters", async () => {
    renderNav("viewer", "/software?q=git&kind=program");
    expect(await screen.findByRole("link", { name: /Remote access & tunnels/ })).toHaveAttribute("href", "/software?category=remote-access%2Cproxy-and-tunnel");
    expect(screen.getByRole("link", { name: /My Git/ })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByText("Unpinned")).not.toBeInTheDocument();
    // A viewer edits only its own searches, not the shared one.
    expect(screen.getByRole("button", { name: "Options for My Git" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Options for Remote access & tunnels" })).not.toBeInTheDocument();
  });

  it("lets admins edit shared searches", async () => {
    renderNav("admin");
    expect(await screen.findByRole("button", { name: "Options for Remote access & tunnels" })).toBeInTheDocument();
  });
});
