// Matches one installed version against the affected version ranges of a CVE (Phase 10b). The Hub
// sends the ranges per product; only this app knows its installed versions. Runtime-neutral and pure,
// with the version order of the policy (compareVersions), so "affected" and "version < x" agree.
//
// A range is { version_start, start_inclusive, version_end, end_inclusive, exact_version }: an exact
// version, or bounds (a missing bound is open). "Uncertain" (may be affected) when the installed
// version has no digit, or when the CVE names no version at all (every version of the product).

import { compareVersions } from "./policy.ts";

export type VulnRange = {
  version_start?: string | null;
  start_inclusive?: boolean | null;
  version_end?: string | null;
  end_inclusive?: boolean | null;
  exact_version?: string | null;
  // Operating systems the range applies to (windows, macos, linux); absent, null or empty = every one.
  platforms?: string[] | null;
};

// The ranges that apply on one OS.
export const rangesFor = (ranges: VulnRange[], platform: string): VulnRange[] => ranges.filter((r) => !r.platforms?.length || r.platforms.includes(platform));

export type VersionMatch = { uncertain: boolean; fixed_in: string | null };

// NVD writes "*" (any) and "-" (not applicable) in the version slot of a CPE.
const bound = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" || t === "*" || t === "-" ? null : t;
};

export const usableVersion = (version: string | null | undefined): boolean => /\d/.test(version ?? "");

// Affected: the version is in one of the ranges. The fix is the exclusive end of the matching range.
function inRange(version: string, r: VulnRange): VersionMatch | null {
  const exact = bound(r.exact_version);
  if (exact) return compareVersions(version, exact) === 0 ? { uncertain: false, fixed_in: null } : null;
  const start = bound(r.version_start);
  const end = bound(r.version_end);
  if (!start && !end) return { uncertain: true, fixed_in: null };
  if (start) {
    const c = compareVersions(version, start);
    if (r.start_inclusive === false ? c <= 0 : c < 0) return null;
  }
  if (end) {
    const c = compareVersions(version, end);
    if (r.end_inclusive ? c > 0 : c >= 0) return null;
  }
  return { uncertain: false, fixed_in: end && !r.end_inclusive ? end : null };
}

// null = not affected. A certain match wins over an uncertain one.
export function matchVersion(version: string | null | undefined, ranges: VulnRange[]): VersionMatch | null {
  if (!ranges.length) return null;
  if (!usableVersion(version)) {
    // No version to compare: may be affected; the lowest fix the CVE names helps the reader.
    const fixes = ranges.filter((r) => !bound(r.exact_version) && !r.end_inclusive).map((r) => bound(r.version_end)).filter((v): v is string => !!v);
    return { uncertain: true, fixed_in: fixes.sort(compareVersions)[0] ?? null };
  }
  let found: VersionMatch | null = null;
  for (const r of ranges) {
    const m = inRange(version!, r);
    if (!m) continue;
    if (!m.uncertain) return m;
    found ??= m;
  }
  return found;
}
