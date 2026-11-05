import { describe, expect, it, vi } from "vitest";
import {
  CONSENT_VERSION,
  enrollmentHubUrl,
  hubCall,
  newClientKey,
  nextCheckDelayMs,
  readStatus,
  requestBody,
  SOPHIZO_HUB_URL,
  sha256Hex,
  validateForm,
} from "./hub-enroll.ts";

const form = { name: "ACME inventory", organization: "ACME", contact_email: "it@acme.example", reason: null };

describe("access request to the Sophizo Hub", () => {
  it("makes a 256-bit key in the Hub's format", () => {
    const key = newClientKey();
    expect(key).toMatch(/^hubk_[0-9a-f]{64}$/);
    expect(newClientKey()).not.toBe(key);
  });

  it("sends the hash and the first 11 characters, never the key or inventory data", async () => {
    const key = newClientKey();
    const body = requestBody(form, await sha256Hex(key), key, "1.0");
    expect(Object.keys(body).sort()).toEqual(
      ["action", "client_version", "consent_version", "contact_email", "key_hash", "key_prefix", "name", "organization", "reason"].sort(),
    );
    expect(JSON.stringify(body)).not.toContain(key.slice(11));
    expect(body.key_prefix).toBe(key.slice(0, 11));
    expect(body.key_hash).toBe(await sha256Hex(key));
    expect(body.consent_version).toBe(CONSENT_VERSION);
  });

  it("needs the consent to the current text", () => {
    const base = { name: "ACME", contact_email: "IT@Acme.example", consent: true, consent_version: CONSENT_VERSION };
    expect(validateForm(base).contact_email).toBe("it@acme.example");
    expect(() => validateForm({ ...base, consent: false })).toThrow(/third-party AI/);
    expect(() => validateForm({ ...base, consent_version: "2020-01-01" })).toThrow(/third-party AI/);
    expect(() => validateForm({ ...base, contact_email: "nope" })).toThrow(/valid contact email/);
    expect(validateForm({ ...base, name: "ACME\r\nBcc: x@evil.example" }).name).toBe("ACME Bcc: x@evil.example");
  });

  it("asks the Sophizo Hub; only the server env can point elsewhere (tests)", () => {
    expect(enrollmentHubUrl(() => undefined)).toBe(SOPHIZO_HUB_URL);
    expect(enrollmentHubUrl((n) => (n === "ENROLLMENT_HUB_URL" ? "http://host.docker.internal:57321/" : undefined))).toBe("http://host.docker.internal:57321");
  });

  it("checks often at first, then less", () => {
    const now = Date.parse("2026-11-04T12:00:00Z");
    expect(nextCheckDelayMs("2026-11-04T11:30:00Z", now)).toBe(5 * 60_000);
    expect(nextCheckDelayMs("2026-11-04T06:00:00Z", now)).toBe(15 * 60_000);
    expect(nextCheckDelayMs("2026-11-01T12:00:00Z", now)).toBe(60 * 60_000);
  });

  it("never follows a redirect, and reads the status with the key", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ status: "pending" }), { status: 200 }));
    expect(await readStatus(fetchFn, "https://mcs.sophizo.com.br", "hubk_x")).toEqual({ status: "pending" });
    expect(fetchFn).toHaveBeenCalledWith("https://mcs.sophizo.com.br/functions/v1/client-enrollments", expect.objectContaining({ redirect: "error" }));
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer hubk_x");
    await hubCall(fetchFn, "https://x", { method: "POST" });
    expect(fetchFn).toHaveBeenLastCalledWith("https://x", { method: "POST", redirect: "error" });
  });

  it("a request the Hub does not know is unknown", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ status: "unknown" }), { status: 404 }));
    expect((await readStatus(fetchFn, "https://h", "hubk_x")).status).toBe("unknown");
  });
});
