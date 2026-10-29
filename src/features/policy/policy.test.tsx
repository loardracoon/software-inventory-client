import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import type { PolicyRule } from "@policy";
import { AuthContext, type AuthContextValue } from "@/features/auth/auth-context";
import { TenantProvider } from "@/features/tenants/tenant-provider";
import { PoliciesPage } from "@/pages/policies-page";
import * as policyApi from "./api";
import type { PolicyDoc, PolicyRuleRow, PolicyState, PreviewInput } from "./api";
import { ClassBadge } from "./class-badge";
import * as importApi from "./import-policy";
import { PolicyCard } from "./policy-card";
import { matchCounts, classifyAll, previewRule } from "./preview";
import { TitleTester } from "./title-tester";

vi.mock("@/features/inventory/api", async () => (await import("@/test/inventory-mock")).inventoryApiMock());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("./import-policy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./import-policy")>()),
  importPolicy: vi.fn(async () => 1),
}));
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    fetchPolicy: vi.fn(),
    fetchPolicyOverview: vi.fn(),
    fetchPreviewInputs: vi.fn(),
    moveRule: vi.fn(async () => 2),
    setRuleEnabled: vi.fn(async () => {}),
    publishPolicy: vi.fn(),
    discardDraft: vi.fn(),
  };
});

const rule = (lineage: string, position: number, over: Partial<PolicyRuleRow>): PolicyRuleRow => ({
  id: `id-${lineage}`,
  lineage_id: lineage,
  position,
  name: lineage,
  class: "sanctioned_app",
  match: "all",
  kinds: ["program"],
  enabled: true,
  conditions: [{ field: "vendor", operator: "contains", value: "adobe" }],
  owner: "IT",
  business_purpose: null,
  mitigating_controls: null,
  risk_accepted_by: null,
  review_by: null,
  alert_on_new: false,
  updated_at: "2026-10-28T12:00:00Z",
  ...over,
});

const doc = (rules: PolicyRuleRow[], status: PolicyDoc["status"] = "published"): PolicyDoc => ({
  id: `p-${status}`,
  tenant_id: "t1",
  version: status === "draft" ? 2 : 1,
  status,
  default_class: "unsanctioned_app",
  note: null,
  created_at: "2026-10-28T12:00:00Z",
  published_at: status === "published" ? "2026-10-28T12:00:00Z" : null,
  published_by: "admin@example.com",
  evaluated_at: null,
  rules,
});

const adobe = rule("Adobe suite", 1, {});
const oldAdobe = rule("Old Acrobat", 2, { class: "unsanctioned_app", conditions: [{ field: "version", operator: "lt", value: "24" }] });

const input = (title: string, name: string, version: string, vendor: string, computers = 1): PreviewInput => ({
  title_id: title,
  version,
  kind: "program",
  name,
  vendor,
  external_id: null,
  category_slug: null,
  category_name: null,
  subcategory_slug: null,
  subcategory_name: null,
  computers,
  installations: computers,
  current_class: null,
  current_rule_id: null,
});
const INPUTS = [input("acro", "Adobe Acrobat", "23.0", "Adobe", 3), input("acro", "Adobe Acrobat", "25.0", "Adobe", 5), input("zip", "7-Zip", "24.09", "Igor Pavlov", 2)];

const OVERVIEW: policyApi.PolicyOverview = {
  classes: [
    { class: "core_system", titles: 0, installations: 0 },
    { class: "sanctioned_app", titles: 1, installations: 5 },
    { class: "tolerated_app", titles: 0, installations: 0 },
    { class: "unsanctioned_app", titles: 1, installations: 5 },
  ],
  total_titles: 2,
  total_installations: 10,
  not_evaluated_titles: 0,
  default_titles: 1,
  unsanctioned_installations: 5,
  unsanctioned_computers: 4,
  exceptions: [],
  published: { version: 1, published_at: "2026-10-28T12:00:00Z", evaluated_at: null, default_class: "unsanctioned_app", published_by: "admin@example.com" },
};

function renderPolicies(state: PolicyState) {
  vi.mocked(policyApi.fetchPolicy).mockResolvedValue(state);
  vi.mocked(policyApi.fetchPolicyOverview).mockResolvedValue(OVERVIEW);
  vi.mocked(policyApi.fetchPreviewInputs).mockResolvedValue(INPUTS);
  const auth: AuthContextValue = {
    status: "signed_in",
    session: null,
    user: null,
    profile: { id: "u1", email: "admin@example.com", display_name: null, role: state.can_edit ? "admin" : "viewer" },
    sendMagicLink: vi.fn(),
    signOut: vi.fn(),
  };
  return render(
    <AuthContext.Provider value={auth}>
      <TenantProvider tenants={[{ id: "t1", name: "Lab" }]}>
        <MemoryRouter initialEntries={["/policies"]}>
          <Routes>
            <Route path="/policies" element={<PoliciesPage />} />
          </Routes>
        </MemoryRouter>
      </TenantProvider>
    </AuthContext.Provider>,
  );
}

const rulesTable = async () => screen.findByRole("table", { name: /Policy rules/ });
const ruleNames = () =>
  within(screen.getByRole("table", { name: /Policy rules/ }))
    .getAllByRole("link")
    .map((a) => a.textContent);

describe("Policies page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the rules top down with their match counts, the pinned default row and the class cards", async () => {
    renderPolicies({ published: doc([adobe, oldAdobe]), draft: null, versions: [], can_edit: true });
    const table = await rulesTable();
    expect(await within(table).findByRole("link", { name: "Adobe suite" })).toBeInTheDocument();
    expect(ruleNames()).toEqual(["Adobe suite", "Old Acrobat"]);
    // Adobe suite decides both Acrobat versions (8 computers); 7-Zip falls to the default class.
    expect(within(table).getAllByText("1 titles")).toHaveLength(2);
    expect(within(table).getByText("8 computers")).toBeInTheDocument();
    expect(within(table).getByText("Default · any title that no rule matches")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Unsanctioned: 1 titles, 50%" })).toHaveAttribute("href", "/software?policy=unsanctioned-app");
  });

  it("moves a rule from the row menu, in the draft", async () => {
    const user = userEvent.setup();
    renderPolicies({ published: doc([adobe, oldAdobe]), draft: null, versions: [], can_edit: true });
    await user.click(await screen.findByRole("button", { name: "Actions for rule 1: Adobe suite" }));
    await user.click(await screen.findByRole("menuitem", { name: "Move down" }));
    expect(policyApi.moveRule).toHaveBeenCalledWith("t1", "Adobe suite", 2);
    expect(ruleNames()).toEqual(["Old Acrobat", "Adobe suite"]);
  });

  describe("keyboard reorder", () => {
    // jsdom has no layout: give each table row a distinct box so dnd-kit can move between them.
    const original = Element.prototype.getBoundingClientRect;
    beforeEach(() => {
      Element.prototype.getBoundingClientRect = function (this: Element) {
        const row = this.closest("tr");
        const index = row?.parentElement ? Array.from(row.parentElement.children).indexOf(row) : 0;
        const top = index * 50;
        return { x: 0, y: top, top, left: 0, bottom: top + 50, right: 1000, width: 1000, height: 50, toJSON: () => ({}) } as DOMRect;
      };
    });
    afterEach(() => {
      Element.prototype.getBoundingClientRect = original;
    });

    it("Space picks up, Arrow Down moves, Space drops", async () => {
      const user = userEvent.setup();
      renderPolicies({ published: doc([adobe, oldAdobe]), draft: null, versions: [], can_edit: true });
      const handle = await screen.findByRole("button", { name: "Reorder rule 1: Adobe suite" });
      handle.focus();
      await user.keyboard(" ");
      await act(async () => {
        await user.keyboard("{ArrowDown}");
      });
      await user.keyboard(" ");
      await waitFor(() => expect(policyApi.moveRule).toHaveBeenCalledWith("t1", "Adobe suite", 2));
    });
  });

  it("filters turn dragging off and say so", async () => {
    const user = userEvent.setup();
    renderPolicies({ published: doc([adobe, oldAdobe]), draft: null, versions: [], can_edit: true });
    await user.type(await screen.findByLabelText("Search rules"), "old");
    expect(screen.getByText("Clear filters to reorder.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reorder rule 2: Old Acrobat" })).toBeDisabled();
    expect(within(await rulesTable()).queryByRole("link", { name: "Adobe suite" })).not.toBeInTheDocument();
  });

  it("shows the draft bar with the number of changes and marks changed rules", async () => {
    const moved = [rule("Old Acrobat", 1, { ...oldAdobe, position: 1 }), rule("Adobe suite", 2, { ...adobe, position: 2 })];
    renderPolicies({ published: doc([adobe, oldAdobe]), draft: doc(moved, "draft"), versions: [], can_edit: true });
    expect(await screen.findByText("Draft version 2 · 2 changes")).toBeInTheDocument();
    expect(screen.getAllByText("Changed in draft")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
  });

  it("imports an exported policy into the draft after confirmation, and explains a bad file", async () => {
    const user = userEvent.setup();
    renderPolicies({ published: doc([adobe, oldAdobe]), draft: null, versions: [], can_edit: true });
    await rulesTable();
    const upload = (name: string, content: unknown) =>
      user.upload(screen.getByLabelText("Policy file to import"), new File([JSON.stringify(content)], name, { type: "application/json" }));

    await upload("bad.json", { rules: [{ name: "X", class: "blocked", kinds: ["program"], conditions: [{ field: "name", operator: "equals", value: "x" }] }] });
    expect(await screen.findByText("This file cannot be imported")).toBeInTheDocument();
    expect(screen.getByText('Rule 1 "X": unknown class "blocked"')).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(importApi.importPolicy).not.toHaveBeenCalled();

    await upload("policy.json", { version: 4, default_class: "tolerated_app", rules: [{ position: 1, name: "Remote tools", class: "unsanctioned_app", match: "any", kinds: ["program"], enabled: true, conditions: [{ field: "name", operator: "contains", value: "anydesk" }] }] });
    expect(await screen.findByText("Import 1 rule into the draft?")).toBeInTheDocument();
    expect(screen.getByText("Default class: Tolerated")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Replace the draft" }));
    await waitFor(() => expect(importApi.importPolicy).toHaveBeenCalledWith("t1", expect.objectContaining({ version: 4, default_class: "tolerated_app" })));
  });

  it("viewers get no edit controls", async () => {
    renderPolicies({ published: doc([adobe, oldAdobe]), draft: null, versions: [], can_edit: false });
    expect(await within(await rulesTable()).findByRole("link", { name: "Adobe suite" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New rule" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import policy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reorder rule/ })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Rule 1 Adobe suite enabled" })).toBeDisabled();
  });
});

describe("Title tester", () => {
  const toRules = (rows: PolicyRuleRow[]): PolicyRule[] => rows.map((r) => ({ ...r, id: r.lineage_id }));

  it("follows the rule order: reordering changes the result", () => {
    const { rerender } = render(
      <MemoryRouter>
        <TitleTester inputs={[INPUTS[0]]} rules={toRules([adobe, oldAdobe])} defaultClass="unsanctioned_app" isDraft categoryName={(s) => s} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/sets the class/).textContent).toContain("Rule 1 · Adobe suite");
    expect(screen.getByRole("button", { name: "Sanctioned" })).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <TitleTester inputs={[INPUTS[0]]} rules={toRules([oldAdobe, adobe])} defaultClass="unsanctioned_app" isDraft categoryName={(s) => s} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/sets the class/).textContent).toContain("Rule 1 · Old Acrobat");
    expect(screen.getByRole("button", { name: "Unsanctioned" })).toBeInTheDocument();
  });

  it("explains why earlier rules did not match", () => {
    render(
      <MemoryRouter>
        <TitleTester inputs={[INPUTS[2]]} rules={toRules([adobe, oldAdobe])} defaultClass="unsanctioned_app" isDraft={false} categoryName={(s) => s} />
      </MemoryRouter>,
    );
    expect(screen.getByText("No rule matches: the default class applies.")).toBeInTheDocument();
    expect(screen.getByText(/Vendor \/ publisher contains adobe is false \(Igor Pavlov\)/)).toBeInTheDocument();
  });
});

describe("Class badge", () => {
  it("shows the class name, and its meaning and CIS reference on keyboard focus", async () => {
    const user = userEvent.setup();
    render(<ClassBadge cls="tolerated_app" />);
    expect(screen.getByRole("button", { name: "Tolerated" })).toBeInTheDocument();
    await user.tab();
    expect((await screen.findAllByText(/documented exception with an owner/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("CIS v8.1 · Documented exception · 2.2, 2.3").length).toBeGreaterThan(0);
  });
});

describe("Dashboard card", () => {
  it("states the finding and lists the numbers in the legend", async () => {
    vi.mocked(policyApi.fetchPolicyOverview).mockResolvedValue(OVERVIEW);
    render(
      <MemoryRouter>
        <PolicyCard tenantId="t1" />
      </MemoryRouter>,
    );
    expect(await screen.findByText("1 title is unsanctioned, and 1 title match no rule yet.")).toBeInTheDocument();
    const legend = screen.getByRole("table", { name: /per policy class/ });
    const row = within(legend).getByRole("row", { name: /Unsanctioned/ });
    expect(row).toHaveTextContent("1 · 50%");
    expect(row).toHaveTextContent("5 · 50%");
    expect(screen.getByRole("link", { name: "Installations: Sanctioned, 5 (50%)" })).toHaveAttribute("href", "/software?policy=sanctioned-app");
    expect(screen.getByRole("link", { name: /unsanctioned installations on 4 computers/ })).toBeInTheDocument();
  });
});

describe("Preview helpers", () => {
  const rules = (rows: PolicyRuleRow[]) => rows.map((r) => ({ ...r, id: r.lineage_id }));

  it("counts titles and computers per deciding rule and for the default class", () => {
    const { byRule, byDefault } = matchCounts(classifyAll(INPUTS, rules([oldAdobe, adobe]), "unsanctioned_app"));
    expect(byRule.get("Old Acrobat")).toEqual({ titles: 1, computers: 3 });
    expect(byRule.get("Adobe suite")).toEqual({ titles: 1, computers: 5 });
    expect(byDefault).toEqual({ titles: 1, computers: 2 });
  });

  it("previews a rule at its position: what it decides, what an earlier rule keeps, what changes", () => {
    const stored = INPUTS.map((i) => ({ ...i, current_class: "sanctioned_app" as const }));
    const p = previewRule(stored, rules([adobe]), rules([oldAdobe])[0], 2, "unsanctioned_app");
    expect(p.decides).toHaveLength(0);
    expect(p.shadowed.map((s) => s.row.input.version)).toEqual(["23.0"]);
    expect(p.changes.map((c) => c.row.input.name)).toEqual(["7-Zip"]);
    const first = previewRule(stored, rules([adobe]), rules([oldAdobe])[0], 1, "unsanctioned_app");
    expect(first.matched).toEqual({ titles: 1, computers: 3 });
  });
});
