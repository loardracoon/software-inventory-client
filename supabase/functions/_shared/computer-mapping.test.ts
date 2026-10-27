import { describe, expect, it } from "vitest";
import { hostOf, mapEndpoint, mapEndpoints, mapPlatform, mapTenant } from "./computer-mapping.ts";

describe("mapEndpoint", () => {
  it("maps the fields the inventory keeps", () => {
    expect(
      mapEndpoint({
        id: "e1",
        type: "computer",
        hostname: " LAB-PC-01 ",
        health: { overall: "good" },
        os: { platform: "windows", name: "Windows 11 Enterprise", majorVersion: 10, minorVersion: 0, build: 22631 },
        associatedPerson: { name: "Alice Doe", viaLogin: "CORP\\alice" },
        lastSeenAt: "2026-10-26T12:00:00Z",
      }),
    ).toEqual({
      sophos_endpoint_id: "e1",
      hostname: "LAB-PC-01",
      platform: "windows",
      endpoint_type: "computer",
      os_name: "Windows 11 Enterprise",
      os_version: "10.0",
      os_build: "22631",
      associated_user: "CORP\\alice",
      health: "good",
      last_seen_at: "2026-10-26T12:00:00Z",
    });
  });

  it("falls back for missing values", () => {
    expect(mapEndpoint({ id: "e2", os: { platform: "macOS" }, associatedPerson: { name: "Bob" } })).toMatchObject({
      hostname: "e2",
      platform: "macos",
      endpoint_type: null,
      os_version: null,
      os_build: null,
      associated_user: "Bob",
      health: null,
    });
  });

  it("skips endpoints without an ID or with an unknown platform", () => {
    expect(mapEndpoint({ os: { platform: "windows" } })).toBeNull();
    expect(mapEndpoint({ id: "e3", os: { platform: "android" } })).toBeNull();
    expect(mapPlatform("Linux")).toBe("linux");
  });
});

describe("mapEndpoints", () => {
  it("drops duplicates and counts what it skipped", () => {
    const { rows, skipped } = mapEndpoints([
      { id: "e1", os: { platform: "linux" } },
      { id: "e1", os: { platform: "linux" } },
      { id: "e2", os: { platform: "unknown" } },
      { id: "e3", os: { platform: "windows" } },
    ]);
    expect(rows.map((r) => r.sophos_endpoint_id)).toEqual(["e1", "e3"]);
    expect(skipped).toBe(2);
  });
});

describe("tenants", () => {
  it("keeps the API host and the credential type", () => {
    expect(mapTenant({ id: "t1", name: "Acme", apiHost: "https://api-us01.central.sophos.com" }, "partner")).toEqual({
      sophos_tenant_id: "t1",
      name: "Acme",
      id_type: "partner",
      data_region_host: "https://api-us01.central.sophos.com",
    });
    expect(hostOf("https://api-us01.central.sophos.com")).toBe("api-us01.central.sophos.com");
    expect(hostOf("not a url")).toBeNull();
  });
});
