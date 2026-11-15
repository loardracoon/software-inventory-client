import { describe, expect, it } from "vitest";
import { buildEvidence, bytesToPgHex, contentTooBig, pgHexToBytes, toCsv, type ReportData } from "./evidence.ts";

const data: ReportData = {
  computers: [{ hostname: "A", sophos_endpoint_id: "e1", platform: "windows", associated_user: "x@y.z", scope_tags: ["pci", "prod"] }],
  software: [{ hostname: "A", canonical_name: "Chrome", version: "1" }, { hostname: "A", canonical_name: "7zip", version: null }],
  vulnerabilities: [],
  patches: [{ hostname: "A", kb: "KB5034441", title: "Security Update (KB5034441)", installed_at: "2026-10-01", installed_by: "SYSTEM" }],
  exceptions: [{ name: "Tool", reason: "needed", review_by: "2027-01-01", owner: "me" }],
  coverage: { total: 1 },
  policy: { version: 3 },
  remediation: { open: 1, overdue: 2, resolved_in_time: 3, resolved_late: 4, oldest_open_days: 5 },
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

  it("builds the eleven files in order with hashes", async () => {
    const e = await buildEvidence(data, meta);
    expect(e.files.map((f) => f.name)).toEqual([
      "computers.csv", "software.csv", "vulnerabilities.csv", "exceptions.csv", "patches.csv", "coverage.json", "policy.json", "remediation.json", "scope.txt", "data.json", "manifest.json",
    ]);
    expect(e.files.slice(0, 4).map((f) => f.rows)).toEqual([1, 2, 0, 1]);
    for (const [i, f] of e.manifest.files.entries()) {
      expect(f.name).toBe(e.files[i].name);
      expect(f.sha256).toBe(await sha(e.files[i].bytes));
      expect(f.bytes).toBe(e.files[i].bytes.length);
    }
    expect(e.manifest.files).toHaveLength(10);
    expect(e.manifestSha256).toBe(await sha(e.manifestBytes));
    expect(e.manifest).toMatchObject({ report_id: "r1", generated_by: "admin@example.com", scope_tag: null, app_version: "dev", users_masked: false });
  });

  it("carries the end-of-life columns of software and operating systems (Stage 3)", async () => {
    const withEol: ReportData = {
      ...data,
      computers: [{ ...data.computers[0], os_eol_status: "ending_soon", os_eol_from: "2026-12-01" }],
      software: [{ hostname: "A", canonical_name: "7-Zip", version: "23.01", support_status: "eol", eol_from: "2024-06-01" }],
    };
    const e = await buildEvidence(withEol, meta);
    const text = (name: string) => new TextDecoder().decode(e.files.find((f) => f.name === name)!.bytes);
    const [computers, software] = [text("computers.csv").split("\r\n"), text("software.csv").split("\r\n")];
    expect(computers[0]).toContain("os_eol_status,os_eol_from");
    expect(computers[1]).toContain("ending_soon,2026-12-01");
    expect(software[0]).toContain("support_status,eol_from");
    expect(software[1]).toContain("eol,2024-06-01");
  });

  it("carries the deadline columns of vulnerabilities and the remediation summary (Stage 3)", async () => {
    const e = await buildEvidence({ ...data, vulnerabilities: [{ canonical_name: "7-Zip", version: "23.01", vuln_id: "CVE-1", due_at: "2026-12-01T00:00:00Z", status: "overdue" }] }, meta);
    const text = (name: string) => new TextDecoder().decode(e.files.find((f) => f.name === name)!.bytes);
    const rows = text("vulnerabilities.csv").split("\r\n");
    expect(rows[0]).toContain("due_at,status");
    expect(rows[1]).toContain("2026-12-01T00:00:00Z,overdue");
    expect(JSON.parse(text("remediation.json"))).toEqual({ open: 1, overdue: 2, resolved_in_time: 3, resolved_late: 4, oldest_open_days: 5 });
  });

  it("round-trips bytea hex, including 0x00, 0xff and empty", () => {
    const random = crypto.getRandomValues(new Uint8Array(1000));
    random.set([0, 255, 0, 255]);
    expect(pgHexToBytes(bytesToPgHex(random))).toEqual(random);
    expect(bytesToPgHex(new Uint8Array())).toBe("\\x");
    expect(pgHexToBytes("\\x")).toEqual(new Uint8Array());
    expect(bytesToPgHex(new Uint8Array([0, 255, 16]))).toBe("\\x00ff10");
    expect(pgHexToBytes("\\x00FF10")).toEqual(new Uint8Array([0, 255, 16]));
  });

  it("encodes 5 MB without per-byte strings", () => {
    const big = new Uint8Array(5 * 1024 * 1024).fill(171);
    const hex = bytesToPgHex(big);
    expect(hex.length).toBe(2 + big.length * 2);
    expect(hex.slice(0, 6)).toBe("\\xabab");
    expect(pgHexToBytes(hex).length).toBe(big.length);
  });

  it("flags an oversize package before it is zipped", () => {
    const file = (n: number) => ({ name: "x", bytes: new Uint8Array(n) });
    expect(contentTooBig([file(60), file(40)], 100)).toBe(false);
    expect(contentTooBig([file(60), file(41)], 100)).toBe(true);
  });
});

describe("patches in the package (Stage 3)", () => {
  it("writes patches.csv with the KB columns and the patch status on the computers", async () => {
    const e = await buildEvidence({ ...data, computers: [{ ...data.computers[0], last_patch_at: "2026-10-01", patch_status: "current" }] }, meta);
    const text = (name: string) => new TextDecoder().decode(e.files.find((f) => f.name === name)!.bytes);
    const patches = text("patches.csv").split("\r\n");
    expect(patches[0]).toBe("hostname,kb,title,installed_at,installed_by");
    expect(patches[1]).toBe("A,KB5034441,Security Update (KB5034441),2026-10-01,SYSTEM");
    expect(e.files.find((f) => f.name === "patches.csv")?.rows).toBe(1);
    const computers = text("computers.csv").split("\r\n");
    expect(computers[0]).toContain("last_patch_at,patch_status");
    expect(computers[1]).toContain("2026-10-01,current");
  });
});
