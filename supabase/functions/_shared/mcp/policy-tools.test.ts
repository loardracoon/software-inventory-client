import { describe, expect, it, vi } from "vitest";
import {
  deriveRisks,
  getPolicy,
  listRisks,
  proposedRule,
  simulate,
  simulateRule,
  suggestRule,
  suggestRuleForRisk,
  testTitleAgainstPolicy,
  type PreviewInput,
  type Risk,
} from "./policy-tools";
import type { McpCaller, McpData } from "./tools";

const T1 = "11111111-1111-1111-1111-111111111111";
const ACRO = "a1000000-0000-0000-0000-000000000001";
const ZIP = "a2000000-0000-0000-0000-000000000002";
const CRD = "a3000000-0000-0000-0000-000000000003";
const caller: McpCaller = { userId: "u1", tokenId: "t1", scope: "read", showUsernames: false };

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
  pair({ title_id: ACRO, name: "Adobe Acrobat", vendor: "Adobe", version: "23.008", computers: 3, installations: 3, current_class: "sanctioned_app", current_rule_id: "r-adobe", kev: true, max_cvss: 9.8 }),
  pair({ title_id: ACRO, name: "Adobe Acrobat", vendor: "Adobe", version: "25.001", computers: 5, installations: 5, current_class: "sanctioned_app", current_rule_id: "r-adobe" }),
  pair({ title_id: ZIP, name: "7-Zip", vendor: "Igor Pavlov", version: "16.04", computers: 2, installations: 2, eol: true }),
  pair({ title_id: CRD, name: "Chrome Remote Desktop", kind: "extension", version: "124.0", computers: 1, installations: 1, max_epss: 0.6 }),
];

const rule = (r: Record<string, unknown>) => ({ position: 1, owner: null, business_purpose: null, mitigating_controls: null, risk_accepted_by: null, review_by: null, alert_on_new: false, enabled: true, match: "all", ...r });
const published = {
  version: 3,
  status: "published",
  default_class: "unsanctioned_app" as const,
  published_at: "2026-11-01",
  published_by: "admin@example.com",
  evaluated_at: "2026-11-02",
  rules: [
    rule({ id: "x", lineage_id: "r-adobe", name: "Adobe", class: "sanctioned_app", kinds: ["program"], conditions: [{ field: "vendor", operator: "equals", value: "Adobe" }] }),
    rule({ id: "y", lineage_id: "r-gen-ai", position: 2, name: "Gen AI", class: "tolerated_app", kinds: ["extension"], owner: "Eng", review_by: "2026-11-14", conditions: [{ field: "name", operator: "contains", value: "AI" }] }),
  ],
};
const draft = { ...published, version: 4, status: "draft", rules: [...published.rules, rule({ id: "z", lineage_id: "r-new", position: 3, name: "VPN", class: "tolerated_app", kinds: ["program"], conditions: [{ field: "name", operator: "contains", value: "VPN" }] })] };
const state = { published, draft, versions: [], can_edit: true };

function fake(rpcs: Record<string, unknown> = {}) {
  const data: McpData = {
    view: vi.fn(async () => ({ data: [{ id: T1, name: "Acme", role: "admin", active_computers: 8, retired_computers: 0, last_synced_at: null }], error: null })) as McpData["view"],
    list: vi.fn(async () => ({ data: [], error: null, count: 0 })) as McpData["list"],
    rpc: vi.fn(async (name: string) => ({ data: (rpcs[name] ?? null) as never, error: null })) as McpData["rpc"],
  };
  return data;
}

describe("proposedRule", () => {
  it("accepts a valid rule and fills defaults", () => {
    expect(proposedRule({ name: "KEV", class: "unsanctioned_app", conditions: [{ field: "kev", operator: "equals", value: "true" }] })).toMatchObject({
      match: "all",
      kinds: ["program", "extension", "ide_extension", "package"],
    });
  });

  it("refuses what the editor refuses", () => {
    expect(() => proposedRule({ name: "x", class: "allowed", conditions: [] })).toThrow("rule.class");
    expect(() => proposedRule({ name: "x", class: "sanctioned_app", conditions: [] })).toThrow("Add at least one condition");
    expect(() => proposedRule({ name: "x", class: "sanctioned_app", conditions: [{ field: "kev", operator: "contains", value: "x" }] })).toThrow("does not apply");
    expect(() => proposedRule({ name: "x", class: "sanctioned_app", conditions: [{ field: "cvss", operator: "gte", value: "11" }] })).toThrow("from 0 to 10");
    expect(() => proposedRule({ name: "x", class: "sanctioned_app", conditions: [{ field: "name", operator: "regex", value: "(" }] })).toThrow("Invalid regular expression");
  });
});

describe("simulate", () => {
  it("counts the versions a KEV rule on top would move, and which way", () => {
    const sim = simulate(published, "published", proposedRule({ name: "KEV", class: "unsanctioned_app", conditions: [{ field: "kev", operator: "equals", value: "true" }] }), 1, pairs);
    expect(sim).toMatchObject({ position: 1, pairs_evaluated: 4, changed_pairs: 1, changed_installations: 3, more_restrictive: 1, less_restrictive: 0, shadowed: false });
    expect(sim.transitions).toEqual([{ from: "sanctioned_app", to: "unsanctioned_app", versions: 1, installations: 3 }]);
    expect(sim.top_changed_titles).toEqual([{ title_id: ACRO, name: "Adobe Acrobat", kind: "program", versions: ["23.008"], from: "sanctioned_app", to: "unsanctioned_app", computers: 3 }]);
  });

  it("says when a rule below another never decides anything", () => {
    const sim = simulate(published, "published", proposedRule({ name: "Acrobat", class: "tolerated_app", conditions: [{ field: "name", operator: "equals", value: "Adobe Acrobat" }] }), 3, pairs);
    expect(sim).toMatchObject({ position: 3, changed_pairs: 0, shadowed: true });
  });

  it("counts relaxing moves as less restrictive", () => {
    const sim = simulate(published, "published", proposedRule({ name: "7-Zip", class: "sanctioned_app", conditions: [{ field: "name", operator: "equals", value: "7-Zip" }] }), 1, pairs);
    expect(sim).toMatchObject({ changed_pairs: 1, less_restrictive: 1 });
  });
});

describe("deriveRisks", () => {
  const risks = deriveRisks({
    pairs,
    state,
    attention: [{ title_id: CRD, canonical_name: "Chrome Remote Desktop", kind: "extension", attention_level: "review", category_slug: "remote-access/remote-desktop-and-support", level2_name: "Remote desktop", computers: 1 }],
    today: "2026-11-16",
  });
  const kinds = risks.map((r) => `${r.kind}:${r.subject.name}`);

  it("finds every kind and puts a sanctioned KEV first", () => {
    expect(risks[0]).toMatchObject({ kind: "kev_installed", severity: "critical", subject: { title_id: ACRO, versions: ["23.008"] }, computers: 3 });
    expect(kinds).toContain("critical_vuln:Chrome Remote Desktop");
    expect(kinds).toContain("eol_installed:7-Zip");
    expect(kinds).toContain("unsanctioned_installed:7-Zip");
    expect(kinds).toContain("exception_overdue:Gen AI");
    expect(kinds).toContain("exception_incomplete:VPN");
    expect(kinds).toContain("unclassified_attention:Chrome Remote Desktop");
  });

  it("decides classes with the published policy, so an unevaluated policy hides nothing (end-to-end finding)", () => {
    const unevaluated = pairs.map((p) => ({ ...p, current_class: null, current_rule_id: null }));
    const found = deriveRisks({ pairs: unevaluated, state, attention: [], today: "2026-11-16" });
    expect(found.filter((r) => r.kind === "unsanctioned_installed").map((r) => r.subject.name)).toEqual(["7-Zip", "Chrome Remote Desktop"]);
    expect(found.find((r) => r.kind === "kev_installed")?.severity).toBe("critical");
  });

  it("does not repeat a KEV title as a critical vulnerability and lists what an exception misses", () => {
    expect(kinds.filter((k) => k.endsWith("Adobe Acrobat"))).toEqual(["kev_installed:Adobe Acrobat"]);
    const incomplete = (name: string) => risks.find((r) => r.kind === "exception_incomplete" && r.subject.name === name)?.evidence.missing;
    expect(incomplete("VPN")).toEqual(["owner", "business_purpose", "mitigating_controls", "risk_accepted_by", "review_by"]);
    expect(incomplete("Gen AI")).toEqual(["business_purpose", "mitigating_controls", "risk_accepted_by"]);
  });
});

describe("suggestRule", () => {
  const titleRisk: Risk = { kind: "unsanctioned_installed", severity: "high", subject: { title_id: ZIP, name: "7-Zip", kind: "program" }, computers: 2, evidence: {}, next_step: "" };

  it("answers vulnerability risks with a field rule on top", () => {
    const s = suggestRule({ ...titleRisk, kind: "kev_installed" }, "remove");
    expect(s.rule?.conditions).toEqual([{ field: "kev", operator: "equals", value: "true" }]);
    expect(s.position).toBe(1);
    expect(proposedRule(s.rule)).toBeTruthy();
  });

  it("offers remove, tolerate or sanction for a title, and the tolerate path lists what a person fills", () => {
    expect(suggestRule(titleRisk, "remove").rule).toMatchObject({ class: "unsanctioned_app", kinds: ["program"], conditions: [{ field: "name", operator: "equals", value: "7-Zip" }] });
    const tolerate = suggestRule(titleRisk, "tolerate");
    expect(tolerate.rule?.class).toBe("tolerated_app");
    expect(tolerate.a_person_must.join(" ")).toContain("risk_accepted_by");
    expect(suggestRule(titleRisk, "sanction").rule?.class).toBe("sanctioned_app");
  });

  it("does not invent a rule for an exception review", () => {
    expect(suggestRule({ ...titleRisk, kind: "exception_overdue", subject: { name: "Gen AI", rule_id: "r-gen-ai" } }, "remove").rule).toBeNull();
  });
});

describe("handlers", () => {
  it("get_policy shows both versions in words and hides the publisher while masked", async () => {
    const out = await getPolicy(fake({ policy_get: state }), caller, {});
    const pub = out.result.published as { published_by?: string; rules: { conditions: string[]; exception?: unknown }[] };
    expect(pub.published_by).toBeUndefined();
    expect(pub.rules[0].conditions).toEqual(["Vendor / publisher is Adobe"]);
    expect(pub.rules[1].exception).toMatchObject({ owner: "Eng", review_by: "2026-11-14" });
    expect((out.result.draft as { rules: unknown[] }).rules).toHaveLength(3);
  });

  it("test_title_against_policy explains each version", async () => {
    const out = await testTitleAgainstPolicy(fake({ policy_get: state, policy_preview_inputs: pairs }), caller, { title_id: ZIP });
    expect(out.result.versions).toMatchObject([{ version: "16.04", class: "unsanctioned_app", decided_by: "default class" }]);
    const trace = (out.result.versions as { trace: string[] }[])[0].trace;
    expect(trace[0]).toMatch(/^rule 1 \(Adobe\): /);
    await expect(testTitleAgainstPolicy(fake({ policy_get: state, policy_preview_inputs: [] }), caller, { title_id: ZIP })).rejects.toThrow("not installed");
  });

  it("simulate_rule never saves and uses the draft by default", async () => {
    const data = fake({ policy_get: state, policy_preview_inputs: pairs });
    const out = await simulateRule(data, caller, { rule: { name: "EOL", class: "unsanctioned_app", conditions: [{ field: "eol", operator: "equals", value: "true" }] } });
    expect(out.result).toMatchObject({ saved: false, simulation: { base: { which: "draft", version: 4 }, changed_pairs: 0, shadowed: false } });
    const called = (data.rpc as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(called.every((n: string) => ["policy_get", "policy_preview_inputs"].includes(n))).toBe(true);
  });

  it("list_risks counts by kind and filters", async () => {
    const data = fake({ policy_get: state, policy_preview_inputs: pairs, search_titles: [] });
    const all = await listRisks(data, caller, {});
    expect(all.result.by_kind).toMatchObject({ kev_installed: 1, eol_installed: 1, exception_overdue: 1 });
    const only = await listRisks(data, caller, { kinds: ["eol_installed"] });
    expect(only.result.total).toBe(1);
  });

  it("suggest_rule_for_risk proposes and simulates without saving", async () => {
    const data = fake({ policy_get: state, policy_preview_inputs: pairs, search_titles: [] });
    const out = await suggestRuleForRisk(data, caller, { kind: "kev_installed", title_id: ACRO });
    expect(out.result).toMatchObject({ saved: false, suggestion: { position: 1 }, simulation: { changed_pairs: 1 } });
    await expect(suggestRuleForRisk(data, caller, { kind: "kev_installed", title_id: ZIP })).rejects.toThrow("No such risk");
  });
});
