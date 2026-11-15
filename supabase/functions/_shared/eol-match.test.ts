import { describe, expect, it } from "vitest";
import { macosRelease, matchRelease, supportStatus, windowsRelease, type EolRelease } from "./eol-match.ts";

const rel = (name: string, over: Partial<EolRelease> = {}): EolRelease => ({ name, label: name, is_eol: false, eol_from: null, latest_name: null, ...over });
const TODAY = new Date("2026-11-13T12:00:00Z");

describe("matchRelease", () => {
  const releases = [rel("1"), rel("1.1"), rel("159"), rel("22")];
  it("matches the version to the release it starts with, on a dot boundary", () => {
    expect(matchRelease("159.0.1", releases)?.name).toBe("159");
    expect(matchRelease("22", releases)?.name).toBe("22");
    expect(matchRelease("22.1.0", releases)?.name).toBe("22");
  });
  it("release matching: 1.10.2 does not match release 1.1, and the longest name wins", () => {
    expect(matchRelease("1.10.2", releases)?.name).toBe("1");
    expect(matchRelease("1.1.5", releases)?.name).toBe("1.1");
  });
  it("returns null for no version or no match", () => {
    expect(matchRelease(null, releases)).toBeNull();
    expect(matchRelease("", releases)).toBeNull();
    expect(matchRelease("7.0", releases)).toBeNull();
  });
});

describe("windowsRelease", () => {
  const releases = [
    rel("11-24h2-w", { latest_name: "10.0.26100" }),
    rel("11-24h2-e", { latest_name: "10.0.26100" }),
    rel("10-22h2", { latest_name: "10.0.19045" }),
  ];
  it("picks the edition by the OS name: Enterprise/Education/IoT = e, the rest = w", () => {
    expect(windowsRelease("Windows 11 Pro", "26100", releases)?.name).toBe("11-24h2-w");
    expect(windowsRelease("Windows 11 Enterprise", "26100.1234", releases)?.name).toBe("11-24h2-e");
    expect(windowsRelease("Windows 11 Education", "26100", releases)?.name).toBe("11-24h2-e");
  });
  it("falls back to any release with the same build when the edition has none", () => {
    expect(windowsRelease("Windows 10 Pro", "19045", releases)?.name).toBe("10-22h2");
  });
  it("unknown build: an insider build is unknown, never eol", () => {
    expect(windowsRelease("Windows 11 Pro", "99999", releases)).toBeNull();
    expect(windowsRelease("Windows 11 Pro", null, releases)).toBeNull();
    expect(windowsRelease(null, "26100", releases)?.name).toBe("11-24h2-w");
  });
});

describe("macosRelease", () => {
  const releases = [rel("26"), rel("15"), rel("14")];
  it("matches the major version of the OS version", () => {
    expect(macosRelease("15.1.1", releases)?.name).toBe("15");
    expect(macosRelease("14", releases)?.name).toBe("14");
  });
  it("is null when the major is not listed or the version is missing", () => {
    expect(macosRelease("10.15.7", releases)).toBeNull();
    expect(macosRelease(null, releases)).toBeNull();
  });
});

describe("supportStatus", () => {
  it("unknown without a release", () => expect(supportStatus(null, TODAY)).toBe("unknown"));
  it("eol when flagged or the date has come, including today", () => {
    expect(supportStatus(rel("a", { is_eol: true }), TODAY)).toBe("eol");
    expect(supportStatus(rel("a", { eol_from: "2026-11-13" }), TODAY)).toBe("eol");
    expect(supportStatus(rel("a", { eol_from: "2026-11-12" }), TODAY)).toBe("eol");
  });
  it("ending_soon within 90 days, supported beyond, supported with no end date", () => {
    expect(supportStatus(rel("a", { eol_from: "2026-11-14" }), TODAY)).toBe("ending_soon");
    expect(supportStatus(rel("a", { eol_from: "2027-02-11" }), TODAY)).toBe("ending_soon"); // exactly 90 days
    expect(supportStatus(rel("a", { eol_from: "2027-02-12" }), TODAY)).toBe("supported");
    expect(supportStatus(rel("a"), TODAY)).toBe("supported");
  });
});
