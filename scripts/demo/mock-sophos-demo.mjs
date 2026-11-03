// Mock Sophos Central with the demo fleet (fleet.mjs), for walkthrough videos on the isolated stack (never
// used in production). Same API surface as scripts/mock-sophos-central.mjs, without its test quirks: every
// online computer answers every query; AUR-LT-011 is offline. POST /__upgrade switches to week 2.
// Run: node scripts/demo/mock-sophos-demo.mjs 54999 (setup-demo.sh starts it).
import http from "node:http";
import { ALL_ENDPOINTS, ENDPOINTS, OFFLINE, TENANTS, rowsFor } from "./fleet.mjs";

const PORT = Number(process.argv[2] ?? 54999);
const BASE = `http://host.docker.internal:${PORT}`;
const CLIENT_ID = "11111111-2222-3333-4444-555566667777";
const SECRET = "mock-secret-value-0123456789abcdef";
const TOKEN = "mock-jwt-token";
const TABLES = [
  "system_info", "os_version", "platform_info", "logical_drives", "mounts", "programs", "apps", "deb_packages", "users",
  "chrome_extensions", "firefox_addons", "vscode_extensions", "chocolatey_packages", "npm_packages", "python_packages",
  "homebrew_packages", "osquery_registry",
];

let week2 = false;
const sessions = new Map();
const runs = new Map();
const byId = new Map(ALL_ENDPOINTS.map((e) => [e.id, e]));
const isOnline = (id) => !OFFLINE.has(byId.get(id)?.hostname);

// The Endpoint API item, without the fields only the mock uses.
const publicEndpoint = (e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith("_")));

function rows(run, id) {
  if (run.template.includes("osquery_registry")) return TABLES.map((name) => ({ name }));
  return rowsFor(byId.get(id), run.name.replace(/\.v\d+$/, ""), week2);
}
const finished = (run) => run.reads >= 2;

function graphql({ query = "", variables = {} }, tenantId) {
  const error = (message) => ({ errors: [{ message }] });
  if (query.includes("createLiveDiscoverSession")) {
    const name = `session-${sessions.size + 1}`;
    sessions.set(name, []);
    return { data: { createLiveDiscoverSession: { session: { name } } } };
  }
  if (query.includes("endpointSessions")) {
    const { sessions: names = [], filter } = variables.input ?? {};
    for (const name of names) sessions.get(name)?.push(...(filter?.ids ?? []));
    return { data: { endpointSessions: { requestedAt: new Date().toISOString(), completedAt: new Date().toISOString() } } };
  }
  if (query.includes("liveDiscoverEndpointSearch")) {
    const items = (variables.input?.ids ?? []).map((id) => ({ id, online: isOnline(id) }));
    return { data: { liveDiscoverEndpointSearch: { items, pages: { nextKey: null } } } };
  }
  if (query.includes("runLiveDiscoverQuery")) {
    const input = variables.input ?? {};
    const id = `run-${runs.size + 1}`;
    runs.set(id, { tenantId, ids: (sessions.get(input.sessionId) ?? []).filter(isOnline), name: input.adHocQuery?.name ?? "", template: input.adHocQuery?.template ?? "", reads: 0 });
    return { data: { runLiveDiscoverQuery: { executionSummary: { id, status: "started" } } } };
  }
  const run = runs.get(variables.runId);
  if (!run || run.tenantId !== tenantId) return error(`unknown run ${variables.runId}`);
  if (query.includes("cancelLiveDiscoverQueryRun")) return { data: { cancelLiveDiscoverQueryRun: { id: variables.runId } } };
  if (query.includes("liveDiscoverQueryRunEndpoints")) {
    run.reads++;
    const items = run.ids.map((id) => ({
      id,
      hostname: byId.get(id)?.hostname ?? id,
      status: finished(run) ? "finished" : "started",
      result: finished(run) ? "succeeded" : "notAvailable",
      statusMessage: null,
      resultCount: finished(run) ? rows(run, id).length : null,
    }));
    return { data: { liveDiscoverQueryRunEndpoints: { items, pages: { current: 1, size: items.length, total: 1 } } } };
  }
  if (query.includes("liveDiscoverQueryRunResults")) {
    const all = run.ids.flatMap((id) => rows(run, id).map((columns) => ({ endpointId: id, hostname: byId.get(id)?.hostname ?? id, additionalColumns: JSON.stringify(columns) })));
    const from = Number(variables.params?.pageFromKey ?? 0);
    const items = all.slice(from, from + 1000);
    return { data: { liveDiscoverQueryRunResults: { items, pages: { fromKey: String(from), nextKey: from + 1000 < all.length ? String(from + 1000) : null, size: items.length, maxSize: 1000 } } } };
  }
  if (query.includes("liveDiscoverQueryRun")) {
    run.reads++;
    const done = finished(run);
    return { data: { liveDiscoverQueryRun: { executionSummary: { id: variables.runId, status: done ? "finished" : "started", result: done ? "succeeded" : "notAvailable", resultCount: 0 } } } };
  }
  return error("operation not supported by the demo mock");
}

const send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, BASE);
    const key = `${req.method} ${url.pathname}`;
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (key === "POST /__upgrade") return send(res, 200, { week2: (week2 = true) });
      if (key === "GET /__state") return send(res, 200, { week2, runs: runs.size });
      if (key === "POST /api/v2/oauth2/token") {
        const form = new URLSearchParams(body);
        if (form.get("client_id") !== CLIENT_ID || form.get("client_secret") !== SECRET) return send(res, 401, { errorCode: "oauth.invalid_client" });
        return send(res, 200, { access_token: TOKEN, expires_in: 3600, errorCode: "success", token_type: "bearer" });
      }
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: "unauthorized" });
      if (key === "POST /graphql") return send(res, 200, graphql(JSON.parse(body || "{}"), req.headers["x-tenant-id"]));
      if (key === "GET /whoami/v1") return send(res, 200, { id: "partner-demo", idType: "partner", apiHosts: { global: BASE } });
      if (key === "GET /partner/v1/tenants") {
        return send(res, 200, { pages: { current: 1, total: 1, maxSize: 100 }, items: TENANTS.map((t) => ({ id: t.id, name: t.name, apiHost: `${BASE}/${t.region}` })) });
      }
      if (req.method === "GET" && /^\/(us01|eu01)\/endpoint\/v1\/endpoints$/.test(url.pathname)) {
        const list = ENDPOINTS[req.headers["x-tenant-id"]];
        if (!list) return send(res, 403, { error: "unknown tenant" });
        return send(res, 200, { items: list.map(publicEndpoint), pages: { size: list.length, maxSize: 500 } });
      }
      send(res, 404, { error: `demo mock has no route for ${key}` });
    });
  })
  .listen(PORT, "0.0.0.0", () => console.log(`demo mock Sophos Central on ${PORT} (${ALL_ENDPOINTS.length} endpoints)`));
