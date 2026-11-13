import { describe, expect, it, vi } from "vitest";
import { saveScanSettings } from "./api";

const update = vi.fn();
vi.mock("@/lib/supabase-query", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase-query")>()),
  db: () => ({ from: () => ({ update: (v: unknown) => (update(v), { eq: async () => ({ data: null, error: null }) }) }) }),
}));

describe("saveScanSettings", () => {
  it("sends the Data Lake switch", async () => {
    await saveScanSettings("t1", { data_lake_inventory: true, batch_size: 5 });
    expect(update).toHaveBeenCalledWith({ batch_size: 5, data_lake_inventory: true });
  });
});
