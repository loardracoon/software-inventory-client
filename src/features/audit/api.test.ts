import { describe, expect, it, vi } from "vitest";
import { AUDIT_PAGE, collectAuditPages, fetchAuditLog, type AuditRow } from "./api";

// Server rows 502..1; the fake query applies order, lt and limit like PostgREST and records what it receives.
const ids = Array.from({ length: 502 }, (_, i) => 502 - i);
const calls: { order: unknown[][]; lt: unknown[][] } = { order: [], lt: [] };
vi.mock("@/lib/supabase-query", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase-query")>()),
  db: () => ({
    rpc: () => {
      let desc = false;
      let before = Infinity;
      const query = {
        order: (col: string, opts: { ascending: boolean }) => (calls.order.push([col, opts]), (desc = col === "id" && !opts.ascending), query),
        lt: (col: string, value: number) => (calls.lt.push([col, value]), (before = value), query),
        limit: async (n: number) => ({
          data: (desc ? ids : [...ids].reverse()).filter((id) => id < before).slice(0, n).map((id) => ({ id }) as AuditRow),
          error: null,
        }),
      };
      return query;
    },
  }),
}));

describe("audit log keyset paging", () => {
  it("orders by id descending and moves the cursor to the last id of each page", async () => {
    const rows = await collectAuditPages((before) => fetchAuditLog("", "", AUDIT_PAGE, before));
    expect(rows.map((r) => r.id)).toEqual([...ids].reverse());
    expect(calls.order).toEqual([["id", { ascending: false }], ["id", { ascending: false }]]);
    expect(calls.lt).toEqual([["id", 3]]);
  });
});
