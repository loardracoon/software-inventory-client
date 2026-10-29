// Local mock of the Dictionary Hub client API (docs/phases/hub-H2-client-api.md) for end-to-end tests
// of the Edge Functions (never used in production). Run: npm run mock:hub, then in Settings › Dictionary
// hub save the URL http://host.docker.internal:54998 and the key mock-hub-client-key-0123456789.
// Test routes (POST): /__publish {entry} adds or changes an entry; /__deprecate {kind, source, match_key};
// /__decide {id, status, admin_note}; /__down {on: true|false} answers 503 to everything;
// /__vuln {item} adds or changes a vulnerability feed item (phase H7: product_key, vuln_id, ranges...).
// GET /__state shows the entries, submissions, requests and vulnerabilities.
import http from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const PORT = Number(process.argv[2] ?? 54998);
const KEY = "mock-hub-client-key-0123456789";
const SUBMIT_FIELDS = ["kind", "source", "match_key", "name", "vendor", "description", "platforms"];

// Deterministic UUIDs, so categories keep their ids between restarts.
const uuid = (text) => {
  const h = createHash("sha256").update(text).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

let seq = 0;
const taxonomy = JSON.parse(readFileSync(new URL("../docs/taxonomy.json", import.meta.url), "utf8"));
const categories = [];
for (const row of taxonomy) {
  const parentSlug = row.slug.split("/")[0];
  if (!categories.some((c) => c.slug === parentSlug)) {
    categories.push({ id: uuid(parentSlug), slug: parentSlug, parent_id: null, name: row.level1, attention_level: null, revision: 1, seq: ++seq, deprecated: false });
  }
  categories.push({
    id: uuid(row.slug),
    slug: row.slug,
    parent_id: uuid(parentSlug),
    name: row.level2,
    description: row.description,
    attention_level: row.attention_default,
    sophos_firewall_category: row.sophos_firewall_category || null,
    revision: 1,
    seq: ++seq,
    deprecated: false,
  });
}
const categoryBySlug = (slug) => categories.find((c) => c.slug === slug);

const entries = [];
const publish = (entry) => {
  const i = entries.findIndex((e) => e.kind === entry.kind && e.source === entry.source && e.match_key === entry.match_key);
  const previous = i >= 0 ? entries[i] : null;
  const category = categoryBySlug(entry.category_slug ?? "") ?? (previous && categories.find((c) => c.id === previous.category_id));
  const next = {
    ...previous,
    ...entry,
    category_id: category?.id,
    status: entry.status ?? "published",
    method: entry.method ?? previous?.method ?? "manual",
    revision: (previous?.revision ?? 0) + 1,
    seq: ++seq,
  };
  delete next.category_slug;
  if (i >= 0) entries[i] = next;
  else entries.push(next);
  return next;
};

// Titles the Sophos mock and the LAB-PC01 fixture report.
publish({ kind: "program", source: "programs", match_key: "anydesk|anydesk software gmbh", canonical_name: "AnyDesk", vendor: "AnyDesk Software GmbH", category_slug: "remote-access/remote-desktop-and-support", method: "manual" });
publish({ kind: "program", source: "programs", match_key: "git|the git development community", canonical_name: "Git", vendor: "The Git Development Community", category_slug: "developer-tools/clis-and-version-control", method: "rule" });
publish({ kind: "extension", source: "chrome", match_key: "inomeogfingihgjfjlpeplalcfajhgai", canonical_name: "Chrome Remote Desktop", vendor: "Google", category_slug: "remote-access/remote-desktop-and-support", method: "jev", confidence: 0.91 });
publish({ kind: "extension", source: "edge", match_key: "bfogiafebfohielmmehodmfbbebbbpei", canonical_name: "Keeper Password Manager", vendor: "Keeper Security", category_slug: "security-and-identity/password-managers", method: "jev_auto", confidence: 0.97 });
publish({ kind: "ide_extension", source: "vscode", match_key: "ms-python.python", canonical_name: "Python", vendor: "Microsoft", category_slug: "developer-tools/ide-extensions", method: "rule" });

// Vulnerability feed (phase H7). Mock IDs, not real CVEs. AnyDesk 8.0.9 (Sophos mock) is affected by the
// first (known exploited) and not by the second (fixed before 8.0); Adobe Acrobat 23.008 of
// e2e/fixtures/policy-seed.sql is affected by the third and 25.001 is not.
const vulns = [];
const vulnSet = (item) => {
  const i = vulns.findIndex((v) => v.product_key === item.product_key && v.vuln_id === item.vuln_id);
  const next = { removed: false, aliases: [], cwe: [], references: [], ranges: [], ...(i >= 0 ? vulns[i] : {}), ...item, seq: ++seq };
  if (i >= 0) vulns[i] = next;
  else vulns.push(next);
  return next;
};
vulnSet({ product_key: "program|anydesk software|anydesk", vuln_id: "CVE-2099-0001", summary: "Mock vulnerability (known exploited) for end-to-end tests.", severity: "CRITICAL", cvss_version: "3.1", cvss_score: 9.8, kev_added: "2026-01-15", kev_due: "2026-02-05", epss: 0.42, epss_percentile: 0.97, ranges: [{ version_start: "8.0", start_inclusive: true, version_end: "8.1.0", end_inclusive: false, exact_version: null, source: "nvd" }] });
vulnSet({ product_key: "program|anydesk software|anydesk", vuln_id: "CVE-2099-0002", summary: "Mock vulnerability fixed before 8.0.", severity: "MEDIUM", cvss_version: "3.1", cvss_score: 5.4, epss: 0.01, ranges: [{ version_start: null, start_inclusive: null, version_end: "7.1.0", end_inclusive: false, exact_version: null, source: "nvd" }] });
vulnSet({ product_key: "program|adobe|adobe acrobat", vuln_id: "CVE-2099-0003", summary: "Mock vulnerability (known exploited) in old Adobe Acrobat versions.", severity: "HIGH", cvss_version: "3.1", cvss_score: 7.8, kev_added: "2026-03-10", kev_due: "2026-03-31", epss: 0.12, epss_percentile: 0.95, ranges: [{ version_start: null, start_inclusive: null, version_end: "24.0", end_inclusive: false, exact_version: null, source: "nvd" }] });

const submissions = [];
const requests = [];
let down = false;
const counts = {};

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve(null);
      }
    });
  });

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const route = `${req.method} ${url.pathname.replace(/^\/functions\/v1/, "")}`;
    counts[route] = (counts[route] ?? 0) + 1;
    const body = req.method === "POST" ? await readBody(req) : null;

    // Test routes ---------------------------------------------------------------------------------
    if (route === "GET /__state") return send(res, 200, { seq, down, counts, entries, submissions, requests, vulns });
    if (route === "POST /__vuln") return send(res, 200, vulnSet(body));
    if (route === "POST /__publish") return send(res, 200, publish(body));
    if (route === "POST /__deprecate") return send(res, 200, publish({ ...body, status: "deprecated" }));
    if (route === "POST /__down") {
      down = body?.on !== false;
      return send(res, 200, { down });
    }
    if (route === "POST /__decide") {
      const r = requests.find((x) => x.id === body?.id);
      if (!r) return send(res, 404, { error: "No such request" });
      Object.assign(r, { status: body.status, admin_note: body.admin_note ?? null });
      return send(res, 200, r);
    }

    // Client API ----------------------------------------------------------------------------------
    if (down) return send(res, 503, { error: "Hub is down (mock)" });
    if (req.headers.authorization !== `Bearer ${KEY}`) return send(res, 401, { error: "Invalid client key" });

    if (route === "GET /dictionary-changes") {
      const since = Number(url.searchParams.get("since") ?? 0);
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 1000), 1000);
      const changed = [...categories.map((c) => ({ type: "category", row: c })), ...entries.map((e) => ({ type: "entry", row: e }))]
        .filter((x) => x.row.seq > since)
        .sort((a, b) => a.row.seq - b.row.seq);
      const page = changed.slice(0, limit);
      return send(res, 200, {
        categories: page.filter((x) => x.type === "category").map((x) => x.row),
        entries: page.filter((x) => x.type === "entry").map((x) => x.row),
        next_seq: page.length ? page[page.length - 1].row.seq : since,
        has_more: changed.length > limit,
      });
    }

    if (route === "GET /vulnerability-changes") {
      const since = Number(url.searchParams.get("since") ?? 0);
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 500), 1000);
      const changed = vulns.filter((v) => v.seq > since).sort((a, b) => a.seq - b.seq);
      const page = changed.slice(0, limit);
      return send(res, 200, { items: page, next_seq: page.length ? page[page.length - 1].seq : since, has_more: changed.length > limit });
    }

    if (route === "POST /titles-submit") {
      const titles = body?.titles;
      if (!Array.isArray(titles) || titles.length > 500) return send(res, 400, { error: "titles must be an array of at most 500" });
      for (const t of titles) {
        const extra = Object.keys(t).filter((k) => !SUBMIT_FIELDS.includes(k));
        if (extra.length) return send(res, 400, { error: `Fields not allowed: ${extra.join(", ")}` });
        if ((t.description ?? "").length > 1000) return send(res, 400, { error: "description longer than 1,000 characters" });
      }
      submissions.push(...titles);
      return send(res, 200, { accepted: titles.length });
    }

    if (route === "POST /reclassification-requests") {
      if (!body?.reason || body.reason.length > 500) return send(res, 400, { error: "reason is required (max 500)" });
      const open = requests.find((r) => r.status === "open" && r.kind === body.kind && r.source === body.source && r.match_key === body.match_key);
      if (open) return send(res, 200, { id: open.id, status: open.status });
      const r = { id: `REQ-${String(requests.length + 1).padStart(4, "0")}`, status: "open", admin_note: null, ...body };
      requests.push(r);
      return send(res, 201, { id: r.id, status: r.status });
    }

    if (route === "GET /reclassification-requests") {
      const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
      return send(res, 200, requests.filter((r) => ids.includes(r.id)).map(({ id, status, admin_note }) => ({ id, status, admin_note })));
    }

    return send(res, 404, { error: `No route ${route}` });
  })
  .listen(PORT, () => console.log(`Mock Dictionary Hub on http://localhost:${PORT} (key ${KEY})`));
