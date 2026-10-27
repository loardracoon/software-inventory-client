import { describe, expect, it } from "vitest";
import { decideProbe, pickProbeTargets, probeKey, tablesFromRows, type ProbeCandidate } from "./capability-probe.ts";
import type { EndpointRunState, RunState } from "./query-provider.ts";

const computers: ProbeCandidate[] = [
  { id: "c1", tenant_id: "t1", platform: "windows", sophos_endpoint_id: "e1", last_seen_at: "2026-10-26T10:00:00Z" },
  { id: "c2", tenant_id: "t1", platform: "windows", sophos_endpoint_id: "e2", last_seen_at: "2026-10-26T12:00:00Z" },
  { id: "c3", tenant_id: "t1", platform: "macos", sophos_endpoint_id: "e3", last_seen_at: null },
  { id: "c4", tenant_id: "t2", platform: "windows", sophos_endpoint_id: "e4", last_seen_at: "2026-10-25T12:00:00Z" },
];

describe("pickProbeTargets", () => {
  const allOnline = new Set(["e1", "e2", "e3", "e4"]);
  const ids = (list: ProbeCandidate[]) => list.map((c) => c.id).sort();

  it("picks the most recently seen online computer per tenant and platform", () => {
    expect(ids(pickProbeTargets(computers, new Set(), new Set(), allOnline).targets)).toEqual(["c2", "c3", "c4"]);
  });

  it("never picks an offline computer, even the most recently seen", () => {
    const { targets, noneOnline } = pickProbeTargets(computers, new Set(), new Set(), new Set(["e1"]));
    expect(ids(targets)).toEqual(["c1"]);
    expect(noneOnline.map((c) => `${c.tenant_id}:${c.platform}`).sort()).toEqual(["t1:macos", "t2:windows"]);
  });

  it("skips platforms with a running probe and computers that just failed", () => {
    const { targets } = pickProbeTargets(computers, new Set([probeKey("t2", "windows")]), new Set(["c2"]), allOnline);
    expect(ids(targets)).toEqual(["c1", "c3"]);
  });

  it("retries a failed computer when it is the only online one", () => {
    expect(ids(pickProbeTargets(computers.slice(0, 2), new Set(), new Set(["c2"]), new Set(["e2"])).targets)).toEqual(["c2"]);
  });
});

describe("decideProbe", () => {
  const started = "2026-10-26T12:00:00Z";
  const t0 = Date.parse(started);
  const running: RunState = { status: "started", result: "notAvailable", resultCount: null };
  const endpoint = (status: EndpointRunState["status"], result: EndpointRunState["result"], statusMessage: string | null = null): EndpointRunState => ({
    endpointId: "e1",
    status,
    result,
    resultCount: null,
    statusMessage,
  });

  it("collects as soon as the endpoint succeeded, before the run ends", () => {
    expect(decideProbe(running, endpoint("finished", "succeeded"), started, t0 + 30_000, 10)).toEqual({ action: "collect" });
  });

  it("waits while the endpoint has not answered", () => {
    expect(decideProbe(running, endpoint("pending", "notAvailable"), started, t0 + 60_000, 10)).toEqual({ action: "wait" });
  });

  it("gives up after the grace time", () => {
    expect(decideProbe(running, endpoint("pending", "notAvailable"), started, t0 + 11 * 60_000, 10).action).toBe("no_response");
  });

  it("reports failures and timeouts", () => {
    expect(decideProbe(running, endpoint("finished", "failed", "no such table"), started, t0, 10)).toEqual({ action: "fail", message: "no such table" });
    expect(decideProbe(running, endpoint("finished", "timedOut"), started, t0, 10).action).toBe("no_response");
  });

  it("falls back to the run status without per-endpoint status", () => {
    expect(decideProbe({ status: "finished", result: "succeeded", resultCount: 300 }, null, started, t0, 10)).toEqual({ action: "collect" });
  });
});

describe("tablesFromRows", () => {
  it("keeps unique, valid table names in order", () => {
    const rows = ["users", "programs", "users", "bad name;", "chrome_extensions"].map((name) => ({ endpointId: "e1", columns: { name } }));
    expect(tablesFromRows(rows)).toEqual(["chrome_extensions", "programs", "users"]);
  });
});
