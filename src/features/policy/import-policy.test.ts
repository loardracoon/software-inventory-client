import { describe, expect, it } from "vitest";
import { parsePolicyFile } from "./import-policy";

const rule = (over: Record<string, unknown> = {}) => ({
  position: 1,
  name: "Remote tools",
  class: "unsanctioned_app",
  match: "any",
  kinds: ["program"],
  enabled: true,
  conditions: [{ field: "name", operator: "contains", value: "anydesk" }],
  ...over,
});

describe("parsePolicyFile", () => {
  it("reads an exported policy in its rule order", () => {
    const file = JSON.stringify({ version: 3, status: "published", default_class: "tolerated_app", rules: [rule({ position: 2, name: "B" }), rule({ position: 1, name: "A" })] });
    const r = parsePolicyFile(file);
    expect(r.ok && r.policy.rules.map((x) => x.name)).toEqual(["A", "B"]);
    expect(r.ok && r.policy.default_class).toBe("tolerated_app");
  });

  it("lists every problem with the rule it belongs to", () => {
    const file = JSON.stringify({
      default_class: "allowed",
      rules: [rule({ class: "blocked" }), rule({ name: "", kinds: ["driver"] }), rule({ conditions: [{ field: "cvss", operator: "gte", value: "12" }] })],
    });
    const r = parsePolicyFile(file);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors).toEqual([
      'Unknown default class "allowed"',
      'Rule 1 "Remote tools": unknown class "blocked"',
      "Rule 2: unknown kind driver",
      "Rule 2: Enter a rule name",
      'Rule 3 "Remote tools": Condition 1: Enter a number from 0 to 10',
    ]);
  });

  it("refuses files that are not exported policies", () => {
    expect(parsePolicyFile("not json")).toEqual({ ok: false, errors: ["The file is not JSON"] });
    expect(parsePolicyFile('{"name": "x"}')).toEqual({ ok: false, errors: ["The file is not an exported policy (no rules list)"] });
    expect(parsePolicyFile(JSON.stringify({ rules: Array.from({ length: 501 }, () => rule()) })).ok).toBe(false);
  });
});
