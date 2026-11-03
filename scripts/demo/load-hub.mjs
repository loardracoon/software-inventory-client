// Fills the mock Dictionary Hub (scripts/mock-dictionary-hub.mjs) for the demo: a category for every title
// the client shared (fleet.mjs › CATEGORY_RULES), the demo CVEs for the products the client found, and no
// mock test CVEs. Usage: node scripts/demo/load-hub.mjs <hub URL> <product keys JSON file>
// The JSON file is [{ "name": canonical name, "product_key": key }] read from the client database.
import { readFileSync } from "node:fs";
import { categoryFor, CVES } from "./fleet.mjs";

const [hub = "http://localhost:54998", keysFile] = process.argv.slice(2);
const post = async (path, body) => {
  const res = await fetch(`${hub}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
};

const state = await (await fetch(`${hub}/__state`)).json();

// 1. Categories for the shared titles (Jev-like proposals for some, so the "method" column varies).
const seen = new Set(state.entries.map((e) => `${e.kind}|${e.source}|${e.match_key}`));
let published = 0;
for (const s of state.submissions) {
  const key = `${s.kind}|${s.source}|${s.match_key}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const category = categoryFor(s.name);
  const method = published % 3 === 0 ? "jev_auto" : "manual";
  await post("/__publish", { kind: s.kind, source: s.source, match_key: s.match_key, canonical_name: s.name, vendor: s.vendor ?? null, description: s.description ?? null, category_slug: category, method, ...(method === "jev_auto" ? { confidence: 0.93 } : {}) });
  published++;
}

// 2. Remove the mock's test CVEs (CVE-2099-*), then add the demo CVEs for each product key found.
for (const v of state.vulns) if (v.vuln_id.startsWith("CVE-2099-")) await post("/__vuln", { product_key: v.product_key, vuln_id: v.vuln_id, removed: true });
const keys = keysFile ? JSON.parse(readFileSync(keysFile, "utf8")) : [];
let vulns = 0;
for (const cve of CVES) {
  const productKeys = new Set(keys.filter((k) => k.name.toLowerCase().startsWith(cve.product.toLowerCase())).map((k) => k.product_key));
  for (const product_key of productKeys) {
    const { product, ...item } = cve;
    await post("/__vuln", { ...item, product_key, aliases: [], epss: null, epss_percentile: null, published: null, modified: null });
    vulns++;
  }
}
console.log(`hub: ${published} titles classified, ${vulns} CVE links, ${state.submissions.length} submissions read`);
