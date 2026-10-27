// Local mock of Sophos Central for end-to-end tests of the Edge Functions (never used in production).
// Run: npm run mock:sophos, then serve the functions with an env file that sets SOPHOS_LES_URL=http://host.docker.internal:54999/graphql,
//   SOPHOS_ID_URL=http://host.docker.internal:54999 and SOPHOS_GLOBAL_URL=http://host.docker.internal:54999
// and save the credential client ID 11111111-2222-3333-4444-555566667777 / secret mock-secret-value-0123456789abcdef.
// GET /__state shows request counts; POST /__drop removes endpoint e-a2 (to test retirement);
// POST /__upgrade switches the inventory rows to the next-week state (to test change events).
// POST /__offline {"ids": [...]} marks endpoints offline in liveDiscoverEndpointSearch (all online by default).
import http from "node:http";

const PORT = Number(process.argv[2] ?? 54999);
const BASE = `http://host.docker.internal:${PORT}`;
const CLIENT_ID = "11111111-2222-3333-4444-555566667777";
const SECRET = "mock-secret-value-0123456789abcdef";
const TOKEN = "mock-jwt-token";

const endpoints = {
  "tenant-a": [
    { id: "e-a1", type: "computer", hostname: "LAB-WIN-01", health: { overall: "good" }, os: { platform: "windows", name: "Windows 11 Enterprise", majorVersion: 10, minorVersion: 0, build: 22631 }, associatedPerson: { name: "Alice", viaLogin: "LAB\\alice" }, lastSeenAt: "2026-10-26T12:00:00Z" },
    { id: "e-a2", type: "computer", hostname: "LAB-MAC-01", health: { overall: "suspicious" }, os: { platform: "macOS", name: "macOS Sequoia", majorVersion: 15, minorVersion: 1 }, associatedPerson: { name: "Bob" }, lastSeenAt: "2026-10-25T09:00:00Z" },
    { id: "e-a3", type: "server", hostname: "LAB-LNX-01", health: { overall: "good" }, os: { platform: "linux", name: "Ubuntu 24.04" }, lastSeenAt: "2026-10-26T08:00:00Z" },
    { id: "e-a4", type: "computer", hostname: "PHONE", os: { platform: "android" } },
  ],
  "tenant-b": [
    { id: "e-b1", type: "computer", hostname: "ACME-PC-01", health: { overall: "good" }, os: { platform: "windows", name: "Windows 10 Pro", majorVersion: 10, minorVersion: 0, build: 19045 }, associatedPerson: { viaLogin: "ACME\\carol" }, lastSeenAt: "2026-10-26T11:00:00Z" },
  ],
};

const counts = {};
let throttled = false;

// Live Endpoint Search (SOPHOS_LES_URL=http://host.docker.internal:54999/graphql), shaped like the
// lab behaviour of Oct 26, 2026:
// - e-a1 (Windows) and e-b1 (Windows) answer; e-a3 (Linux) answers but fails inv.disks;
// - e-a2 (macOS) answers the probe but never an inventory query: its run stays "started" with no
//   time left, as in the lab;
// - cancelLiveDiscoverQueryRun fails with BAD_GATEWAY, as it did in the lab for expired runs.
// Probe tables: e-a1 lacks vscode_extensions and chocolatey_packages; e-a3 lacks vscode_extensions;
// e-b1 has every table. An endpoint answers on the second status read of its run.
const ALL_TABLES = [
  "system_info", "os_version", "platform_info", "logical_drives", "mounts", "programs", "apps", "deb_packages",
  "rpm_packages", "users", "chrome_extensions", "firefox_addons", "vscode_extensions", "chocolatey_packages",
  "npm_packages", "python_packages", "homebrew_packages", "osquery_registry",
];
const PROBE_TABLES = {
  "e-a1": ALL_TABLES.filter((t) => !["vscode_extensions", "chocolatey_packages"].includes(t)),
  "e-a2": ALL_TABLES,
  "e-a3": ALL_TABLES.filter((t) => t !== "vscode_extensions"),
  "e-b1": ALL_TABLES,
};
const SILENT = new Set(["e-a2"]);
const FAILS = { "e-a3": { "inv.disks": "osquery: mounts query failed: permission denied" } };
const sessions = new Map();
const runs = new Map();

function gqlError(message, code) {
  return { errors: [{ message, ...(code ? { extensions: { code } } : {}) }] };
}

// Rows an endpoint returns for a run: the probe lists tables; inventory queries return 2 rows.
// Inventory rows shaped like the v1 queries. POST /__upgrade switches every computer to the "next
// week" state: Git upgraded, 7-Zip uninstalled, disk free space changed (not a new disk version).
let upgraded = false;
let offline = new Set();
let diskReads = 0;

function rowsFor(run, id) {
  if (run.template.includes("osquery_registry")) return (PROBE_TABLES[id] ?? []).map((name) => ({ name }));
  const query = run.name.replace(/\.v\d+$/, "");
  const user = { "e-a1": "user01", "e-a2": "user02", "e-a3": "user03", "e-b1": "carol" }[id] ?? "user";
  const home = id === "e-a2" ? `/Users/${user}` : id === "e-a3" ? `/home/${user}` : `C:\\Users\\${user}`;
  switch (query) {
    case "inv.hardware":
      return [{ hardware_uuid: `uuid-${id}`, hostname: id.toUpperCase(), hardware_vendor: "Dell Inc.", hardware_model: "Latitude 7440", hardware_serial: `SN-${id}`, cpu_brand: "Intel(R) Core(TM) i7-1365U", cpu_physical_cores: "10", cpu_logical_cores: "12", physical_memory: "17179869184", os_name: "Microsoft Windows 11 Enterprise", os_version: "10.0.22631", os_build: "22631", arch: "x86_64", bios_vendor: "Dell Inc.", bios_version: "1.12.1", bios_date: "05/14/2024" }];
    case "inv.disks":
      diskReads++;
      return [{ device_id: "C:", type: "Fixed", file_system: "NTFS", size: "511101108224", free_space: String(200000000000 - diskReads * 1000), boot_partition: "1" }];
    case "inv.programs":
      return [
        ...(upgraded ? [] : [{ name: "7-Zip 23.01 (x64)", version: "23.01", publisher: "Igor Pavlov", install_location: "C:\\Program Files\\7-Zip\\", install_date: "20240110", identifying_number: "7-Zip" }]),
        { name: "Git", version: upgraded ? "2.45.1" : "2.44.0", publisher: "The Git Development Community", install_location: "C:\\Program Files\\Git\\", install_date: "20240301", identifying_number: "Git_is1" },
        { name: "AnyDesk", version: "8.0.9", publisher: "AnyDesk Software GmbH", install_location: "C:\\Program Files (x86)\\AnyDesk", install_date: "20240501", identifying_number: "AnyDesk" },
      ];
    case "inv.programs.deb":
      return [{ name: "curl", version: "8.5.0-2ubuntu10", publisher: "Ubuntu Developers", install_date: null, install_location: null, identifying_number: "amd64" }];
    case "inv.programs.rpm":
      return [];
    case "inv.extensions":
      return [
        { username: user, family: "chromium", browser_type: "chrome", profile: "Default", name: "Chrome Remote Desktop", identifier: "inomeogfingihgjfjlpeplalcfajhgai", version: "124.0.6367.18", update_url: "https://clients2.google.com/service/update2/crx", permissions: "nativeMessaging", path: `${home}\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Extensions\\inomeogfingihgjfjlpeplalcfajhgai\\124.0.6367.18_0` },
        { username: user, family: "chromium", browser_type: "edge", profile: "Default", name: "Keeper Password Manager", identifier: "bfogiafebfohielmmehodmfbbebbbpei", version: "16.11.2", update_url: null, permissions: "storage", path: `${home}\\AppData\\Local\\Microsoft\\Edge\\User Data\\Default\\Extensions\\bfogiafebfohielmmehodmfbbebbbpei\\16.11.2_0` },
      ];
    case "inv.ide_extensions":
      return [{ username: user, name: "python", publisher: "ms-python", version: "2024.2.0", path: `${home}/.vscode/extensions/ms-python.python-2024.2.0` }];
    case "inv.packages":
      return [{ manager: "npm", name: "typescript", version: "5.4.5", vendor: "Microsoft Corp.", path: `${home}\\AppData\\Roaming\\npm\\node_modules\\typescript` }];
    default:
      return [];
  }
}

function endpointState(run, id) {
  const probe = run.template.includes("osquery_registry");
  if ((SILENT.has(id) && !probe) || run.reads < 2) return { status: "started", result: "notAvailable", statusMessage: null };
  const query = run.name.replace(/\.v\d+$/, "");
  const failure = FAILS[id]?.[query] ?? (probe && !PROBE_TABLES[id] ? "osquery error" : null);
  if (failure) return { status: "finished", result: "failed", statusMessage: failure };
  return { status: "finished", result: "succeeded", statusMessage: null };
}

function graphql({ query = "", variables = {} }, tenantId) {
  if (query.includes("createLiveDiscoverSession")) {
    const name = `session-${sessions.size + 1}`;
    sessions.set(name, []);
    return { data: { createLiveDiscoverSession: { session: { name } } } };
  }
  if (query.includes("endpointSessions")) {
    const { sessions: names, action, filter } = variables.input ?? {};
    if (action !== "add" || !Array.isArray(filter?.ids)) return gqlError("bad endpointSessions input");
    for (const name of names) sessions.get(name)?.push(...filter.ids);
    return { data: { endpointSessions: { requestedAt: new Date().toISOString(), completedAt: new Date().toISOString() } } };
  }
  if (query.includes("liveDiscoverEndpointSearch")) {
    const ids = variables.input?.ids ?? [];
    const items = ids.map((id) => ({ id, online: !offline.has(id) }));
    return { data: { liveDiscoverEndpointSearch: { items, pages: { nextKey: null } } } };
  }
  if (query.includes("runLiveDiscoverQuery")) {
    const input = variables.input ?? {};
    const ids = sessions.get(input.sessionId);
    if (!ids || input.matchEndpoints?.all !== false || !input.adHocQuery?.template) return gqlError("bad runLiveDiscoverQuery input");
    const id = `run-${runs.size + 1}`;
    runs.set(id, { tenantId, ids, name: input.adHocQuery.name ?? "", template: input.adHocQuery.template, reads: 0 });
    return { data: { runLiveDiscoverQuery: { executionSummary: { id, status: "started" } } } };
  }
  const run = runs.get(variables.runId);
  if (!run) return gqlError(`unknown run ${variables.runId}`);
  if (run.tenantId !== tenantId) return gqlError("run belongs to another tenant");
  if (query.includes("cancelLiveDiscoverQueryRun")) {
    return gqlError("external service failure: API request failed with status 500", "BAD_GATEWAY");
  }
  if (query.includes("liveDiscoverQueryRunEndpoints")) {
    run.reads++;
    const items = run.ids.map((id) => {
      const state = endpointState(run, id);
      return { id, hostname: id, ...state, resultCount: state.result === "succeeded" ? rowsFor(run, id).length : null };
    });
    return { data: { liveDiscoverQueryRunEndpoints: { items, pages: { current: 1, size: items.length, total: 1 } } } };
  }
  if (query.includes("liveDiscoverQueryRunResults")) {
    const rows = run.ids.flatMap((id) =>
      endpointState(run, id).result === "succeeded"
        ? rowsFor(run, id).map((columns) => ({ endpointId: id, hostname: id, additionalColumns: JSON.stringify(columns) }))
        : [],
    );
    const from = Number(variables.params?.pageFromKey ?? 0);
    const items = rows.slice(from, from + 5);
    const nextKey = from + 5 < rows.length ? String(from + 5) : null;
    return { data: { liveDiscoverQueryRunResults: { items, pages: { fromKey: String(from), nextKey, size: items.length, maxSize: 1000 } } } };
  }
  if (query.includes("liveDiscoverQueryRun")) {
    run.reads++;
    const states = run.ids.map((id) => endpointState(run, id));
    const finished = states.every((s) => s.status === "finished");
    return {
      data: {
        liveDiscoverQueryRun: {
          executionSummary: { id: variables.runId, status: finished ? "finished" : "started", result: finished ? states[0].result : "notAvailable", resultCount: 0 },
        },
      },
    };
  }
  return gqlError("operation not supported by the mock");
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, BASE);
    const key = `${req.method} ${url.pathname}`;
    counts[key] = (counts[key] ?? 0) + 1;
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (key === "GET /__state") return send(res, 200, counts);
      if (key === "POST /__upgrade") {
        upgraded = true;
        return send(res, 200, { upgraded: true });
      }
      if (key === "POST /__offline") {
        offline = new Set(JSON.parse(body || "{}").ids ?? []);
        return send(res, 200, { offline: [...offline] });
      }
      if (key === "POST /__drop") {
        endpoints["tenant-a"] = endpoints["tenant-a"].filter((e) => e.id !== "e-a2");
        return send(res, 200, { dropped: "e-a2" });
      }
      if (key === "POST /api/v2/oauth2/token") {
        const form = new URLSearchParams(body);
        if (form.get("client_id") !== CLIENT_ID || form.get("client_secret") !== SECRET) {
          return send(res, 401, { errorCode: "oauth.invalid_client", message: "Unauthorized" });
        }
        return send(res, 200, { access_token: TOKEN, expires_in: 3600, errorCode: "success", token_type: "bearer" });
      }
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: "unauthorized" });
      if (key === "POST /graphql") return send(res, 200, graphql(JSON.parse(body || "{}"), req.headers["x-tenant-id"]));
      if (key === "GET /whoami/v1") {
        return send(res, 200, { id: "partner-1", idType: "partner", apiHosts: { global: BASE } });
      }
      if (key === "GET /partner/v1/tenants") {
        if (req.headers["x-partner-id"] !== "partner-1") return send(res, 403, { error: "forbidden" });
        const page = Number(url.searchParams.get("page") ?? 1);
        const items =
          page === 1
            ? [{ id: "tenant-a", name: "Lab tenant", showAs: "Lab", apiHost: `${BASE}/us01` }]
            : [{ id: "tenant-b", name: "Acme Ltd", apiHost: `${BASE}/eu01` }];
        return send(res, 200, { pages: { current: page, total: url.searchParams.get("pageTotal") ? 2 : undefined, maxSize: 100 }, items });
      }
      const m = url.pathname.match(/^\/(us01|eu01)\/endpoint\/v1\/endpoints$/);
      if (req.method === "GET" && m) {
        const tenant = req.headers["x-tenant-id"];
        if (!endpoints[tenant]) return send(res, 403, { error: "unknown tenant" });
        if (tenant === "tenant-a" && !throttled) {
          throttled = true;
          return send(res, 429, { error: "Too many requests" }, { "Retry-After": "1" });
        }
        // Two items per page, key = index of the next item.
        const from = Number(url.searchParams.get("pageFromKey") ?? 0);
        const list = endpoints[tenant];
        const items = list.slice(from, from + 2);
        const next = from + 2 < list.length ? String(from + 2) : undefined;
        return send(res, 200, { items, pages: { fromKey: String(from), nextKey: next, size: items.length, maxSize: 2 } });
      }
      send(res, 404, { error: `mock has no route for ${key}` });
    });
  })
  .listen(PORT, "0.0.0.0", () => console.log(`mock sophos on ${PORT}`));
