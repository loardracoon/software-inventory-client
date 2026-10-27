// Normalization of raw osquery rows into snapshot items, one function per domain, plus the hashes.
// apply_snapshot (SQL) diffs the items against the open rows of the same scope (computer, query).
// Text from extensions and packages (names, descriptions) is untrusted data: it is stored as is and
// rendered as plain text. Usernames go in their own field, never in attrs.
// Runtime-neutral (Deno and Node): hashing uses Web Crypto.

export type RawRow = Record<string, unknown>;

export type TitleRef = {
  kind: "program" | "extension" | "ide_extension" | "package";
  source: string;
  match_key: string;
  canonical_name: string;
  vendor: string | null;
  external_id: string | null;
  description: string | null;
};

export type SoftwareItem = {
  title: TitleRef;
  scope_key: string;
  username: string | null;
  version: string | null;
  path: string | null;
  attrs: Record<string, unknown>;
  // Attributes whose change makes a new version (with the version itself).
  tracked: unknown[];
};

export type HardwareItem = {
  item_key: string;
  attrs: Record<string, unknown>;
  tracked: unknown[];
};

export type Normalized =
  | { kind: "software"; items: SoftwareItem[] }
  | { kind: "hardware"; items: HardwareItem[] };

const DESCRIPTION_MAX = 1000;

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

function lower(value: unknown): string {
  return (text(value) ?? "").toLowerCase();
}

// "4.4.41_0" -> [4, 4, 41, 0]; same rule as public.version_key().
export function versionKey(version: string | null): number[] {
  return (version ?? "").match(/\d+/g)?.map(Number) ?? [];
}

export function compareVersions(a: string | null, b: string | null): number {
  const x = versionKey(a);
  const y = versionKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? -1) - (y[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}

export function pathSegments(path: string | null): string[] {
  return (path ?? "").split(/[\\/]+/).filter(Boolean);
}

// Folder after \Users\ or /home/ (or /Users/ on macOS), lowercased.
export function userFromPath(path: string | null): string | null {
  const segments = pathSegments(path);
  const i = segments.findIndex((s) => ["users", "home"].includes(s.toLowerCase()));
  return i >= 0 && segments[i + 1] ? segments[i + 1].toLowerCase() : null;
}

// Browser profile: the folder right before "Extensions" (Chromium) or "extensions" (Firefox).
export function profileFromPath(path: string | null): string | null {
  const segments = pathSegments(path);
  const i = segments.findIndex((s) => s.toLowerCase() === "extensions");
  return i > 0 ? segments[i - 1] : null;
}

export function browserFromPath(path: string | null): string | null {
  const s = pathSegments(path).map((x) => x.toLowerCase());
  const has = (...names: string[]) => names.every((n) => s.includes(n));
  if (has("microsoft", "edge")) return "edge";
  if (has("google", "chrome")) return "chrome";
  if (s.includes("bravesoftware")) return "brave";
  if (s.includes("vivaldi")) return "vivaldi";
  if (has("opera software")) return "opera";
  if (s.includes("chromium")) return "chromium";
  if (s.includes("firefox") || s.includes("mozilla")) return "firefox";
  return null;
}

function programSource(platform: string, queryName: string): string {
  if (queryName.endsWith(".deb")) return "deb";
  if (queryName.endsWith(".rpm")) return "rpm";
  return platform === "macos" ? "apps" : "programs";
}

function keepHighest<T>(groups: Map<string, T[]>, version: (row: T) => string | null, tiebreak: (row: T) => string | null = () => null) {
  return [...groups.values()].map((rows) =>
    [...rows].sort((a, b) => compareVersions(version(b), version(a)) || compareVersions(tiebreak(b), tiebreak(a)))[0],
  );
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return groups;
}

const ARCH_OR_VERSION_IN_PARENS = /\s*\((?:\s*(?:x64|x86|x86_64|amd64|arm64|aarch64|64-bit|32-bit|64 bit|32 bit|v?\d+(?:\.\d+)+),?\s*)+\)/gi;
const DASH_VERSION_SUFFIX = /\s+-\s+v?\d+(?:\.\d+)+\S*$/i;
const TRAILING_VERSION_OR_ARCH = /\s+(?:v?\d+(?:\.\d+)+[\w.+-]*|x64|x86|amd64|arm64)$/i;

// Product name without version or architecture (queries v2): "7-Zip 23.01 (x64)" → "7-Zip",
// "Microsoft Visual C++ 2015-2022 Redistributable (x64) - 14.38.33135" → "Microsoft Visual C++ 2015-2022 Redistributable".
// Version numbers need a dot, so years, "Java 8 Update 401" and "python3.12" stay as they are.
export function productName(name: string): string {
  let current = name.trim();
  for (let previous = ""; previous !== current; ) {
    previous = current;
    current = current.replace(ARCH_OR_VERSION_IN_PARENS, "").replace(DASH_VERSION_SUFFIX, "").replace(TRAILING_VERSION_OR_ARCH, "").trim();
  }
  return current || name.trim();
}

// Query version 1 keys programs by the raw name (kept, so v1 row hashes never change); from v2 the name
// loses its version and architecture, so one product is one title whatever version is installed.
export function normalizePrograms(rows: RawRow[], platform: string, queryName: string, queryVersion = 1): SoftwareItem[] {
  const source = programSource(platform, queryName);
  const nameOf = (r: RawRow) => (queryVersion >= 2 ? productName(text(r.name)!) : text(r.name)!);
  const valid = rows.filter((r) => text(r.name));
  const groups = groupBy(valid, (r) => `${nameOf(r).toLowerCase()}|${lower(r.publisher)}`);
  return [...groups.entries()].map(([matchKey, group]) => {
    const r = keepHighest(new Map([[matchKey, group]]), (x) => text(x.version))[0];
    return {
      title: {
        kind: "program",
        source,
        match_key: matchKey,
        canonical_name: nameOf(r),
        vendor: text(r.publisher),
        external_id: text(r.identifying_number),
        description: null,
      },
      scope_key: "",
      username: null,
      version: text(r.version),
      path: text(r.install_location),
      attrs: {
        install_date: text(r.install_date),
        identifying_number: text(r.identifying_number),
        ...(group.length > 1 ? { duplicates: group.length } : {}),
      },
      tracked: [text(r.version), text(r.publisher), text(r.install_location)],
    };
  });
}

export function normalizeExtensions(rows: RawRow[]): SoftwareItem[] {
  // 1. Dedupe by path, preferring the row that carries a username.
  const byPath = new Map<string, RawRow>();
  for (const r of rows) {
    const path = text(r.path);
    if (!path || !text(r.identifier)) continue;
    const previous = byPath.get(path);
    if (!previous || (!text(previous.username) && text(r.username))) byPath.set(path, r);
  }
  const deduped = [...byPath.values()];

  const browser = (r: RawRow) => lower(r.browser_type) || browserFromPath(text(r.path)) || lower(r.family) || "unknown";
  const user = (r: RawRow) => lower(r.username) || userFromPath(text(r.path)) || "";
  const profile = (r: RawRow) => text(r.profile) ?? profileFromPath(text(r.path)) ?? "";

  // 2. One installation per (browser, user, profile, extension ID); highest version is current.
  const groups = groupBy(deduped, (r) => [browser(r), user(r), profile(r), text(r.identifier)].join("|"));
  return [...groups.values()].map((group) => {
    const sorted = [...group].sort(
      (a, b) => compareVersions(text(b.version), text(a.version)) || compareVersions(pathSegments(text(b.path)).at(-1) ?? null, pathSegments(text(a.path)).at(-1) ?? null),
    );
    const current = sorted[0];
    const stale = sorted.slice(1).map((r) => text(r.path)!).sort();
    const identifier = text(current.identifier)!;
    const description = text(current.description);
    return {
      title: {
        kind: "extension",
        source: browser(current),
        match_key: identifier,
        canonical_name: text(current.name) ?? identifier,
        vendor: null,
        external_id: identifier,
        description: description ? description.slice(0, DESCRIPTION_MAX) : null,
      },
      scope_key: `${user(current)}|${profile(current)}`,
      username: group.map((r) => text(r.username)).find(Boolean) ?? userFromPath(text(current.path)),
      version: text(current.version),
      path: text(current.path),
      attrs: {
        profile: profile(current) || null,
        family: text(current.family),
        update_url: text(current.update_url),
        permissions: text(current.permissions),
        ...(stale.length > 0 ? { stale_folders: stale } : {}),
      },
      tracked: [text(current.version), text(current.permissions), text(current.update_url)],
    };
  });
}

export function normalizeIdeExtensions(rows: RawRow[]): SoftwareItem[] {
  const valid = rows.filter((r) => text(r.name));
  const groups = groupBy(valid, (r) => [lower(r.username) || userFromPath(text(r.path)) || "", lower(r.publisher), lower(r.name)].join("|"));
  return keepHighest(groups, (r) => text(r.version)).map((r) => {
    const id = [text(r.publisher), text(r.name)].filter(Boolean).join(".");
    const user = lower(r.username) || userFromPath(text(r.path)) || "";
    return {
      title: { kind: "ide_extension", source: "vscode", match_key: id.toLowerCase(), canonical_name: text(r.name)!, vendor: text(r.publisher), external_id: id, description: null },
      scope_key: user,
      username: text(r.username) ?? userFromPath(text(r.path)),
      version: text(r.version),
      path: text(r.path),
      attrs: {},
      tracked: [text(r.version)],
    };
  });
}

export function normalizePackages(rows: RawRow[]): SoftwareItem[] {
  const valid = rows.filter((r) => text(r.name) && text(r.manager));
  const groups = groupBy(valid, (r) => [lower(r.manager), lower(r.name), text(r.path) ?? ""].join("|"));
  return keepHighest(groups, (r) => text(r.version)).map((r) => ({
    title: { kind: "package", source: lower(r.manager), match_key: lower(r.name), canonical_name: text(r.name)!, vendor: text(r.vendor), external_id: text(r.name), description: null },
    scope_key: text(r.path) ?? "",
    username: null,
    version: text(r.version),
    path: text(r.path),
    attrs: {},
    tracked: [text(r.version)],
  }));
}

export function normalizeHardware(rows: RawRow[]): HardwareItem[] {
  const row = rows[0];
  if (!row) return [];
  const attrs = Object.fromEntries(Object.keys(row).sort().map((k) => [k, text(row[k])]));
  return [{ item_key: "", attrs, tracked: Object.entries(attrs) }];
}

const DISK_TRACKED = ["type", "file_system", "size", "boot_partition"];

export function normalizeDisks(rows: RawRow[]): HardwareItem[] {
  const byDevice = new Map<string, RawRow>();
  for (const r of rows) {
    const id = text(r.device_id);
    if (id && !byDevice.has(id)) byDevice.set(id, r);
  }
  return [...byDevice.entries()].map(([id, r]) => ({
    item_key: id,
    attrs: Object.fromEntries(Object.keys(r).sort().map((k) => [k, text(r[k])])),
    // free_space changes every scan: kept in attrs, not tracked.
    tracked: DISK_TRACKED.map((k) => text(r[k])),
  }));
}

export function normalize(domain: string, platform: string, queryName: string, rows: RawRow[], queryVersion = 1): Normalized {
  switch (domain) {
    case "programs":
      return { kind: "software", items: normalizePrograms(rows, platform, queryName, queryVersion) };
    case "extensions":
      return { kind: "software", items: normalizeExtensions(rows) };
    case "ide_extensions":
      return { kind: "software", items: normalizeIdeExtensions(rows) };
    case "packages":
      return { kind: "software", items: normalizePackages(rows) };
    case "hardware":
      return { kind: "hardware", items: normalizeHardware(rows) };
    case "disks":
      return { kind: "hardware", items: normalizeDisks(rows) };
    default:
      throw new Error(`No normalizer for domain ${domain}`);
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function itemKey(item: SoftwareItem | HardwareItem): string {
  return "title" in item ? [item.title.kind, item.title.source, item.title.match_key, item.scope_key].join("|") : item.item_key;
}

// row_hash = sha256(JSON([key, tracked])); content_hash = sha256(sorted row hashes).
export async function hashItems(normalized: Normalized): Promise<{ kind: Normalized["kind"]; content_hash: string; items: Record<string, unknown>[] }> {
  const items = await Promise.all(
    normalized.items.map(async (item) => {
      const { tracked, ...rest } = item;
      return { ...rest, row_hash: await sha256(JSON.stringify([itemKey(item), tracked])) };
    }),
  );
  const content_hash = await sha256(items.map((i) => i.row_hash).sort().join("\n"));
  return { kind: normalized.kind, content_hash, items };
}
