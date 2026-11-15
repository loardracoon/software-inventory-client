// Evidence package for auditors: CSV + JSON files, a manifest with SHA-256 per file, and a reproducible ZIP.
// Runtime-neutral (Deno Edge Function and Vitest).

export type ReportData = {
  computers: Record<string, unknown>[];
  software: Record<string, unknown>[];
  vulnerabilities: Record<string, unknown>[];
  exceptions: Record<string, unknown>[];
  patches: Record<string, unknown>[];
  coverage: unknown;
  policy: unknown;
  remediation: unknown;
  scope_statement: string | null;
  users_masked: boolean;
};

export type EvidenceMeta = {
  reportId: string;
  tenant: { id: string; name: string };
  asOf: string;
  generatedAt: string;
  generatedBy: string;
  scopeTag: string | null;
  appVersion: string;
};

export type EvidenceFile = { name: string; bytes: Uint8Array; rows?: number };
export type Manifest = {
  report_id: string;
  tenant: { id: string; name: string };
  as_of: string;
  generated_at: string;
  generated_by: string;
  scope_tag: string | null;
  app_version: string;
  users_masked: boolean;
  notes: string;
  files: { name: string; bytes: number; rows?: number; sha256: string }[];
};

const enc = new TextEncoder();

function cell(value: unknown): string {
  let text = value === null || value === undefined ? "" : Array.isArray(value) ? value.join("; ") : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// UTF-8 BOM, CRLF, RFC 4180 quoting; a cell starting with = + - @ tab or CR gets a leading ' (spreadsheet formulas).
export function toCsv(header: string[], rows: unknown[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

const COLUMNS = {
  "computers.csv": ["hostname", "sophos_endpoint_id", "platform", "os_name", "os_version", "os_build", "associated_user", "owner", "department", "criticality", "scope_tags", "last_seen_at", "inventoried_at", "inventory_source", "coverage_status", "os_eol_status", "os_eol_from", "last_patch_at", "patch_status"],
  "software.csv": ["hostname", "kind", "source", "canonical_name", "vendor", "version", "category", "attention_level", "policy_class", "support_status", "eol_from", "first_seen"],
  "vulnerabilities.csv": ["canonical_name", "version", "vuln_id", "severity", "cvss_score", "kev", "kev_due", "epss", "fixed_in", "first_seen_at", "computers", "due_at", "status"],
  "exceptions.csv": ["name", "reason", "review_by", "owner"],
  "patches.csv": ["hostname", "kb", "title", "installed_at", "installed_by"],
} as const;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// files = the content files and manifest.json last; manifest.files lists the content files (a file cannot hash itself).
export async function buildEvidence(
  data: ReportData,
  meta: EvidenceMeta,
): Promise<{ files: EvidenceFile[]; manifest: Manifest; manifestBytes: Uint8Array; manifestSha256: string }> {
  const csv = (name: keyof typeof COLUMNS, rows: Record<string, unknown>[]): EvidenceFile => ({
    name,
    bytes: enc.encode(toCsv([...COLUMNS[name]], rows.map((r) => COLUMNS[name].map((c) => r[c])))),
    rows: rows.length,
  });
  const text = (name: string, content: string): EvidenceFile => ({ name, bytes: enc.encode(content) });
  const pretty = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

  const content: EvidenceFile[] = [
    csv("computers.csv", data.computers),
    csv("software.csv", data.software),
    csv("vulnerabilities.csv", data.vulnerabilities),
    csv("exceptions.csv", data.exceptions),
    csv("patches.csv", data.patches ?? []), // an older database function may not send it yet
    text("coverage.json", pretty(data.coverage)),
    text("policy.json", pretty(data.policy)),
    text("remediation.json", pretty(data.remediation)),
    text("scope.txt", [data.scope_statement ?? "", "", `Tenant: ${meta.tenant.name}`, `Inventory as of: ${meta.asOf}`, `Scope tag: ${meta.scopeTag ?? "none (all computers)"}`, ""].join("\r\n")),
    text("data.json", pretty(data)),
  ];
  const manifest: Manifest = {
    report_id: meta.reportId,
    tenant: meta.tenant,
    as_of: meta.asOf,
    generated_at: meta.generatedAt,
    generated_by: meta.generatedBy,
    scope_tag: meta.scopeTag,
    app_version: meta.appVersion,
    users_masked: data.users_masked,
    notes: "Installations are as of as_of; policy classes, vulnerabilities and context are as of generated_at.",
    files: await Promise.all(
      content.map(async (f) => ({ name: f.name, bytes: f.bytes.length, ...(f.rows === undefined ? {} : { rows: f.rows }), sha256: await sha256Hex(f.bytes) })),
    ),
  };
  const manifestBytes = enc.encode(pretty(manifest));
  return { files: [...content, { name: "manifest.json", bytes: manifestBytes }], manifest, manifestBytes, manifestSha256: await sha256Hex(manifestBytes) };
}

// Largest uncompressed package we build in memory (the worker has 256 MB); a ZIP over 25 MB is refused separately.
export const MAX_CONTENT_BYTES = 60 * 1024 * 1024;

export function contentTooBig(files: EvidenceFile[], limit = MAX_CONTENT_BYTES): boolean {
  return files.reduce((sum, f) => sum + f.bytes.length, 0) > limit;
}

const HEX = new Uint8Array(16).map((_, i) => "0123456789abcdef".charCodeAt(i));

// bytea as PostgREST text ("\\x" + hex), built without per-byte strings (one allocation, one decode).
export function bytesToPgHex(bytes: Uint8Array): string {
  const out = new Uint8Array(2 + bytes.length * 2);
  out[0] = 0x5c;
  out[1] = 0x78;
  for (let i = 0, o = 2; i < bytes.length; i++) {
    out[o++] = HEX[bytes[i] >> 4];
    out[o++] = HEX[bytes[i] & 15];
  }
  return new TextDecoder().decode(out);
}

const nibble = (code: number) => (code <= 57 ? code - 48 : (code | 32) - 87);

export function pgHexToBytes(value: string): Uint8Array {
  const start = value.startsWith("\\x") ? 2 : 0;
  const out = new Uint8Array((value.length - start) >> 1);
  for (let i = 0, c = start; i < out.length; i++, c += 2) out[i] = (nibble(value.charCodeAt(c)) << 4) | nibble(value.charCodeAt(c + 1));
  return out;
}
