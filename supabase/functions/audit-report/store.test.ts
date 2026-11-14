import { describe, expect, it, vi } from "vitest";
import { storeReport } from "./store.ts";

const args = { p_tenant_id: "t", p_archive: "\\x504b" };

describe("storeReport", () => {
  it("with INTERNAL_REST_URL: calls PostgREST directly with the service role key", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify("id-1"), { status: 200 }));
    const rpc = vi.fn();
    const result = await storeReport(args, { restUrl: "http://rest:3000/", serviceKey: "svc", rpc, fetch });
    expect(result).toEqual({ data: "id-1", error: null });
    expect(rpc).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith("http://rest:3000/rpc/record_audit_report", {
      method: "POST",
      headers: { apikey: "svc", Authorization: "Bearer svc", "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  });

  it("with INTERNAL_REST_URL: returns the PostgREST error code and message", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ code: "23514", message: "check" }), { status: 400 }));
    expect(await storeReport(args, { restUrl: "http://rest:3000", serviceKey: "svc", rpc: vi.fn(), fetch })).toEqual({
      data: null,
      error: { code: "23514", message: "check" },
    });
  });

  it("without INTERNAL_REST_URL: uses the supabase-js call", async () => {
    const fetch = vi.fn();
    const rpc = vi.fn(async () => ({ data: "id-2", error: null }));
    expect(await storeReport(args, { restUrl: undefined, serviceKey: "svc", rpc, fetch })).toEqual({ data: "id-2", error: null });
    expect(rpc).toHaveBeenCalledWith(args);
    expect(fetch).not.toHaveBeenCalled();
  });
});
