// Demo fleet for walkthrough videos and screenshots (never used in production): two fictional companies,
// 24 computers, the software each role installs, one week of changes (week 2 = after POST /__upgrade),
// the category of each title and a few real public CVEs. Shared by mock-sophos-demo.mjs and load-hub.mjs.

export const TENANTS = [
  { id: "tenant-aurora", name: "Aurora Logistics", region: "us01" },
  { id: "tenant-bright", name: "Brightline Clinics", region: "eu01" },
];

// [hostname, platform, role, user, hardware vendor, model]; the order gives stable endpoint IDs.
const MACHINES = {
  "tenant-aurora": [
    ["AUR-LT-001", "windows", "office", "m.santos", "Dell Inc.", "Latitude 7450"],
    ["AUR-LT-002", "windows", "office", "j.miller", "Dell Inc.", "Latitude 7450"],
    ["AUR-LT-003", "windows", "office", "a.costa", "Lenovo", "ThinkPad T14 Gen 5"],
    ["AUR-LT-004", "windows", "office", "r.oliveira", "Lenovo", "ThinkPad T14 Gen 5"],
    ["AUR-LT-005", "windows", "office", "e.walker", "HP", "EliteBook 840 G11"],
    ["AUR-LT-006", "windows", "finance", "l.ferreira", "HP", "EliteBook 840 G11"],
    ["AUR-LT-007", "windows", "dev", "d.nguyen", "Dell Inc.", "Precision 5690"],
    ["AUR-LT-008", "windows", "dev", "p.almeida", "Dell Inc.", "Precision 5690"],
    ["AUR-LT-009", "windows", "it", "c.ribeiro", "Lenovo", "ThinkPad P16s Gen 3"],
    ["AUR-LT-010", "windows", "it", "s.kim", "Lenovo", "ThinkPad P16s Gen 3"],
    ["AUR-LT-011", "windows", "office", "b.rocha", "Dell Inc.", "Latitude 5550"],
    ["AUR-MAC-01", "macos", "design", "t.lima", "Apple Inc.", "MacBook Pro (M4 Pro)"],
    ["AUR-MAC-02", "macos", "design", "n.patel", "Apple Inc.", "MacBook Pro (M4 Pro)"],
    ["AUR-SRV-WEB01", "linux", "web", null, "Dell Inc.", "PowerEdge R660"],
    ["AUR-SRV-DB01", "linux", "db", null, "Dell Inc.", "PowerEdge R760"],
  ],
  "tenant-bright": [
    ["BRT-PC-01", "windows", "office", "f.mendes", "HP", "ProDesk 400 G9"],
    ["BRT-PC-02", "windows", "office", "g.souza", "HP", "ProDesk 400 G9"],
    ["BRT-PC-03", "windows", "office", "h.martins", "HP", "ProDesk 400 G9"],
    ["BRT-PC-04", "windows", "reception", "i.araujo", "Lenovo", "ThinkCentre M70q Gen 5"],
    ["BRT-PC-05", "windows", "reception", "k.barbosa", "Lenovo", "ThinkCentre M70q Gen 5"],
    ["BRT-PC-06", "windows", "it", "o.carvalho", "Dell Inc.", "OptiPlex 7020"],
    ["BRT-LT-07", "windows", "finance", "v.teixeira", "Dell Inc.", "Latitude 5450"],
    ["BRT-MAC-01", "macos", "design", "y.cardoso", "Apple Inc.", "MacBook Air (M3)"],
    ["BRT-SRV-01", "linux", "web", null, "HP", "ProLiant DL360 Gen11"],
  ],
};

// AUR-LT-011 is switched off: Sophos Central shows it offline, so it is never queried.
export const OFFLINE = new Set(["AUR-LT-011"]);

const OS = {
  windows: { platform: "windows", name: "Windows 11 Enterprise", majorVersion: 10, minorVersion: 0, build: 26100 },
  macos: { platform: "macOS", name: "macOS Tahoe", majorVersion: 26, minorVersion: 1 },
  linux: { platform: "linux", name: "Ubuntu 24.04.3 LTS" },
};

const domainOf = (tenantId) => (tenantId === "tenant-aurora" ? "AURORA" : "BRIGHTLINE");

export const ENDPOINTS = Object.fromEntries(
  Object.entries(MACHINES).map(([tenantId, rows]) => [
    tenantId,
    rows.map(([hostname, platform, role, user], i) => ({
      id: `${tenantId.slice(7, 10)}-${String(i + 1).padStart(2, "0")}`,
      type: platform === "linux" ? "server" : "computer",
      hostname,
      health: { overall: hostname === "BRT-PC-04" ? "suspicious" : "good" },
      os: OS[platform],
      ...(user ? { associatedPerson: { name: user, viaLogin: `${domainOf(tenantId)}\\${user}` } } : {}),
      lastSeenAt: OFFLINE.has(hostname) ? "2026-10-24T17:42:00Z" : "2026-11-03T13:50:00Z",
      online: !OFFLINE.has(hostname),
      _platform: platform,
      _role: role,
      _user: user,
      _vendor: rows[i][4],
      _model: rows[i][5],
    })),
  ]),
);
export const ALL_ENDPOINTS = Object.values(ENDPOINTS).flat();

// Programs ----------------------------------------------------------------------------------------
const P = (name, version, publisher, folder) => ({ name, version, publisher, folder });
const WIN_BASE = (week2) => [
  P("Google Chrome", week2 ? "142.0.7444.60" : "141.0.7390.123", "Google LLC", "Google\\Chrome\\Application"),
  P("Microsoft Edge", "142.0.3595.53", "Microsoft Corporation", "Microsoft\\Edge\\Application"),
  P("Microsoft 365 Apps for enterprise - en-us", "16.0.19328.20190", "Microsoft Corporation", "Microsoft Office"),
  P("Microsoft Teams", "25290.205.4069.4894", "Microsoft Corporation", "WindowsApps\\MSTeams"),
  P("Zoom Workplace (64-bit)", "6.6.5", "Zoom Communications, Inc.", "Zoom\\bin"),
  P("Adobe Acrobat Reader (64-bit)", "25.001.20844", "Adobe", "Adobe\\Acrobat DC"),
  P("Sophos Endpoint Agent", "2025.2.3.31", "Sophos Limited", "Sophos\\Sophos Endpoint Agent"),
  P("Sophos Endpoint Defense", "4.2.1.1094", "Sophos Limited", "Sophos\\Endpoint Defense"),
  P("Microsoft Edge WebView2 Runtime", "142.0.3595.53", "Microsoft Corporation", "Microsoft\\EdgeWebView"),
  P("Microsoft Visual C++ 2015-2022 Redistributable (x64) - 14.44.35211", "14.44.35211.0", "Microsoft Corporation", null),
];
const ROLE_PROGRAMS = {
  office: [P("7-Zip 24.08 (x64)", "24.08", "Igor Pavlov", "7-Zip"), P("VLC media player", "3.0.21", "VideoLAN", "VideoLAN\\VLC"), P("Notepad++ (64-bit x64)", "8.8.5", "Notepad++ Team", "Notepad++")],
  finance: [P("7-Zip 24.08 (x64)", "24.08", "Igor Pavlov", "7-Zip"), P("WinRAR 7.13 (64-bit)", "7.13.0", "win.rar GmbH", "WinRAR"), P("KeePass Password Safe 2.59", "2.59", "Dominik Reichl", "KeePass Password Safe 2")],
  reception: [P("7-Zip 23.01 (x64)", "23.01", "Igor Pavlov", "7-Zip"), P("AnyDesk", "9.6.1", "AnyDesk Software GmbH", "AnyDesk")],
  dev: [
    P("Git", "2.51.0", "The Git Development Community", "Git"),
    P("Python 3.13.7 (64-bit)", "3.13.7150.0", "Python Software Foundation", null),
    P("Node.js", "22.20.0", "Node.js Foundation", "nodejs"),
    P("Docker Desktop", "4.48.0", "Docker Inc.", "Docker\\Docker"),
    P("Microsoft Visual Studio Code (User)", "1.105.1", "Microsoft Corporation", null),
    P("Postman x64 11.67.4", "11.67.4", "Postman", null),
    P("7-Zip 24.08 (x64)", "24.08", "Igor Pavlov", "7-Zip"),
  ],
  it: [
    P("PuTTY release 0.79 (64-bit)", "0.79.0.0", "Simon Tatham", "PuTTY"),
    P("WinSCP 6.5.3", "6.5.3", "Martin Prikryl", "WinSCP"),
    P("TeamViewer", "15.70.5", "TeamViewer", "TeamViewer"),
    P("Wireshark 4.4.9 x64", "4.4.9", "The Wireshark developer community, https://www.wireshark.org", "Wireshark"),
    P("Bitwarden", "2025.10.0", "Bitwarden Inc.", null),
    P("7-Zip 24.08 (x64)", "24.08", "Igor Pavlov", "7-Zip"),
  ],
};
// Single machines, so the screens have something to find. [hostname, week 1 (true/false), week 2 (true/false), program]
const EXTRA_PROGRAMS = [
  ["AUR-LT-001", true, true, P("Spotify", "1.2.74.477", "Spotify AB", null)],
  ["AUR-LT-002", true, false, P("AnyDesk", "9.6.1", "AnyDesk Software GmbH", "AnyDesk")],
  ["AUR-LT-002", true, true, P("Steam", "2.10.91.91", "Valve Corporation", "Steam")],
  ["AUR-LT-004", false, true, P("Tor Browser", "15.0.1", "The Tor Project", null)],
  ["AUR-LT-005", true, true, P("qBittorrent", "5.1.2", "The qBittorrent project", "qBittorrent")],
  ["AUR-LT-006", true, true, P("WinRAR 6.22 (64-bit)", "6.22.0", "win.rar GmbH", "WinRAR")],
  ["AUR-LT-007", false, true, P("Ollama version 0.12.6", "0.12.6", "Ollama", null)],
  ["AUR-LT-009", true, true, P("Nmap 7.98", "7.98", "Nmap Project", "Nmap")],
  ["BRT-LT-07", true, true, P("WinRAR 6.22 (64-bit)", "6.22.0", "win.rar GmbH", "WinRAR")],
  ["BRT-PC-06", true, true, P("PuTTY release 0.83 (64-bit)", "0.83.0.0", "Simon Tatham", "PuTTY")],
];
// Week 2 upgrades on one machine: [hostname, program name in week 1, program in week 2]
const UPGRADES = [["AUR-LT-003", "7-Zip 24.08 (x64)", P("7-Zip 25.01 (x64)", "25.01", "Igor Pavlov", "7-Zip")]];

const MAC_APPS = (week2) => [
  ["Google Chrome", week2 ? "142.0.7444.60" : "141.0.7390.123", "com.google.Chrome"],
  ["Slack", "4.46.101", "com.tinyspeck.slackmacgap"],
  ["zoom.us", "6.6.5", "us.zoom.xos"],
  ["Figma", "125.9.10", "com.figma.Desktop"],
  ["Adobe Photoshop 2026", "27.0.0", "com.adobe.Photoshop"],
  ["Spotify", "1.2.74", "com.spotify.client"],
  ["1Password", "8.11.12", "com.1password.1password"],
  ["Microsoft Word", "16.102", "com.microsoft.Word"],
  ["Microsoft Teams", "25290.205.4069", "com.microsoft.teams2"],
  ["Sophos Endpoint", "2025.2.1", "com.sophos.endpoint.uiserver"],
];
const DEB = {
  web: [["nginx", "1.24.0-2ubuntu7.5"], ["openssh-server", "1:9.6p1-3ubuntu13.14"], ["openssl", "3.0.13-0ubuntu3.6"], ["curl", "8.5.0-2ubuntu10.6"], ["docker-ce", "5:28.5.1-1~ubuntu.24.04~noble"]],
  db: [["postgresql-16", "16.10-0ubuntu0.24.04.1"], ["openssh-server", "1:9.6p1-3ubuntu13.14"], ["openssl", "3.0.13-0ubuntu3.6"], ["curl", "8.5.0-2ubuntu10.6"]],
};

function programsFor(ep, week2) {
  if (ep._platform === "macos") {
    return MAC_APPS(week2).map(([name, version, bundle]) => ({ name, version, publisher: null, install_date: null, install_location: `/Applications/${name}.app`, identifying_number: bundle }));
  }
  if (ep._platform === "linux") return [];
  let list = [...WIN_BASE(week2), ...(ROLE_PROGRAMS[ep._role] ?? [])];
  for (const [host, w1, w2, p] of EXTRA_PROGRAMS) if (host === ep.hostname && (week2 ? w2 : w1)) list.push(p);
  if (week2) for (const [host, from, to] of UPGRADES) if (host === ep.hostname) list = list.map((p) => (p.name === from ? to : p));
  return list.map((p) => ({
    name: p.name,
    version: p.version,
    publisher: p.publisher,
    install_date: "20250915",
    install_location: p.folder ? `C:\\Program Files\\${p.folder}\\` : null,
    identifying_number: `{${p.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 12).toUpperCase()}}`,
  }));
}

// Extensions, IDE extensions, packages ----------------------------------------------------------------
const CHROME_EXT = {
  ublock: ["uBlock Origin", "cjpalhdlnbpafiamejdnhcphjbkeiagm", "1.66.4", "storage, webRequest"],
  translate: ["Google Translate", "aapbdbdomjkkjkaonfhkkikfgjllcleb", "2.0.16", "activeTab"],
  grammarly: ["Grammarly: AI Writing Assistant and Grammar Checker App", "kbfnbcaeplbcioakkpcpgfkobkghlhen", "14.1262.0", "tabs, cookies"],
  lastpass: ["LastPass: Free Password Manager", "hdokiejnpimakedhajhdlcegeplioahd", "4.150.1", "storage, tabs"],
  honey: ["Honey: Automatic Coupons & Rewards", "bmnlcjabgnpnenekpadlanbbkooimhnj", "18.3.0", "tabs, cookies, webRequest"],
  hola: ["Hola VPN - Your Website Unblocker", "gkojfkhlekighikafcpjkiklfbnlmeio", "1.235.0", "proxy, webRequest"],
  monica: ["Monica - ChatGPT AI Assistant", "ofpnmcalabcbjgholdjcjblkibolbppb", "7.9.5", "tabs, scripting"],
  crd: ["Chrome Remote Desktop", "inomeogfingihgjfjlpeplalcfajhgai", "125.0.6422.0", "nativeMessaging"],
};
const EXT_BY_ROLE = {
  office: ["ublock", "translate", "grammarly"],
  finance: ["lastpass", "translate"],
  reception: ["translate"],
  dev: ["ublock", "monica"],
  it: ["ublock", "crd"],
  design: ["ublock", "grammarly"],
};
const EXTRA_EXT = [["AUR-LT-005", false, true, "honey"], ["AUR-LT-001", true, true, "hola"], ["BRT-PC-02", true, true, "honey"]];

function extensionsFor(ep, week2) {
  if (!ep._user) return [];
  const keys = [...(EXT_BY_ROLE[ep._role] ?? [])];
  for (const [host, w1, w2, k] of EXTRA_EXT) if (host === ep.hostname && (week2 ? w2 : w1)) keys.push(k);
  const mac = ep._platform === "macos";
  return keys.map((k) => {
    const [name, id, version, permissions] = CHROME_EXT[k];
    const path = mac
      ? `/Users/${ep._user}/Library/Application Support/Google/Chrome/Default/Extensions/${id}/${version}_0`
      : `C:\\Users\\${ep._user}\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Extensions\\${id}\\${version}_0`;
    return { username: ep._user, family: "chromium", browser_type: "chrome", profile: "Default", name, identifier: id, version, update_url: "https://clients2.google.com/service/update2/crx", permissions, path };
  });
}

const VSCODE = [["python", "ms-python", "2025.16.0"], ["vscode-eslint", "dbaeumer", "3.0.16"], ["prettier-vscode", "esbenp", "11.0.0"], ["copilot", "github", "1.388.0"], ["vscode-docker", "ms-azuretools", "2.0.0"]];
function ideExtensionsFor(ep) {
  if (ep._role !== "dev") return [];
  return VSCODE.map(([name, publisher, version]) => ({ username: ep._user, name, publisher, version, path: `C:\\Users\\${ep._user}\\.vscode\\extensions\\${publisher}.${name}-${version}` }));
}

function packagesFor(ep) {
  if (ep._role === "dev") {
    const npm = `C:\\Users\\${ep._user}\\AppData\\Roaming\\npm\\node_modules`;
    return [
      { manager: "npm", name: "typescript", version: "5.9.3", vendor: "Microsoft Corp.", path: `${npm}\\typescript` },
      { manager: "npm", name: "eslint", version: "9.38.0", vendor: "Nicholas C. Zakas", path: `${npm}\\eslint` },
      { manager: "pip", name: "requests", version: "2.32.5", vendor: "Kenneth Reitz", path: "C:\\Program Files\\Python313\\Lib\\site-packages" },
      { manager: "pip", name: "numpy", version: "2.3.4", vendor: "Travis E. Oliphant et al.", path: "C:\\Program Files\\Python313\\Lib\\site-packages" },
    ];
  }
  if (ep._role === "design") return [{ manager: "homebrew", name: "ffmpeg", version: "8.0", vendor: null, path: "/opt/homebrew/Cellar/ffmpeg/8.0" }];
  return [];
}

function hardwareFor(ep) {
  const mac = ep._platform === "macos";
  return {
    hardware_uuid: `demo-${ep.id}`,
    hostname: ep.hostname,
    hardware_vendor: ep._vendor,
    hardware_model: ep._model,
    hardware_serial: `DEMO${ep.id.replace(/\W/g, "").toUpperCase()}`,
    cpu_brand: mac ? "Apple M4 Pro" : ep._platform === "linux" ? "Intel(R) Xeon(R) Silver 4510" : "Intel(R) Core(TM) Ultra 7 165U",
    cpu_physical_cores: mac ? "12" : ep._platform === "linux" ? "12" : "12",
    cpu_logical_cores: mac ? "12" : ep._platform === "linux" ? "24" : "14",
    physical_memory: String((ep._platform === "linux" ? 64 : ep._role === "dev" ? 32 : 16) * 1024 ** 3),
    os_name: mac ? "macOS" : ep._platform === "linux" ? "Ubuntu" : "Microsoft Windows 11 Enterprise",
    os_version: mac ? "26.1" : ep._platform === "linux" ? "24.04.3 LTS (Noble Numbat)" : "10.0.26100",
    os_build: mac ? "25B78" : ep._platform === "linux" ? "" : "26100",
    arch: mac ? "arm64" : "x86_64",
    bios_vendor: ep._vendor,
    bios_version: mac ? "13822.41.1" : "1.9.0",
    bios_date: "06/12/2025",
  };
}

function disksFor(ep) {
  if (ep._platform === "windows") return [{ device_id: "C:", type: "Fixed", file_system: "NTFS", size: "511101108224", free_space: "201326592000", boot_partition: "1" }];
  return [{ device_id: "/dev/disk3s1s1", type: ep._platform === "macos" ? "apfs" : "ext4", file_system: ep._platform === "macos" ? "apfs" : "ext4", size: "994662584320", free_space: "512110190592", mount_point: "/" }];
}

// Rows an endpoint returns for a query (name without .vN), in week 1 or week 2.
export function rowsFor(ep, query, week2) {
  switch (query) {
    case "inv.hardware":
      return [hardwareFor(ep)];
    case "inv.disks":
      return disksFor(ep);
    case "inv.programs":
      return programsFor(ep, week2);
    case "inv.programs.deb":
      return (DEB[ep._role] ?? []).map(([name, version]) => ({ name, version, publisher: "Ubuntu Developers", install_date: null, install_location: null, identifying_number: "amd64" }));
    case "inv.programs.rpm":
      return [];
    case "inv.extensions":
      return extensionsFor(ep, week2);
    case "inv.ide_extensions":
      return ideExtensionsFor(ep);
    case "inv.packages":
      return packagesFor(ep);
    default:
      return [];
  }
}

// Categories for the mock Hub, by kind and name (first match wins) ---------------------------------
export const CATEGORY_RULES = [
  [/^(sophos)/i, "sophos-applications/sophos-agents-and-tools"],
  [/webview2|visual c\+\+|redistributable/i, "system-applications/os-components-and-runtimes"],
  [/chrome remote desktop|anydesk|teamviewer/i, "remote-access/remote-desktop-and-support"],
  [/putty/i, "remote-access/ssh-and-terminal-clients"],
  [/winscp/i, "file-transfer/ftp-and-sftp-clients"],
  [/tor browser/i, "proxy-and-tunnel/anonymizers"],
  [/hola vpn/i, "proxy-and-tunnel/consumer-vpn-and-proxy-services"],
  [/qbittorrent/i, "p2p/torrent-clients"],
  [/^steam$/i, "gaming/game-launchers-and-stores"],
  [/honey/i, "e-commerce/shopping-assistants"],
  [/monica|chatgpt/i, "generative-ai/ai-browser-extensions"],
  [/^copilot$/i, "generative-ai/ai-coding-assistants"],
  [/ollama/i, "generative-ai/local-ai-runtimes"],
  [/wireshark|nmap/i, "security-and-identity/security-testing-tools"],
  [/keepass|lastpass|1password|bitwarden/i, "security-and-identity/password-managers"],
  [/chrome|edge$|^microsoft edge|firefox/i, "general-internet/web-browsers"],
  [/ublock|google translate|grammarly/i, "general-internet/browser-utilities"],
  [/zoom/i, "conferencing/video-meetings"],
  [/teams|slack/i, "instant-messenger/team-chat"],
  [/spotify/i, "streaming-media/music-and-podcasts"],
  [/vlc|ffmpeg/i, "streaming-media/media-players-and-casting"],
  [/7-zip|winrar/i, "general-business/compression-and-file-utilities"],
  [/microsoft 365|word|acrobat|notepad\+\+/i, "general-business/office-and-documents"],
  [/figma|photoshop/i, "general-business/design-and-creative"],
  [/docker/i, "infrastructure/virtualization-and-containers"],
  [/^git$|postman/i, "developer-tools/clis-and-version-control"],
  [/visual studio code/i, "developer-tools/ides-and-editors"],
  [/python|node\.js/i, "developer-tools/language-runtimes-and-sdks"],
  [/^(typescript|eslint|requests|numpy)$/i, "developer-tools/libraries-and-packages"],
  [/^(vscode-eslint|prettier-vscode|vscode-docker)$/i, "developer-tools/ide-extensions"],
  [/^nginx$/i, "network-services/web-and-app-servers"],
  [/^postgresql/i, "network-services/database-servers"],
  [/^docker-ce$/i, "infrastructure/virtualization-and-containers"],
  [/^(openssh-server|openssl|curl)$/i, "system-applications/os-components-and-runtimes"],
];
export const categoryFor = (name) => CATEGORY_RULES.find(([re]) => re.test(name))?.[1] ?? "other/other";

// Real public CVEs (NVD / CISA KEV), by the product's canonical name in the app. No EPSS: those numbers
// change every day and are left empty rather than invented.
export const CVES = [
  {
    product: "WinRAR",
    vuln_id: "CVE-2023-38831",
    summary: "RARLAB WinRAR before 6.23 allows attackers to execute arbitrary code when a user attempts to view a benign file within a ZIP archive.",
    severity: "HIGH", cvss_version: "3.1", cvss_score: 7.8, cwe: ["CWE-351"],
    kev_added: "2023-08-24", kev_due: "2023-09-14",
    references: ["https://nvd.nist.gov/vuln/detail/CVE-2023-38831"],
    ranges: [{ version_start: null, start_inclusive: null, version_end: "6.23", end_inclusive: false, exact_version: null, source: "nvd" }],
  },
  {
    product: "7-Zip",
    vuln_id: "CVE-2025-0411",
    summary: "7-Zip before 24.09 does not propagate the Mark-of-the-Web to files extracted from crafted nested archives, which bypasses Windows protections.",
    severity: "HIGH", cvss_version: "3.0", cvss_score: 7.0, cwe: ["CWE-693"],
    kev_added: "2025-02-06", kev_due: "2025-02-27",
    references: ["https://nvd.nist.gov/vuln/detail/CVE-2025-0411"],
    ranges: [{ version_start: null, start_inclusive: null, version_end: "24.09", end_inclusive: false, exact_version: null, source: "nvd" }],
  },
  {
    product: "7-Zip",
    vuln_id: "CVE-2024-11477",
    summary: "Integer underflow in the Zstandard decompression of 7-Zip before 24.07 allows remote code execution through a crafted archive.",
    severity: "HIGH", cvss_version: "3.0", cvss_score: 7.8, cwe: ["CWE-191"],
    references: ["https://nvd.nist.gov/vuln/detail/CVE-2024-11477"],
    ranges: [{ version_start: null, start_inclusive: null, version_end: "24.07", end_inclusive: false, exact_version: null, source: "nvd" }],
  },
  {
    product: "PuTTY",
    vuln_id: "CVE-2024-31497",
    summary: "PuTTY 0.68 to 0.80 generates biased ECDSA nonces for NIST P-521 keys, so an attacker who sees about 60 signatures can recover the private key.",
    severity: "MEDIUM", cvss_version: "3.1", cvss_score: 5.9, cwe: ["CWE-338"],
    references: ["https://nvd.nist.gov/vuln/detail/CVE-2024-31497"],
    ranges: [{ version_start: "0.68", start_inclusive: true, version_end: "0.81", end_inclusive: false, exact_version: null, source: "nvd" }],
  },
];
