import { describe, expect, it } from "vitest";
import {
  compareVersions,
  conditionText,
  evaluate,
  explain,
  testCondition,
  traceText,
  validateCondition,
  validateRule,
  type PolicyCondition,
  type PolicyInput,
  type PolicyRule,
} from "./policy.ts";
import { FIXTURE_DEFAULT, FIXTURE_RULES, FIXTURE_TITLES } from "./policy.fixture.ts";

const acrobat: PolicyInput = {
  kind: "program",
  name: "Adobe Acrobat Reader DC",
  vendor: "Adobe Systems Incorporated",
  external_id: null,
  version: "21.011.20039",
  category_slug: "general-business",
  category_name: "General business",
  subcategory_slug: "general-business/office-and-documents",
  subcategory_name: "Office and documents",
};
const t = (c: PolicyCondition, input: PolicyInput = acrobat) => testCondition(c, input);
const rule = (over: Partial<PolicyRule>): PolicyRule => ({
  id: "r",
  name: "Rule",
  class: "sanctioned_app",
  match: "all",
  kinds: ["program", "extension", "ide_extension", "package"],
  enabled: true,
  conditions: [{ field: "vendor", operator: "contains", value: "adobe" }],
  ...over,
});

describe("compareVersions", () => {
  it("compares number by number, not as text", () => {
    expect(compareVersions("10.2", "9.14")).toBe(1);
    expect(compareVersions("21.011.20039", "24")).toBe(-1);
    expect(compareVersions("24.003.20180", "24")).toBe(1);
    expect(compareVersions("1.0", "1")).toBe(0); // missing parts count as 0
    expect(compareVersions("1.2-beta", "1.2-alpha")).toBe(1); // text parts compare as text
    expect(compareVersions("150-97", "150 97")).toBe(0); // - and space are separators
    expect(compareVersions("4.6.5", "4.6.5")).toBe(0);
  });
});

describe("text operators", () => {
  it("ignore case unless case_sensitive", () => {
    expect(t({ field: "vendor", operator: "contains", value: "ADOBE" })).toBe(true);
    expect(t({ field: "vendor", operator: "contains", value: "ADOBE", case_sensitive: true })).toBe(false);
    expect(t({ field: "name", operator: "equals", value: "adobe acrobat reader dc" })).toBe(true);
    expect(t({ field: "name", operator: "not_equals", value: "adobe acrobat reader dc" })).toBe(false);
  });

  it("contains, starts with, ends with and their empty-value rules", () => {
    expect(t({ field: "name", operator: "not_contains", value: "Zoom" })).toBe(true);
    expect(t({ field: "name", operator: "starts_with", value: "adobe" })).toBe(true);
    expect(t({ field: "name", operator: "ends_with", value: "DC" })).toBe(true);
    expect(t({ field: "name", operator: "contains", value: "" })).toBe(false);
    expect(t({ field: "name", operator: "not_contains", value: "" })).toBe(true);
  });

  it("in / not_in read values[] or a comma-separated value", () => {
    expect(t({ field: "vendor", operator: "in", value: "Microsoft, adobe systems incorporated" })).toBe(true);
    expect(t({ field: "vendor", operator: "in", values: ["Google"] })).toBe(false);
    expect(t({ field: "vendor", operator: "not_in", value: "Google, Zoom" })).toBe(true);
  });

  it("regex ignores case unless case_sensitive; an invalid pattern never matches", () => {
    expect(t({ field: "name", operator: "regex", value: "acrobat|reader" })).toBe(true);
    expect(t({ field: "name", operator: "regex", value: "acrobat", case_sensitive: true })).toBe(false);
    expect(t({ field: "name", operator: "regex", value: "(" })).toBe(false);
  });

  it("an empty field reads as an empty string", () => {
    expect(t({ field: "external_id", operator: "equals", value: "x" })).toBe(false);
    expect(t({ field: "external_id", operator: "not_equals", value: "x" })).toBe(true);
  });
});

describe("category operators", () => {
  it("match the slug or the name, ignoring case", () => {
    expect(t({ field: "category", operator: "equals", value: "general-business" })).toBe(true);
    expect(t({ field: "category", operator: "equals", value: "General Business" })).toBe(true);
    expect(t({ field: "subcategory", operator: "in", values: ["remote-access/remote-desktop-and-support", "general-business/office-and-documents"] })).toBe(true);
    expect(t({ field: "subcategory", operator: "not_in", values: ["Office and documents"] })).toBe(false);
    expect(t({ field: "category", operator: "not_equals", value: "Remote access" })).toBe(true);
  });

  it("an unclassified title has no category", () => {
    const none = { ...acrobat, category_slug: null, category_name: null };
    expect(t({ field: "category", operator: "equals", value: "" }, none)).toBe(false);
    expect(t({ field: "category", operator: "not_in", values: ["general-business"] }, none)).toBe(true);
  });
});

describe("version operators", () => {
  it("compare the installed version", () => {
    expect(t({ field: "version", operator: "lt", value: "24" })).toBe(true);
    expect(t({ field: "version", operator: "lte", value: "21.11.20039" })).toBe(true);
    expect(t({ field: "version", operator: "gt", value: "21.011" })).toBe(true);
    expect(t({ field: "version", operator: "gte", value: "22" })).toBe(false);
    expect(t({ field: "version", operator: "equals", value: "21.11.20039.0" })).toBe(true);
    expect(t({ field: "version", operator: "not_equals", value: "21" })).toBe(true);
  });

  it("between is inclusive", () => {
    expect(t({ field: "version", operator: "between", value: "21.011.20039", value2: "24" })).toBe(true);
    expect(t({ field: "version", operator: "between", value: "20", value2: "21.011.20039" })).toBe(true);
    expect(t({ field: "version", operator: "between", value: "22", value2: "24" })).toBe(false);
  });

  it("a missing version never matches a comparison", () => {
    const noVersion = { ...acrobat, version: null };
    expect(t({ field: "version", operator: "lt", value: "24" }, noVersion)).toBe(false);
    expect(t({ field: "version", operator: "not_equals", value: "24" }, noVersion)).toBe(false);
    expect(t({ field: "version", operator: "regex", value: "^21\\." })).toBe(true);
  });
});

describe("vulnerability fields (Phase 10b)", () => {
  const vulnerable = { ...acrobat, max_cvss: 9.8, kev: true, max_epss: 0.94 };
  it("compare the highest CVSS and EPSS as numbers; none reads as 0", () => {
    expect(t({ field: "cvss", operator: "gte", value: "9" }, vulnerable)).toBe(true);
    expect(t({ field: "cvss", operator: "gte", value: "9" })).toBe(false);
    expect(t({ field: "cvss", operator: "equals", value: "0" })).toBe(true);
    expect(t({ field: "cvss", operator: "between", value: "7", value2: "10" }, vulnerable)).toBe(true);
    expect(t({ field: "epss", operator: "gt", value: "0.1" }, vulnerable)).toBe(true);
    expect(t({ field: "epss", operator: "lt", value: "abc" }, vulnerable)).toBe(false);
  });

  it("known exploited is yes or no", () => {
    expect(t({ field: "kev", operator: "equals", value: "true" }, vulnerable)).toBe(true);
    expect(t({ field: "kev", operator: "equals", value: "true" })).toBe(false);
    expect(t({ field: "kev", operator: "not_equals", value: "true" })).toBe(true);
    expect(t({ field: "kev", operator: "equals", value: "false" })).toBe(true);
  });

  it("validate the number range and the yes/no value", () => {
    expect(validateCondition({ field: "cvss", operator: "gte", value: "11" })).toMatch(/0 to 10/);
    expect(validateCondition({ field: "epss", operator: "gte", value: "50" })).toMatch(/0 to 1/);
    expect(validateCondition({ field: "cvss", operator: "between", value: "9", value2: "7" })).toMatch(/lower number first/);
    expect(validateCondition({ field: "cvss", operator: "contains", value: "9" })).toMatch(/does not apply/);
    expect(validateCondition({ field: "kev", operator: "equals", value: "maybe" })).toMatch(/yes or no/);
    expect(validateCondition({ field: "kev", operator: "equals", value: "true" })).toBeNull();
    expect(validateCondition({ field: "cvss", operator: "gte", value: "7.5" })).toBeNull();
    expect(conditionText({ field: "kev", operator: "equals", value: "true" })).toBe("Known exploited (CISA KEV) is yes");
  });
});

describe("rules", () => {
  it("AND needs every condition, OR needs one", () => {
    const conds: PolicyCondition[] = [
      { field: "vendor", operator: "contains", value: "adobe" },
      { field: "version", operator: "gte", value: "24" },
    ];
    expect(evaluate([rule({ conditions: conds })], acrobat, "unsanctioned_app").ruleIndex).toBe(-1);
    expect(evaluate([rule({ conditions: conds, match: "any" })], acrobat, "unsanctioned_app").ruleIndex).toBe(0);
  });

  it("apply only to the kinds they list and skip disabled rules", () => {
    expect(evaluate([rule({ kinds: ["extension"] })], acrobat, "tolerated_app")).toEqual({ class: "tolerated_app", ruleIndex: -1, ruleId: null });
    expect(evaluate([rule({ enabled: false })], acrobat, "tolerated_app").ruleId).toBeNull();
    expect(evaluate([rule({ conditions: [] })], acrobat, "tolerated_app").ruleId).toBeNull();
  });

  it("run top down and the first match wins", () => {
    const rules = [rule({ id: "a", class: "unsanctioned_app" }), rule({ id: "b", class: "sanctioned_app" })];
    expect(evaluate(rules, acrobat, "core_system")).toEqual({ class: "unsanctioned_app", ruleIndex: 0, ruleId: "a" });
    expect(evaluate([...rules].reverse(), acrobat, "core_system").ruleId).toBe("b");
  });

  it("explain says why each earlier rule did not match", () => {
    const rules = [
      rule({ id: "off", enabled: false }),
      rule({ id: "ext", kinds: ["extension"] }),
      rule({ id: "new", conditions: [{ field: "version", operator: "gte", value: "24" }] }),
      rule({ id: "or", match: "any", conditions: [{ field: "name", operator: "equals", value: "Zoom" }] }),
      rule({ id: "hit", class: "unsanctioned_app" }),
    ];
    const { result, trace } = explain(rules, acrobat, "core_system");
    expect(result).toEqual({ class: "unsanctioned_app", ruleIndex: 4, ruleId: "hit" });
    expect(trace.map((x) => traceText(x))).toEqual([
      "Rule is disabled",
      "Does not apply to this kind",
      "Version ≥ 24 is false (21.011.20039)",
      "No condition matches",
      "Matches",
    ]);
  });
});

describe("validation", () => {
  it("checks operators per field, regex, lists and between", () => {
    expect(validateCondition({ field: "category", operator: "contains", value: "x" })).toMatch(/does not apply/);
    expect(validateCondition({ field: "name", operator: "regex", value: "(" })).toBe("Invalid regular expression");
    expect(validateCondition({ field: "name", operator: "regex", value: "a".repeat(201) })).toMatch(/200/);
    expect(validateCondition({ field: "name", operator: "in", value: " , " })).toBe("Enter at least one value");
    expect(validateCondition({ field: "version", operator: "between", value: "24", value2: "9" })).toBe("Put the lower version first");
    expect(validateCondition({ field: "version", operator: "between", value: "9", value2: "24" })).toBeNull();
    expect(validateCondition({ field: "vendor", operator: "equals", value: " " })).toBe("Enter a value");
    expect(validateRule({ name: "", kinds: [], conditions: [] })).toEqual(["Enter a rule name", "Select at least one kind", "Add at least one condition"]);
  });

  it("writes conditions as readable text", () => {
    expect(conditionText({ field: "subcategory", operator: "in", values: ["a/b", "c/d"] }, (s) => s.toUpperCase())).toBe("Subcategory is one of A/B, C/D");
    expect(conditionText({ field: "version", operator: "between", value: "1", value2: "2" })).toBe("Version between 1 and 2");
    expect(conditionText({ field: "name", operator: "contains", value: "x", case_sensitive: true })).toBe("App name contains x (case-sensitive)");
  });
});

describe("sample policy (design/reference/policy-evaluator.js)", () => {
  it("gives the expected totals", () => {
    const counts: Record<string, number> = {};
    let byDefault = 0;
    for (const title of FIXTURE_TITLES) {
      const r = evaluate(FIXTURE_RULES, title, FIXTURE_DEFAULT);
      counts[r.class] = (counts[r.class] ?? 0) + 1;
      if (r.ruleIndex < 0) byDefault++;
    }
    expect(FIXTURE_TITLES).toHaveLength(42);
    expect(FIXTURE_RULES).toHaveLength(12);
    expect(counts).toEqual({ core_system: 6, sanctioned_app: 13, tolerated_app: 7, unsanctioned_app: 16 });
    expect(byDefault).toBe(9);
  });

  it("catches Acrobat below 24 before the business suite rule", () => {
    const reader = FIXTURE_TITLES.find((x) => x.name === "Adobe Acrobat Reader DC")!;
    expect(evaluate(FIXTURE_RULES, reader, FIXTURE_DEFAULT).ruleId).toBe("r3");
    const acrobat64 = FIXTURE_TITLES.find((x) => x.name === "Adobe Acrobat (64-bit)")!;
    expect(evaluate(FIXTURE_RULES, acrobat64, FIXTURE_DEFAULT).ruleId).toBe("r4");
    // The same title on an older installed version falls to rule 3.
    expect(evaluate(FIXTURE_RULES, { ...acrobat64, version: "23.008.20470" }, FIXTURE_DEFAULT).ruleId).toBe("r3");
  });
});
