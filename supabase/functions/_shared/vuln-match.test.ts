import { describe, expect, it } from "vitest";
import { matchVersion, usableVersion } from "./vuln-match.ts";

const below = (end: string, inclusive = false) => ({ version_start: null, start_inclusive: null, version_end: end, end_inclusive: inclusive, exact_version: null });

describe("matchVersion", () => {
  it("uses an exclusive end as the fix version (NVD versionEndExcluding, OSV fixed)", () => {
    const ranges = [below("24.09")];
    expect(matchVersion("23.01", ranges)).toEqual({ uncertain: false, fixed_in: "24.09" });
    expect(matchVersion("24.09", ranges)).toBeNull();
    expect(matchVersion("26.05", ranges)).toBeNull();
  });

  it("compares like the policy: missing parts are 0, numbers compare as numbers", () => {
    expect(matchVersion("24.08.00.0", [below("24.09")])).not.toBeNull();
    expect(matchVersion("24.09.00.0", [below("24.09")])).toBeNull();
    expect(matchVersion("9.14", [below("10.2")])).not.toBeNull();
  });

  it("honours inclusive and exclusive bounds", () => {
    const r = { version_start: "1.2", start_inclusive: true, version_end: "1.5", end_inclusive: true, exact_version: null };
    expect(matchVersion("1.2", [r])).toEqual({ uncertain: false, fixed_in: null });
    expect(matchVersion("1.5", [r])).not.toBeNull();
    expect(matchVersion("1.5.1", [r])).toBeNull();
    expect(matchVersion("1.2", [{ ...r, start_inclusive: false }])).toBeNull();
    expect(matchVersion("1.1", [r])).toBeNull();
  });

  it("matches an exact version, also with trailing zero parts", () => {
    const exact = [{ exact_version: "4.17.20" }];
    expect(matchVersion("4.17.20", exact)).toEqual({ uncertain: false, fixed_in: null });
    expect(matchVersion("4.17.20.0", exact)).not.toBeNull();
    expect(matchVersion("4.17.21", exact)).toBeNull();
  });

  it("marks a version without digits as may be affected, with the lowest fix", () => {
    const ranges = [below("24.09"), below("23.01"), { exact_version: "9.20" }];
    expect(matchVersion("", ranges)).toEqual({ uncertain: true, fixed_in: "23.01" });
    expect(matchVersion(null, ranges)).toEqual({ uncertain: true, fixed_in: "23.01" });
    expect(matchVersion("unknown", ranges)?.uncertain).toBe(true);
    expect(usableVersion("v2")).toBe(true);
  });

  it("marks a range without any bound (every version) as may be affected; a certain range wins", () => {
    const open = { version_start: null, version_end: "*", exact_version: "-" };
    expect(matchVersion("1.0", [open])).toEqual({ uncertain: true, fixed_in: null });
    expect(matchVersion("1.0", [open, below("2.0")])).toEqual({ uncertain: false, fixed_in: "2.0" });
  });

  it("is not affected without ranges", () => {
    expect(matchVersion("1.0", [])).toBeNull();
    expect(matchVersion("", [])).toBeNull();
  });
});
