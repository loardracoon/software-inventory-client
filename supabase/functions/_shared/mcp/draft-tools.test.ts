import { describe, expect, it, vi } from "vitest";
import { draftMoveRule, draftSaveRule, draftSetRuleEnabled, reviewDate } from "./draft-tools";
import type { PreviewInput } from "./policy-tools";
import type { McpCaller, McpData } from "./tools";

const T1 = "11111111-1111-1111-1111-111111111111";
const ACRO = "a1000000-0000-0000-0000-000000000001";
const ZIP = "a2000000-0000-0000-0000-000000000002";
const R_ADOBE = "b1000000-0000-0000-0000-000000000001";
const R_VPN = "b2000000-0000-0000-0000-000000000002";
const drafter: McpCaller = { userId: "u1", tokenId: "t1", scope: "policy_draft", showUsernames: false };
const reader: McpCaller = { ...drafter, scope: "read" };
const TODAY = "2026-11-16";

const pair = (p: Partial<PreviewInput> & Pick<PreviewInput, "title_id" | "name" | "version">): PreviewInput => ({
  kind: "program",
  vendor: null,
  computers: 1,
  installations: 1,
  current_class: "unsanctioned_app",
  current_rule_id: null,
  max_cvss: 0,
  kev: false,
  max_epss: 0,
  eol: false,
  ...p,
});
const pairs: PreviewInput[] = [
  pair({ title_id: ACRO, name: "Adobe Acrobat", vendor: "Adobe", version: "23.008", computers: 3, installations: 3, kev: true }),
  pair({ title_id: ACRO, name: "Adobe Acrobat", vendor: "Adobe", version: "25.001", computers: 5, installations: 5 }),
  pair({ title_id: ZIP, name: "7-Zip", vendor: "Igor Pavlov", version: "16.04", computers: 2, installations: 2 }),
];

const rule = (r: Record<string, unknown>) => ({ owner: null, business_purpose: null, mitigating_controls: null, risk_accepted_by: null, review_by: null, alert_on_new: false, enabled: true, match: "all", kinds: ["program"], ...r });
const published = {
  version: 3,
  status: "published",
  default_class: "unsanctioned_app" as const,
  published_at: "2026-11-01",
  published_by: "admin@example.com",
  evaluated_at: "2026-11-02",
  rules: [
    rule({ id: "x", lineage_id: R_ADOBE, position: 1, name: "Adobe", class: "sanctioned_app", conditions: [{ field: "vendor", operator: "equals", value: "Adobe" }] }),
    rule({
      id: "y",
      lineage_id: R_VPN,
      position: 2,
      name: "7-Zip legacy",
      class: "tolerated_app",
      owner: "IT",
      risk_accepted_by: "CISO",
      review_by: "2026-12-01",
      conditions: [{ field: "name", operator: "equals", value: "7-Zip" }],
    }),
  ],
};

function fake(state: unknown, writeError: { message: string; code?: string } | null = null) {
  const write = vi.fn(async (name: string) => ({ data: (writeError ? null : name === "policy_save_rule" ? R_ADOBE : name === "policy_move_rule" ? 1 : null) as never, error: writeError }));
  const data: McpData = {
    view: vi.fn(async () => ({ data: [{ id: T1, name: "Acme", role: "admin", active_computers: 8, retired_computers: 0, last_synced_at: null }], error: null })) as McpData["view"],
    list: vi.fn(async () => ({ data: [], error: null, count: 0 })) as McpData["list"],
    rpc: vi.fn(async (name: string) => ({ data: (name === "policy_get" ? state : name === "policy_preview_inputs" ? pairs : null) as never, error: null })) as McpData["rpc"],
    write: write as McpData["write"],
  };
  return { data, write };
}
const noDraft = { published, draft: null, versions: [], can_edit: true };
const kevRule = { name: "KEV", class: "unsanctioned_app", conditions: [{ field: "kev", operator: "equals", value: "true" }] };

describe("scope", () => {
  it("refuses a read token before touching anything", async () => {
    const { data, write } = fake(noDraft);
    await expect(draftSaveRule(data, reader, { tenant_id: T1, rule: kevRule })).rejects.toThrow("can only read");
    await expect(draftMoveRule(data, reader, { tenant_id: T1, rule_id: R_ADOBE, position: 2 })).rejects.toThrow("can only read");
    await expect(draftSetRuleEnabled(data, reader, { tenant_id: T1, rule_id: R_ADOBE, enabled: false })).rejects.toThrow("can only read");
    expect(write).not.toHaveBeenCalled();
    expect(data.rpc).not.toHaveBeenCalled();
  });
});

describe("draft_save_rule", () => {
  it("adds a rule with the impact on the draft, and never an acceptance", async () => {
    const { data, write } = fake(noDraft);
    const out = await draftSaveRule(data, drafter, { tenant_id: T1, rule: kevRule, position: 1 }, TODAY);
    const sent = write.mock.calls[0];
    expect(sent[0]).toBe("policy_save_rule");
    expect(sent[1]).toMatchObject({ p_tenant_id: T1, p_rule: { lineage_id: null, position: 1, risk_accepted_by: null, enabled: true } });
    expect(out.result).toMatchObject({
      saved: true,
      action: "added",
      draft: { created_now: true, based_on: "published version 3" },
      draft_impact: { changed_pairs: 1, changed_installations: 3, more_restrictive: 1, versions_decided_by_this_rule: 1 },
      console_path: `/policies/rules/${R_ADOBE}`,
    });
    expect(String(out.result.next_step)).toContain("a person reviews the draft and publishes");
  });

  it("asks a person for the missing exception fields of a tolerated rule", async () => {
    const { data } = fake(noDraft);
    const out = await draftSaveRule(data, drafter, { tenant_id: T1, rule: { ...kevRule, class: "tolerated_app" }, exception: { owner: "IT" } }, TODAY);
    expect(out.result.a_person_must_fill).toEqual(["business purpose", "mitigating controls", "review date", "who accepts the risk (risk_accepted_by)"]);
  });

  it("keeps a person's acceptance while the scope stays the same", async () => {
    const { data, write } = fake(noDraft);
    const same = { name: "7-Zip legacy (renamed)", class: "tolerated_app", kinds: ["program"], conditions: [{ field: "name", operator: "equals", value: "7-Zip" }] };
    const out = await draftSaveRule(data, drafter, { tenant_id: T1, rule_id: R_VPN, rule: same, exception: { business_purpose: "Old archives" } }, TODAY);
    expect(write.mock.calls[0][1]).toMatchObject({ p_rule: { lineage_id: R_VPN, risk_accepted_by: "CISO", owner: "IT", business_purpose: "Old archives", review_by: "2026-12-01" } });
    expect(out.result.acceptance_cleared).toBeUndefined();
    expect(out.result).toMatchObject({ action: "changed", draft_impact: { changed_pairs: 0 } });
  });

  it("clears the acceptance when the rule matches something else", async () => {
    const { data, write } = fake(noDraft);
    const wider = { name: "7-Zip", class: "tolerated_app", kinds: ["program"], conditions: [{ field: "name", operator: "contains", value: "Zip" }] };
    const out = await draftSaveRule(data, drafter, { tenant_id: T1, rule_id: R_VPN, rule: wider }, TODAY);
    expect(write.mock.calls[0][1]).toMatchObject({ p_rule: { risk_accepted_by: null } });
    expect(out.result.acceptance_cleared).toContain("accept the risk again");
  });

  it("refuses review dates in the past or beyond a month", () => {
    expect(reviewDate("2026-12-10", TODAY)).toBe("2026-12-10");
    expect(() => reviewDate("2026-11-15", TODAY)).toThrow("in the past");
    expect(() => reviewDate("2027-01-31", TODAY)).toThrow("within 31 days");
    expect(() => reviewDate("next week", TODAY)).toThrow("YYYY-MM-DD");
  });

  it("refuses an unknown rule id and an invalid rule without writing", async () => {
    const { data, write } = fake(noDraft);
    await expect(draftSaveRule(data, drafter, { tenant_id: T1, rule_id: "c0000000-0000-0000-0000-000000000000", rule: kevRule }, TODAY)).rejects.toThrow("Rule not found");
    await expect(draftSaveRule(data, drafter, { tenant_id: T1, rule: { name: "x", class: "sanctioned_app", conditions: [] } }, TODAY)).rejects.toThrow("not valid");
    expect(write).not.toHaveBeenCalled();
  });

  it("passes the database's refusal on in words", async () => {
    const { data } = fake(noDraft, { code: "42501", message: "Only admins of this tenant can change its application policy" });
    await expect(draftSaveRule(data, drafter, { tenant_id: T1, rule: kevRule }, TODAY)).rejects.toThrow("Only admins of this tenant can change its policy draft");
  });
});

describe("draft_move_rule and draft_set_rule_enabled", () => {
  it("moves a rule and reports what the move changes", async () => {
    const { data, write } = fake(noDraft);
    const out = await draftMoveRule(data, drafter, { tenant_id: T1, rule_id: R_VPN, position: 1 });
    expect(write).toHaveBeenCalledWith("policy_move_rule", { p_tenant_id: T1, p_lineage_id: R_VPN, p_position: 1 });
    expect(out.result).toMatchObject({ from_position: 2, to_position: 1, draft_impact: { changed_pairs: 0 } });
  });

  it("turning a rule off shows the versions that fall to the default class", async () => {
    const { data, write } = fake(noDraft);
    const out = await draftSetRuleEnabled(data, drafter, { tenant_id: T1, rule_id: R_ADOBE, enabled: false });
    expect(write).toHaveBeenCalledWith("policy_set_rule_enabled", { p_tenant_id: T1, p_lineage_id: R_ADOBE, p_enabled: false });
    expect(out.result).toMatchObject({
      enabled: false,
      was_enabled: true,
      draft_impact: { changed_pairs: 2, changed_installations: 8, more_restrictive: 2, transitions: [{ from: "sanctioned_app", to: "unsanctioned_app", versions: 2, installations: 8 }] },
    });
  });
});
