import { describe, expect, it, vi } from "vitest";
import { fetchScopeTags } from "./api";

const rpc = vi.fn(async () => ({ data: ["pci", "sox"], error: null }));
vi.mock("@/lib/supabase-query", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase-query")>()),
  db: () => ({ rpc }),
}));

describe("fetchScopeTags", () => {
  it("reads the distinct tags from SQL, not from the first 1,000 computer rows", async () => {
    expect(await fetchScopeTags("t1")).toEqual(["pci", "sox"]);
    expect(rpc).toHaveBeenCalledWith("scope_tags_in_use", { p_tenant_id: "t1" });
  });
});
