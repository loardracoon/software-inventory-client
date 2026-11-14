import { describe, expect, it } from "vitest";
import { buildEvidence, toCsv, zipEvidence, type ReportData } from "./evidence.ts";

const data: ReportData = {
  computers: [{ hostname: "A", sophos_endpoint_id: "e1", platform: "windows", associated_user: "x@y.z", scope_tags: ["pci", "prod"] }],
  software: [{ hostname: "A", canonical_name: "Chrome", version: "1" }, { hostname: "A", canonical_name: "7zip", version: null }],
  vulnerabilities: [],
  exceptions: [{ name: "Tool", reason: "needed", review_by: "2027-01-01", owner: "me" }],
  coverage: { total: 1 },
  policy: { version: 3 },
  scope_statement: "Managed computers.",
  users_masked: false,
};
const meta = {
  reportId: "r1",
  tenant: { id: "t1", name: "Lab" },
  asOf: "2026-11-01T00:00:00.000Z",
  generatedAt: "2026-11-14T12:00:00.000Z",
  generatedBy: "admin@example.com",
  scopeTag: null,
  appVersion: "dev",
};
const sha = async (b: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource))].map((x) => x.toString(16).padStart(2, "0")).join("");

describe("evidence package", () => {
  it("csv escaping", () => {
    const csv = toCsv(["a", "b"], [["x,y", 'say "hi"'], ["line\nbreak", "=SUM(1)"], [null, "+1"]]);
    expect(csv).toBe("﻿a,b\r\n\"x,y\",\"say \"\"hi\"\"\"\r\n\"line\nbreak\",'=SUM(1)\r\n,'+1\r\n");
  });

  it("builds the nine files in order with hashes", async () => {
    const e = await buildEvidence(data, meta);
    expect(e.files.map((f) => f.name)).toEqual([
      "computers.csv", "software.csv", "vulnerabilities.csv", "exceptions.csv", "coverage.json", "policy.json", "scope.txt", "data.json", "manifest.json",
    ]);
    expect(e.files.slice(0, 4).map((f) => f.rows)).toEqual([1, 2, 0, 1]);
    for (const [i, f] of e.manifest.files.entries()) {
      expect(f.name).toBe(e.files[i].name);
      expect(f.sha256).toBe(await sha(e.files[i].bytes));
      expect(f.bytes).toBe(e.files[i].bytes.length);
    }
    expect(e.manifest.files).toHaveLength(8);
    expect(e.manifestSha256).toBe(await sha(e.manifestBytes));
    expect(e.manifest).toMatchObject({ report_id: "r1", generated_by: "admin@example.com", scope_tag: null, app_version: "dev", users_masked: false });
  });

  it("download again is identical", async () => {
    const e = await buildEvidence(data, meta);
    expect(zipEvidence(e.files, e.manifestBytes)).toEqual(zipEvidence(e.files, e.manifestBytes));
  });
});
