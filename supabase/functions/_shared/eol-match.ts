// End-of-life matching (Stage 3): installed versions and OS builds against the release cycles the Hub publishes
// (endoflife.date). Everything runs here: the Hub never sees a version. Runtime-neutral (Deno and Node).

export type EolRelease = { name: string; label: string | null; is_eol: boolean; eol_from: string | null; latest_name: string | null };
export type SupportStatus = "supported" | "ending_soon" | "eol" | "unknown";

const ENDING_SOON_DAYS = 90;
const DAY_MS = 86_400_000;

// A version belongs to a release when it equals its name or continues it after a dot ("159.0.1" → "159"; "1.10.2" is
// not "1.1"). The longest matching name wins ("1.1.5" → "1.1", not "1").
export function matchRelease(version: string | null, releases: EolRelease[]): EolRelease | null {
  const v = version?.trim();
  if (!v) return null;
  let best: EolRelease | null = null;
  for (const r of releases) {
    if ((v === r.name || v.startsWith(`${r.name}.`)) && (!best || r.name.length > best.name.length)) best = r;
  }
  return best;
}

const thirdPart = (latest: string | null) => latest?.split(".")[2] ?? null;

// Windows: the build number is the third part of the release's latest version (10.0.26100); the edition is the
// suffix of the release name (-w Home/Pro, -e Enterprise/Education/IoT). A build in no release (an insider build) is unknown.
export function windowsRelease(osName: string | null, osBuild: string | null, releases: EolRelease[]): EolRelease | null {
  const build = osBuild?.split(".")[0]?.trim();
  if (!build) return null;
  const same = releases.filter((r) => thirdPart(r.latest_name) === build);
  if (same.length === 0) return null;
  const edition = /enterprise|education|iot/i.test(osName ?? "") ? "e" : "w";
  return same.find((r) => r.name.endsWith(`-${edition}`)) ?? same[0];
}

export function macosRelease(osVersion: string | null, releases: EolRelease[]): EolRelease | null {
  const major = osVersion?.trim().split(".")[0];
  return major ? (releases.find((r) => r.name === major) ?? null) : null;
}

export function supportStatus(release: EolRelease | null, today: Date): SupportStatus {
  if (!release) return "unknown";
  if (release.is_eol) return "eol";
  if (!release.eol_from) return "supported";
  const end = Date.parse(`${release.eol_from}T00:00:00Z`);
  if (Number.isNaN(end)) return "supported";
  const days = Math.floor((end - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / DAY_MS);
  if (days <= 0) return "eol";
  return days <= ENDING_SOON_DAYS ? "ending_soon" : "supported";
}
