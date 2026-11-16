import { describe, expect, it } from "vitest";
import { auditArguments, auditError, MAX_AUDIT_ARGUMENT_BYTES } from "./audit";

describe("auditArguments", () => {
  it("keeps ordinary arguments", () => {
    expect(auditArguments({ tenant_id: "t1", limit: 50 })).toEqual({ tenant_id: "t1", limit: 50 });
    expect(auditArguments(undefined)).toBeNull();
  });

  it("removes anything named like a secret, at any depth", () => {
    expect(auditArguments({ token: "eimcp_x", nested: { api_key: "k", Authorization: "Bearer x", name: "ok" } })).toEqual({
      token: "[removed]",
      nested: { api_key: "[removed]", Authorization: "[removed]", name: "ok" },
    });
  });

  it("cuts long strings and caps the stored size", () => {
    const long = auditArguments({ q: "x".repeat(2_000) }) as { q: string };
    expect(long.q.length).toBe(501);
    const many = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, "y".repeat(400)]));
    const capped = auditArguments(many) as { truncated: boolean; keys: string[] };
    expect(capped.truncated).toBe(true);
    expect(JSON.stringify(capped).length).toBeLessThan(MAX_AUDIT_ARGUMENT_BYTES);
  });

  it("keeps error messages short", () => {
    expect(auditError(new Error("e".repeat(900))).length).toBe(500);
    expect(auditError("plain")).toBe("plain");
  });
});
