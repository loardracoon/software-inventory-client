import { describe, expect, it } from "vitest";
import { uncertainReason } from "./title-vulns-card";

describe("uncertainReason", () => {
  it("names the CVE data when the installed version is known", () => {
    expect(uncertainReason({ versions: ["26.195.1006.0007"] })).toBe("the CVE data names no affected version");
  });
  it("names the installation when it reports no version", () => {
    expect(uncertainReason({ versions: [""] })).toBe("the installed version is unknown");
  });
});
