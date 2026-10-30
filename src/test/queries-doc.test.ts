// docs/queries.md must say what the app really runs: every SQL of the query catalog (version 1 migration), the
// capability probe, and the number of catalog rows. Change the document and the catalog together.
import { describe, expect, it } from "vitest";
import { PROBE_QUERY } from "../../supabase/functions/_shared/capability-probe";
// ?raw gives the file text (Vite), so this test needs no Node types.
import migrationRaw from "../../supabase/migrations/20261026220000_query_catalog_v1.sql?raw";
import docRaw from "../../docs/queries.md?raw";

const squash = (sql: string) => sql.replace(/\s+/g, " ").trim();

const migration = migrationRaw.replace(/\r\n/g, "\n");
const doc = docRaw.replace(/\r\n/g, "\n");

// Rows of the catalog: ('domain', 'platform', 1, 'name', '{tables}', $q$ SQL $q$)
const rows = [...migration.matchAll(/\('(\w+)', '(\w+)', 1, '([\w.]+)', '\{([^}]*)\}', \$q\$([\s\S]*?)\$q\$\)/g)].map((m) => ({
  domain: m[1],
  platform: m[2],
  name: m[3],
  tables: m[4].split(",").filter(Boolean),
  sql: squash(m[5]),
}));

// The SQL blocks of the document, without the language fence.
const docSql = [...doc.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => squash(m[1]));

describe("docs/queries.md", () => {
  it("reads every row of the catalog", () => {
    expect(rows).toHaveLength(19);
    expect(rows.filter((r) => r.platform === "windows")).toHaveLength(6);
    expect(rows.filter((r) => r.platform === "macos")).toHaveLength(6);
    expect(rows.filter((r) => r.platform === "linux")).toHaveLength(7);
    expect(doc).toContain("The catalog has **19 rows** (6 for Windows, 6 for macOS, 7 for Linux)");
  });

  it("contains the SQL of every catalog query, exactly", () => {
    const missing = rows.filter((r) => !docSql.includes(r.sql)).map((r) => `${r.name} (${r.platform})`);
    expect(missing).toEqual([]);
  });

  it("does not contain SQL that is not in the catalog", () => {
    const known = new Set([...rows.map((r) => r.sql), squash(PROBE_QUERY.sql)]);
    expect(docSql.filter((s) => !known.has(s))).toEqual([]);
  });

  it("contains the capability probe query", () => {
    expect(docSql).toContain(squash(PROBE_QUERY.sql));
    expect(doc).toContain(`\`${PROBE_QUERY.name}\``);
  });

  it("names every query and lists the tables each one needs", () => {
    for (const name of new Set(rows.map((r) => r.name))) expect(doc).toContain(`\`${name}\``);
    for (const r of rows) for (const table of r.tables) expect(doc).toContain(`\`${table}\``);
  });
});
