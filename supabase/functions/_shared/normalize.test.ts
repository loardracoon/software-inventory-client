import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  browserFromPath,
  compareVersions,
  hashItems,
  normalize,
  normalizeDisks,
  normalizeExtensions,
  normalizeHardware,
  normalizeIdeExtensions,
  normalizePackages,
  normalizePrograms,
  productName,
  profileFromPath,
  userFromPath,
  type RawRow,
} from "./normalize.ts";

// Minimal RFC 4180 parser for the fixture (quoted fields with commas and doubled quotes).
function parseCsv(text: string): RawRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    if (row.length > 1) rows.push(row);
  }
  const [header, ...data] = rows;
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const fixture = parseCsv(readFileSync("fixtures/extensions_lab-pc01.csv", "utf8"));
const W = "C:\\Users\\user01\\AppData\\Local";

describe("path helpers", () => {
  it("derive browser, profile and user", () => {
    expect(browserFromPath(`${W}\\Google\\Chrome\\User Data\\Default\\Extensions\\abc\\1.0_0`)).toBe("chrome");
    expect(browserFromPath(`${W}\\Microsoft\\Edge\\User Data\\Profile 1\\Extensions\\abc\\1.0_0`)).toBe("edge");
    expect(browserFromPath("/Users/ana/Library/Application Support/BraveSoftware/Brave-Browser/Default/Extensions/x/1")).toBe("brave");
    expect(profileFromPath(`${W}\\Microsoft\\Edge\\User Data\\Profile 1\\Extensions\\abc\\1.0_0`)).toBe("Profile 1");
    expect(profileFromPath("/home/bob/.mozilla/firefox/k2.default-release/extensions/x@y.xpi")).toBe("k2.default-release");
    expect(userFromPath("C:\\Users\\Administrator\\AppData")).toBe("administrator");
    expect(userFromPath("/home/bob/.vscode")).toBe("bob");
    expect(userFromPath("C:\\Program Files\\x")).toBeNull();
  });

  it("compares dot-separated versions numerically", () => {
    expect(compareVersions("10.0.1", "9.9.9")).toBeGreaterThan(0);
    expect(compareVersions("4.4.41_1", "4.4.41_0")).toBeGreaterThan(0);
    expect(compareVersions(null, "1")).toBeLessThan(0);
  });
});

describe("extensions with the LAB-PC01 fixture", () => {
  const items = normalizeExtensions(fixture);

  it("matches the counts of the real export", () => {
    expect(fixture).toHaveLength(72);
    expect(new Set(fixture.map((r) => r.path)).size).toBe(57);
    expect(items).toHaveLength(48);
    expect(new Set(items.map((i) => i.title.match_key)).size).toBe(23);
  });

  it("keeps the highest version folder and lists the others as stale", () => {
    const withStale = items.filter((i) => Array.isArray(i.attrs.stale_folders));
    expect(withStale).toHaveLength(6);
    for (const item of withStale) {
      for (const folder of item.attrs.stale_folders as string[]) {
        expect(compareVersions(item.version, folder.split("\\").at(-1)!) >= 0 || item.path! > folder).toBe(true);
      }
    }
  });

  it("derives browser and profile from the path and the user when username is empty", () => {
    expect(new Set(items.map((i) => i.title.source))).toEqual(new Set(["chrome", "edge"]));
    expect(new Set(items.map((i) => i.attrs.profile))).toEqual(new Set(["Default", "Profile 1"]));
    for (const item of items) {
      expect(item.username).toBeTruthy();
      expect(item.scope_key.startsWith(item.username!.toLowerCase())).toBe(true);
      expect(JSON.stringify(item.attrs)).not.toMatch(/"username"/);
    }
  });

  it("uses the extension ID as match key and external ID", () => {
    const remote = items.find((i) => i.title.match_key === "inomeogfingihgjfjlpeplalcfajhgai");
    expect(remote?.title.external_id).toBe("inomeogfingihgjfjlpeplalcfajhgai");
    expect(remote?.title.kind).toBe("extension");
  });

  it("prefers browser_type and profile from the v1 query when present", () => {
    const [item] = normalizeExtensions([
      { username: "ana", browser_type: "Brave", profile: "Work", identifier: "id1", name: "X", version: "1.0", path: "C:\\x\\Extensions\\id1\\1.0_0" },
    ]);
    expect([item.title.source, item.scope_key]).toEqual(["brave", "ana|Work"]);
  });
});

describe("programs", () => {
  it("keys by name and publisher and keeps the highest duplicate", () => {
    const items = normalizePrograms(
      [
        { name: "7-Zip 23.01 (x64)", version: "23.01", publisher: "Igor Pavlov", install_location: "C:\\Program Files\\7-Zip\\" },
        { name: " Git ", version: "2.44.0", publisher: "The Git Development Community" },
        { name: "git", version: "2.45.1", publisher: "the git development community" },
        { name: "", version: "1" },
      ],
      "windows",
      "inv.programs",
    );
    expect(items.map((i) => [i.title.source, i.title.match_key, i.version])).toEqual([
      ["programs", "7-zip 23.01 (x64)|igor pavlov", "23.01"],
      ["programs", "git|the git development community", "2.45.1"],
    ]);
    expect(items[1].attrs.duplicates).toBe(2);
  });

  it("names the source by platform and query", () => {
    const row = [{ name: "curl", version: "8.5.0", publisher: "Ubuntu" }];
    expect(normalizePrograms(row, "macos", "inv.programs")[0].title.source).toBe("apps");
    expect(normalizePrograms(row, "linux", "inv.programs.deb")[0].title.source).toBe("deb");
    expect(normalizePrograms(row, "linux", "inv.programs.rpm")[0].title.source).toBe("rpm");
  });

  const gitRow = { name: "Git", version: "2.45.1", publisher: "The Git Development Community", install_location: "C:\\Program Files\\Git\\", install_date: "20240301", identifying_number: "Git_is1" };

  it("keeps v1 row hashes exactly as stored before v2 existed", async () => {
    // Written by the Phase 5 code to the end-to-end stack (ACME-PC-01, Git 2.45.1).
    const [item] = (await hashItems(normalize("programs", "windows", "inv.programs", [gitRow]))).items;
    expect(item.row_hash).toBe("679d38a0dae41e85d5eea63f745f01a8857016884f018bfc80bb90d7c0d09a51");
    expect((await hashItems(normalize("programs", "windows", "inv.programs", [gitRow], 1))).items[0].row_hash).toBe(item.row_hash);
  });

  it("v2 keys one product whatever version or architecture is in its name", () => {
    const items = normalizePrograms(
      [
        { name: "7-Zip 23.01 (x64)", version: "23.01", publisher: "Igor Pavlov" },
        { name: "7-Zip 24.08 (x64)", version: "24.08", publisher: "Igor Pavlov" },
        gitRow,
      ],
      "windows",
      "inv.programs",
      2,
    );
    expect(items.map((i) => [i.title.match_key, i.title.canonical_name, i.version])).toEqual([
      ["7-zip|igor pavlov", "7-Zip", "24.08"],
      ["git|the git development community", "Git", "2.45.1"],
    ]);
  });
});

describe("productName", () => {
  it.each([
    ["7-Zip 23.01 (x64)", "7-Zip"],
    ["Notepad++ 8.6.4 (64-bit x64)", "Notepad++"],
    ["Notepad++ (64-bit x64)", "Notepad++"],
    ["Python 3.12.1 (64-bit)", "Python"],
    ["Microsoft Visual C++ 2015-2022 Redistributable (x64) - 14.38.33135", "Microsoft Visual C++ 2015-2022 Redistributable"],
    ["Mozilla Firefox (x64 en-US)", "Mozilla Firefox (x64 en-US)"],
    ["VLC media player v3.0.20", "VLC media player"],
    ["Java 8 Update 401", "Java 8 Update 401"],
    ["python3.12", "python3.12"],
    ["7-Zip", "7-Zip"],
    ["1.2.3", "1.2.3"],
  ])("%s → %s", (name, expected) => {
    expect(productName(name)).toBe(expected);
  });
});

describe("IDE extensions and packages", () => {
  it("keys IDE extensions by user, publisher and name", () => {
    const items = normalizeIdeExtensions([
      { username: "Ana", publisher: "ms-python", name: "python", version: "2024.2.0", path: "/home/ana/.vscode/extensions/ms-python.python-2024.2.0" },
      { username: "Ana", publisher: "ms-python", name: "python", version: "2024.4.0", path: "/home/ana/.vscode/extensions/ms-python.python-2024.4.0" },
    ]);
    expect(items).toHaveLength(1);
    expect([items[0].title.match_key, items[0].scope_key, items[0].version, items[0].username]).toEqual(["ms-python.python", "ana", "2024.4.0", "Ana"]);
  });

  it("keys packages by manager, name and path", () => {
    const items = normalizePackages([
      { manager: "npm", name: "TypeScript", version: "5.4.5", path: "C:\\npm\\typescript" },
      { manager: "npm", name: "typescript", version: "5.6.2", path: "C:\\other\\typescript" },
      { manager: "pip", name: "requests", version: "2.32.3", vendor: "Kenneth Reitz", path: "/usr/lib/python3/requests" },
    ]);
    expect(items.map((i) => [i.title.source, i.title.match_key, i.scope_key])).toEqual([
      ["npm", "typescript", "C:\\npm\\typescript"],
      ["npm", "typescript", "C:\\other\\typescript"],
      ["pip", "requests", "/usr/lib/python3/requests"],
    ]);
  });
});

describe("hardware and disks", () => {
  it("keeps one hardware item and tracks every attribute", () => {
    const [item] = normalizeHardware([{ hostname: "PC-1", physical_memory: "17179869184", cpu_brand: "Intel" }]);
    expect(item.item_key).toBe("");
    expect(item.attrs).toEqual({ cpu_brand: "Intel", hostname: "PC-1", physical_memory: "17179869184" });
  });

  it("does not version disks when only free space changes", async () => {
    const disk = (free: string) => normalizeDisks([{ device_id: "C:", type: "Fixed", file_system: "NTFS", size: "512", free_space: free, boot_partition: "1" }]);
    const a = await hashItems({ kind: "hardware", items: disk("100") });
    const b = await hashItems({ kind: "hardware", items: disk("90") });
    expect(a.items[0].row_hash).toBe(b.items[0].row_hash);
    expect(b.items[0].attrs).toMatchObject({ free_space: "90" });
  });
});

describe("hashItems", () => {
  it("is stable when the rows come in another order and changes with the version", async () => {
    const rows: RawRow[] = [
      { manager: "npm", name: "a", version: "1.0.0", path: "/a" },
      { manager: "npm", name: "b", version: "2.0.0", path: "/b" },
    ];
    const one = await hashItems(normalize("packages", "linux", "inv.packages", rows));
    const two = await hashItems(normalize("packages", "linux", "inv.packages", [...rows].reverse()));
    const three = await hashItems(normalize("packages", "linux", "inv.packages", [{ ...rows[0], version: "1.0.1" }, rows[1]]));
    expect(one.content_hash).toBe(two.content_hash);
    expect(three.content_hash).not.toBe(one.content_hash);
    expect(one.items[0]).not.toHaveProperty("tracked");
    expect(one.items[0].row_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects unknown domains", () => {
    expect(() => normalize("users", "windows", "inv.users", [])).toThrow();
  });
});
