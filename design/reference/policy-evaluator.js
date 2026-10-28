/* Reference implementation from the clickable mock (design/mock/Policies.dc.html and PolicyRule.dc.html).
   Plain ES5-style JavaScript so it runs inside the mock. Port it to TypeScript in
   supabase/functions/_shared/policy.ts; keep the same operator semantics.
   PC_TITLES (42 titles) and PC_RULES (12 rules) are the test fixture for Phase 9:
   expected classes: core system 6, sanctioned 13, tolerated 7, unsanctioned 16 (9 by the default class).
   Note: the mock evaluates a title's newest version; the app must evaluate each installed version. */

/* Application policy: classes, fields, operators, evaluator and sample data.
   Classes follow CIS Controls v8.1, Control 2 (software inventory and control). */
var PC_CLASSES = {
  core: { key: 'core', id: 'core-system', label: 'Core system', color: '#6A889B',
    meaning: 'Operating system, drivers, runtimes and security agents the asset needs to run.',
    cis: 'Authorized · 2.1, 2.5' },
  sanctioned: { key: 'sanctioned', id: 'sanctioned-app', label: 'Sanctioned', color: '#2006F7',
    meaning: 'Approved for business use, with a business purpose and a supported version.',
    cis: 'Authorized · 2.1, 2.2, 2.5' },
  tolerated: { key: 'tolerated', id: 'tolerated-app', label: 'Tolerated', color: '#009CFB',
    meaning: 'Not authorized, kept under a documented exception with an owner, mitigating controls and a monthly review.',
    cis: 'Documented exception · 2.2, 2.3' },
  unsanctioned: { key: 'unsanctioned', id: 'unsanctioned-app', label: 'Unsanctioned', color: '#EA0022',
    meaning: 'Unauthorized or unsupported with no exception. Remove it from enterprise assets.',
    cis: 'Unauthorized · 2.3' }
};
var PC_ORDER = ['core', 'sanctioned', 'tolerated', 'unsanctioned'];

var PC_FIELDS = {
  vendor: { label: 'Vendor / publisher', type: 'text' },
  name: { label: 'App name', type: 'text' },
  category: { label: 'Category', type: 'cat1' },
  subcategory: { label: 'Subcategory', type: 'cat2' },
  version: { label: 'Version', type: 'version' },
  extid: { label: 'Extension or package ID', type: 'text' }
};
var PC_OP_LABEL = {
  equals: 'is', not_equals: 'is not', contains: 'contains', not_contains: 'does not contain',
  starts_with: 'starts with', ends_with: 'ends with', regex: 'matches regex', in: 'is one of', not_in: 'is not one of',
  gt: '>', gte: '≥', lt: '<', lte: '≤', between: 'between'
};
var PC_KINDS = { program: 'Programs', extension: 'Browser extensions', ide_extension: 'IDE extensions', package: 'Packages' };

/* Compare dotted versions number by number: 10.2 > 9.14, 21.011.20039 < 24. Non-numeric parts compare as text. */
function pcVer(a, b) {
  var x = String(a).trim().split(/[.\-+_ ]/), y = String(b).trim().split(/[.\-+_ ]/);
  var n = Math.max(x.length, y.length);
  for (var i = 0; i < n; i++) {
    var p = x[i] === undefined ? '0' : x[i], q = y[i] === undefined ? '0' : y[i];
    if (/^\d+$/.test(p) && /^\d+$/.test(q)) {
      var d = parseInt(p, 10) - parseInt(q, 10);
      if (d) return d < 0 ? -1 : 1;
    } else if (p !== q) {
      return p < q ? -1 : 1;
    }
  }
  return 0;
}
function pcValue(t, f) {
  if (f === 'vendor') return t.vendor || '';
  if (f === 'name') return t.name || '';
  if (f === 'category') return t.l1 || '';
  if (f === 'subcategory') return t.l2 || '';
  if (f === 'version') return t.version || '';
  if (f === 'extid') return t.extId || '';
  return '';
}
function pcList(c) {
  if (c.vs && c.vs.length) return c.vs;
  return String(c.v || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}
/* Returns { ok, error }. Text compares ignore case unless c.cs is true. */
function pcTest(c, t) {
  var type = PC_FIELDS[c.f].type, raw = pcValue(t, c.f);
  if (c.op === 'regex') {
    try { return { ok: new RegExp(c.v || '', c.cs ? '' : 'i').test(raw) }; }
    catch (e) { return { ok: false, error: 'Invalid regular expression' }; }
  }
  if (type === 'version') {
    if (!raw) return { ok: false };
    var cmp = pcVer(raw, c.v || '0');
    if (c.op === 'equals') return { ok: cmp === 0 };
    if (c.op === 'not_equals') return { ok: cmp !== 0 };
    if (c.op === 'gt') return { ok: cmp > 0 };
    if (c.op === 'gte') return { ok: cmp >= 0 };
    if (c.op === 'lt') return { ok: cmp < 0 };
    if (c.op === 'lte') return { ok: cmp <= 0 };
    if (c.op === 'between') return { ok: cmp >= 0 && pcVer(raw, c.v2 || c.v || '0') <= 0 };
    return { ok: false };
  }
  var norm = function (s) { return c.cs ? String(s) : String(s).toLowerCase(); };
  var a = norm(raw), list = pcList(c).map(norm), v = norm(c.v || '');
  if (c.op === 'equals') return { ok: a === v };
  if (c.op === 'not_equals') return { ok: a !== v };
  if (c.op === 'contains') return { ok: !!v && a.indexOf(v) !== -1 };
  if (c.op === 'not_contains') return { ok: !v || a.indexOf(v) === -1 };
  if (c.op === 'starts_with') return { ok: !!v && a.indexOf(v) === 0 };
  if (c.op === 'ends_with') return { ok: !!v && a.slice(-v.length) === v };
  if (c.op === 'in') return { ok: list.indexOf(a) !== -1 };
  if (c.op === 'not_in') return { ok: list.indexOf(a) === -1 };
  return { ok: false };
}
function pcRuleTest(r, t) {
  if (!r.enabled) return { ok: false, reason: 'Rule is disabled' };
  if (r.kinds.indexOf(t.kind) === -1) return { ok: false, reason: 'Does not apply to ' + PC_KINDS[t.kind].toLowerCase() };
  var results = r.conds.map(function (c) { return pcTest(c, t); });
  var ok = r.match === 'any' ? results.some(function (x) { return x.ok; }) : results.every(function (x) { return x.ok; });
  if (ok) return { ok: true };
  if (r.match === 'any') return { ok: false, reason: 'No condition matches' };
  var i = results.findIndex(function (x) { return !x.ok; });
  return { ok: false, reason: pcCondText(r.conds[i]) + ' is false (' + (pcValue(t, r.conds[i].f) || 'empty') + ')' };
}
function pcClassify(rules, t, dflt) {
  for (var i = 0; i < rules.length; i++) {
    if (pcRuleTest(rules[i], t).ok) return { cls: rules[i].cls, index: i, rule: rules[i] };
  }
  return { cls: dflt, index: -1, rule: null };
}
function pcCondText(c) {
  var f = PC_FIELDS[c.f].label, op = PC_OP_LABEL[c.op];
  if (c.op === 'in' || c.op === 'not_in') return f + ' ' + op + ' ' + pcList(c).join(', ');
  if (c.op === 'between') return f + ' between ' + (c.v || '?') + ' and ' + (c.v2 || '?');
  return f + ' ' + op + ' ' + (c.v || '?') + (c.cs ? ' (case-sensitive)' : '');
}

/* Sample titles: the shape of title_summary rows, with the class inputs the rules read. */
var PC_TITLES = [
  { name: 'Microsoft Visual C++ 2015-2022 Redistributable (x64)', vendor: 'Microsoft Corporation', kind: 'program', l1: 'System applications', l2: 'OS components and runtimes', version: '14.40.33810', computers: 401 },
  { name: 'Microsoft Edge WebView2 Runtime', vendor: 'Microsoft Corporation', kind: 'program', l1: 'System applications', l2: 'OS components and runtimes', version: '130.0.2849.56', computers: 398 },
  { name: 'Intel Graphics Driver', vendor: 'Intel Corporation', kind: 'program', l1: 'System applications', l2: 'Drivers and hardware utilities', version: '31.0.101.5590', computers: 260 },
  { name: 'Dell Command | Update', vendor: 'Dell Inc.', kind: 'program', l1: 'System applications', l2: 'OEM utilities', version: '5.4.0', computers: 188 },
  { name: 'Chrome Web Store Payments', vendor: 'Google', kind: 'extension', extId: 'nmmhkkegccagdldgiimedpiccmgmieda', l1: 'System applications', l2: 'Browser components', version: '1.0.0.6', computers: 140 },
  { name: 'Sophos Endpoint Agent', vendor: 'Sophos Limited', kind: 'program', l1: 'Sophos applications', l2: 'Sophos agents and tools', version: '2024.3.1', computers: 412 },
  { name: 'Google Chrome', vendor: 'Google LLC', kind: 'program', l1: 'General internet', l2: 'Web browsers', version: '130.0.6723.92', computers: 377 },
  { name: 'Microsoft 365 Apps for business', vendor: 'Microsoft Corporation', kind: 'program', l1: 'General business', l2: 'Office and documents', version: '16.0.18129.20158', computers: 366 },
  { name: 'Adobe Acrobat (64-bit)', vendor: 'Adobe', kind: 'program', l1: 'General business', l2: 'Office and documents', version: '24.003.20180', computers: 141 },
  { name: 'Adobe Acrobat Reader DC', vendor: 'Adobe Systems Incorporated', kind: 'program', l1: 'General business', l2: 'Office and documents', version: '21.011.20039', computers: 23 },
  { name: 'Adobe Acrobat: PDF edit, convert, sign tools', vendor: 'Adobe', kind: 'extension', extId: 'efaidnbmnnnibpcajpcglclefindmkaj', l1: 'General business', l2: 'Office and documents', version: '26.10.1.0', computers: 52 },
  { name: 'Zoom Workplace', vendor: 'Zoom Video Communications, Inc.', kind: 'program', l1: 'Conferencing', l2: 'Video meetings', version: '6.2.6', computers: 214 },
  { name: 'Cisco Webex Meetings', vendor: 'Cisco Systems', kind: 'program', l1: 'Conferencing', l2: 'Video meetings', version: '44.10.0', computers: 37 },
  { name: 'Slack', vendor: 'Slack Technologies', kind: 'program', l1: 'Instant messenger', l2: 'Team chat', version: '4.41.97', computers: 58 },
  { name: 'AnyDesk', vendor: 'AnyDesk Software GmbH', kind: 'program', l1: 'Remote access', l2: 'Remote desktop and support', version: '9.0.5', computers: 21 },
  { name: 'TeamViewer', vendor: 'TeamViewer Germany GmbH', kind: 'program', l1: 'Remote access', l2: 'Remote desktop and support', version: '15.58.4', computers: 9 },
  { name: 'anydesk', vendor: 'AnyDesk Software GmbH', kind: 'package', extId: 'anydesk', l1: 'Remote access', l2: 'Remote desktop and support', version: '9.0.5', computers: 2 },
  { name: 'RustDesk', vendor: 'Purslane Ltd', kind: 'program', l1: 'Remote access', l2: 'Remote desktop and support', version: '1.3.2', computers: 2 },
  { name: 'Chrome Remote Desktop', vendor: 'Google', kind: 'extension', extId: 'inomeogfingihgjfjlpeplalcfajhgai', l1: 'Remote access', l2: 'Remote desktop and support', version: '2.1', computers: 11 },
  { name: 'PuTTY', vendor: 'Simon Tatham', kind: 'program', l1: 'Remote access', l2: 'SSH and terminal clients', version: '0.81', computers: 17 },
  { name: 'FortiClient VPN', vendor: 'Fortinet Technologies Inc', kind: 'program', l1: 'Proxy and tunnel', l2: 'Corporate VPN clients', version: '7.4.1', computers: 44 },
  { name: 'OpenVPN Connect', vendor: 'OpenVPN Inc.', kind: 'program', l1: 'Proxy and tunnel', l2: 'Corporate VPN clients', version: '3.5.1', computers: 4 },
  { name: 'Urban VPN Proxy', vendor: 'Urban Cyber Security Inc.', kind: 'extension', l1: 'Proxy and tunnel', l2: 'Consumer VPN and proxy services', version: '5.11.2', computers: 5 },
  { name: 'wireguard-tools', vendor: '', kind: 'package', extId: 'wireguard-tools', l1: 'Proxy and tunnel', l2: 'Tunnels and mesh networks', version: '1.0.20210914', computers: 3 },
  { name: 'Tor Browser', vendor: 'The Tor Project', kind: 'program', l1: 'Proxy and tunnel', l2: 'Anonymizers', version: '14.0', computers: 1 },
  { name: 'qBittorrent', vendor: 'The qBittorrent project', kind: 'program', l1: 'P2P', l2: 'Torrent clients', version: '4.6.5', computers: 2 },
  { name: 'Keeper® Password Manager & Digital Vault', vendor: 'Keeper Security', kind: 'extension', extId: 'bfogiafebfohielmmehodmfbbebbbpei', l1: 'Security and identity', l2: 'Password managers', version: '17.9.0', computers: 31 },
  { name: 'Bitwarden Password Manager', vendor: 'Bitwarden Inc.', kind: 'extension', extId: 'nngceckbapebfimnlniiiahkandclblb', l1: 'Security and identity', l2: 'Password managers', version: '2024.10.1', computers: 48 },
  { name: 'Advanced IP Scanner', vendor: 'Famatech Corp.', kind: 'program', l1: 'Security and identity', l2: 'Security testing tools', version: '2.5.4594', computers: 6 },
  { name: 'Visual Studio Code', vendor: 'Microsoft Corporation', kind: 'program', l1: 'Developer tools', l2: 'IDEs and editors', version: '1.95.1', computers: 66 },
  { name: 'typescript', vendor: 'Microsoft Corp.', kind: 'package', extId: 'typescript', l1: 'Developer tools', l2: 'Libraries and packages', version: '5.9.2', computers: 38 },
  { name: 'GitHub Copilot', vendor: 'GitHub', kind: 'ide_extension', extId: 'github.copilot', l1: 'Generative AI', l2: 'AI coding assistants', version: '1.245.0', computers: 22 },
  { name: 'Awesome Screen Recorder & Screenshot', vendor: 'Awesome Screenshot', kind: 'extension', extId: 'nlipoenfbbikpbjkfpfillcgkoblgpmj', l1: 'General business', l2: 'Screen capture and recording', version: '4.4.41', computers: 9 },
  { name: 'OBS Studio', vendor: 'OBS Project', kind: 'program', l1: 'General business', l2: 'Screen capture and recording', version: '30.2.3', computers: 7 },
  { name: 'Gmail', vendor: 'Google', kind: 'extension', extId: 'pjkljhegncpnkpknbcohdijeoejaedia', l1: 'General internet', l2: 'Legacy Chrome apps', version: '8.2', computers: 14 },
  { name: 'YouTube', vendor: 'Google', kind: 'extension', extId: 'blpcfgokakmgnkcojhhkbfbldkacnbeo', l1: 'General internet', l2: 'Legacy Chrome apps', version: '4.2.8', computers: 9 },
  { name: 'Momentum', vendor: 'Momentum Dash', kind: 'extension', extId: 'laookkfknpbbblfpciffpaejjkokdgca', l1: 'General internet', l2: 'Browser utilities', version: '2.26.6', computers: 8 },
  { name: 'Spotify', vendor: 'Spotify AB', kind: 'program', l1: 'Streaming media', l2: 'Music and podcasts', version: '1.2.48.405', computers: 74 },
  { name: 'Player do NOW NET Claro', vendor: 'Claro', kind: 'extension', extId: 'npflpmeannakjekldamofnldpiefjmmi', l1: 'Other', l2: 'Other', version: '1.9.3.43', computers: 6 },
  { name: 'Add to Amazon Wish List', vendor: 'Amazon', kind: 'extension', extId: 'ciagpekplgpbepdgggflgmahnjgiaced', l1: 'E-commerce', l2: 'Shopping assistants', version: '1.0.0.11', computers: 7 },
  { name: 'Ollama', vendor: 'Ollama', kind: 'program', l1: 'Generative AI', l2: 'Local AI runtimes', version: '0.4.1', computers: 2 },
  { name: 'Parsec', vendor: 'Parsec Cloud, Inc.', kind: 'program', l1: 'Unclassified', l2: 'Not in the dictionary yet', version: '150-97', computers: 3 }
];

/* Published policy (version 13). tTitles / tComputers are tenant-wide counts from title_summary. */
var PC_ALL_KINDS = ['program', 'extension', 'ide_extension', 'package'];
var PC_RULES = [
  { id: 'r1', name: 'Operating system, drivers and runtimes', cls: 'core', match: 'all', enabled: true, kinds: PC_ALL_KINDS,
    conds: [{ f: 'category', op: 'equals', v: 'System applications' }],
    owner: 'IT Operations', purpose: 'Components required by Windows, macOS, Linux and the browsers.', tTitles: 401, tComputers: 412 },
  { id: 'r2', name: 'Sophos agents', cls: 'core', match: 'all', enabled: true, kinds: PC_ALL_KINDS,
    conds: [{ f: 'category', op: 'equals', v: 'Sophos applications' }],
    owner: 'Security team', purpose: 'Endpoint protection and ZTNA agents.', tTitles: 11, tComputers: 412 },
  { id: 'r3', name: 'Unsupported Acrobat and Reader', cls: 'unsanctioned', match: 'all', enabled: true, kinds: ['program'],
    conds: [{ f: 'vendor', op: 'contains', v: 'Adobe' }, { f: 'name', op: 'regex', v: 'Acrobat|Reader' }, { f: 'version', op: 'lt', v: '24' }],
    owner: 'Security team', purpose: 'Versions out of vendor support (CIS 2.2). Update or remove.', tTitles: 4, tComputers: 19 },
  { id: 'r4', name: 'Approved business suite', cls: 'sanctioned', match: 'all', enabled: true, kinds: ['program', 'extension'],
    conds: [{ f: 'category', op: 'in', vs: ['General business', 'Conferencing', 'Instant messenger', 'General internet'] },
            { f: 'vendor', op: 'in', vs: ['Microsoft Corporation', 'Adobe', 'Zoom Video Communications, Inc.', 'Cisco Systems', 'Slack Technologies', 'Google LLC'] }],
    owner: 'IT Operations', purpose: 'Office, PDF, meetings, chat and the standard browser.', tTitles: 291, tComputers: 408 },
  { id: 'r5', name: 'Approved remote support', cls: 'tolerated', match: 'all', enabled: true, kinds: ['program', 'package'],
    conds: [{ f: 'subcategory', op: 'equals', v: 'Remote desktop and support' }, { f: 'name', op: 'regex', v: '^(AnyDesk|TeamViewer)$' }, { f: 'version', op: 'gte', v: '9.0' }],
    owner: 'IT Service Desk', purpose: 'Vendor support sessions for line-of-business systems.',
    controls: 'Unattended access disabled; sessions logged; access only from the support VLAN.', riskBy: 'CISO', review: '2026-11-15', tTitles: 3, tComputers: 30 },
  { id: 'r6', name: 'Corporate VPN and password managers', cls: 'sanctioned', match: 'any', enabled: true, kinds: ['program', 'extension'],
    conds: [{ f: 'subcategory', op: 'equals', v: 'Corporate VPN clients' }, { f: 'extid', op: 'in', v: 'bfogiafebfohielmmehodmfbbebbbpei, nngceckbapebfimnlniiiahkandclblb' }],
    owner: 'Security team', purpose: 'Remote access through the corporate VPN; Keeper and Bitwarden are the approved vaults.', tTitles: 24, tComputers: 75 },
  { id: 'r7', name: 'Developer tools', cls: 'sanctioned', match: 'all', enabled: true, kinds: ['program', 'ide_extension', 'package'],
    conds: [{ f: 'category', op: 'equals', v: 'Developer tools' }],
    owner: 'Engineering', purpose: 'IDEs, runtimes, CLIs and libraries used by the engineering teams.', tTitles: 256, tComputers: 92 },
  { id: 'r8', name: 'Legacy Chrome apps', cls: 'tolerated', match: 'all', enabled: true, kinds: ['extension'],
    conds: [{ f: 'subcategory', op: 'equals', v: 'Legacy Chrome apps' }],
    owner: 'Workplace team', purpose: 'Removal scheduled with the Chrome policy rollout.',
    controls: 'No permissions beyond the Google domains; removed by policy on next Chrome update.', riskBy: 'IT Manager', review: '2026-10-15', tTitles: 6, tComputers: 14 },
  { id: 'r9', name: 'Screen capture and AI tools under review', cls: 'tolerated', match: 'any', enabled: true, kinds: PC_ALL_KINDS,
    conds: [{ f: 'subcategory', op: 'in', vs: ['Screen capture and recording', 'AI assistants', 'AI browser extensions'] }],
    owner: 'Security team', purpose: 'Waiting for the acceptable-use policy on recording and AI tools.',
    controls: 'DLP watches uploads from these tools; users acknowledged the interim rules.', riskBy: 'CISO', review: '2026-11-30', tTitles: 54, tComputers: 41 },
  { id: 'r10', name: 'Anonymizers, P2P and unwanted software', cls: 'unsanctioned', match: 'any', enabled: true, kinds: PC_ALL_KINDS,
    conds: [{ f: 'subcategory', op: 'in', vs: ['Anonymizers', 'Torrent clients', 'Other P2P networks'] }, { f: 'category', op: 'equals', v: 'Unwanted software' }],
    owner: 'Security team', purpose: 'Never allowed on enterprise assets.', tTitles: 9, tComputers: 3 },
  { id: 'r11', name: 'Consumer VPN, tunnels and other remote access', cls: 'unsanctioned', match: 'any', enabled: true, kinds: PC_ALL_KINDS,
    conds: [{ f: 'subcategory', op: 'in', vs: ['Consumer VPN and proxy services', 'Tunnels and mesh networks'] }, { f: 'subcategory', op: 'equals', v: 'Remote desktop and support' }],
    owner: 'Security team', purpose: 'Anything that opens a path around the firewall, except the tools in rule 5.', tTitles: 46, tComputers: 22 },
  { id: 'r12', name: 'Local AI runtimes', cls: 'unsanctioned', match: 'all', enabled: false, kinds: ['program', 'package'],
    conds: [{ f: 'subcategory', op: 'equals', v: 'Local AI runtimes' }],
    owner: 'Security team', purpose: 'Draft: waiting for the AI policy.', tTitles: 0, tComputers: 0 }
];
var PC_DEFAULT = 'unsanctioned';
var PC_DEFAULT_COUNTS = { tTitles: 179, tComputers: 286 };
var PC_TODAY = '2026-10-24';
