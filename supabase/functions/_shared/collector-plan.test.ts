import { describe, expect, it } from "vitest";
import { chunk, decideEndpoint, rowsByEndpoint, runName, runPastGrace } from "./collector-plan.ts";
import type { EndpointRunState } from "./query-provider.ts";

const state = (status: EndpointRunState["status"], result: EndpointRunState["result"], statusMessage: string | null = null): EndpointRunState => ({
  endpointId: "e1",
  status,
  result,
  resultCount: null,
  statusMessage,
});

describe("decideEndpoint", () => {
  it("collects finished successes and waits for the rest", () => {
    expect(decideEndpoint(state("finished", "succeeded"))).toEqual({ action: "collect" });
    expect(decideEndpoint(state("started", "notAvailable"))).toEqual({ action: "wait" });
    expect(decideEndpoint(state("pending", "notAvailable"))).toEqual({ action: "wait" });
  });

  it("turns query failures into errors and timeouts into no response", () => {
    expect(decideEndpoint(state("finished", "failed", "no such table: vscode_extensions"))).toEqual({
      action: "error",
      message: "no such table: vscode_extensions",
    });
    expect(decideEndpoint(state("finished", "timedOut")).action).toBe("no_response");
  });
});

describe("runPastGrace", () => {
  it("compares the run age with the grace time", () => {
    const started = "2026-10-26T12:00:00Z";
    expect(runPastGrace(started, 10, Date.parse("2026-10-26T12:09:59Z"))).toBe(false);
    expect(runPastGrace(started, 10, Date.parse("2026-10-26T12:10:01Z"))).toBe(true);
  });
});

describe("helpers", () => {
  it("splits batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 50)).toEqual([]);
    expect(() => chunk([1], 0)).toThrow();
  });

  it("groups result rows by endpoint and drops rows without one", () => {
    const grouped = rowsByEndpoint([
      { endpointId: "e1", columns: { name: "a" } },
      { endpointId: "e2", columns: { name: "b" } },
      { endpointId: "e1", columns: { name: "c" } },
      { endpointId: null, columns: { name: "x" } },
    ]);
    expect(Object.fromEntries(grouped)).toEqual({ e1: [{ name: "a" }, { name: "c" }], e2: [{ name: "b" }] });
  });

  it("names runs with the query version", () => {
    expect(runName("inv.programs.deb", 1)).toBe("inv.programs.deb.v1");
  });
});
