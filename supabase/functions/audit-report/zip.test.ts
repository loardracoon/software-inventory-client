import { describe, expect, it } from "vitest";
import { buildEvidence, type ReportData } from "../_shared/evidence.ts";
import { zipEvidence } from "./zip.ts";

const data: ReportData = { computers: [], software: [], vulnerabilities: [], exceptions: [], patches: [], coverage: {}, policy: null, remediation: {}, scope_statement: "s", users_masked: false };

describe("zipEvidence", () => {
  it("download again is identical", async () => {
    const e = await buildEvidence(data, { reportId: "r1", tenant: { id: "t", name: "Lab" }, asOf: "2026-11-01T00:00:00.000Z", generatedAt: "2026-11-14T12:00:00.000Z", generatedBy: "a@b.c", scopeTag: null, appVersion: "dev" });
    expect(zipEvidence(e.files, e.manifestBytes)).toEqual(zipEvidence(e.files, e.manifestBytes));
  });
});
