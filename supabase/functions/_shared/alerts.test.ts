import { describe, expect, it, vi } from "vitest";
import { deliverAlert, emailPayload, webhookPayload, type Alert, type Channels } from "./alerts.ts";

const alert: Alert = {
  id: 7,
  kind: "coverage_low",
  title: "Coverage 50% in Acme Ltd",
  body: "The scan cycle of Acme Ltd closed at 50% coverage (threshold 90%).",
  data: { coverage_pct: 50 },
  created_at: "2026-10-27T10:00:00Z",
  tenant_name: "Acme Ltd",
};

const WEBHOOK = "https://hooks.example.com/services/T000/B000/secret-token";
const KEY = "re_secret_key_123456";
const channels: Channels = { webhookUrl: WEBHOOK, resendKey: KEY, emailFrom: "alerts@example.com", emailTo: ["ops@example.com"] };

describe("alert payloads", () => {
  it("puts the message in `text` for Teams and Slack", () => {
    expect(webhookPayload(alert)).toMatchObject({ text: expect.stringContaining("Acme Ltd: Coverage 50% in Acme Ltd"), kind: "coverage_low" });
    expect(emailPayload(alert, "alerts@example.com", ["ops@example.com"])).toMatchObject({
      subject: "[Endpoint Inventory] Coverage 50% in Acme Ltd",
      to: ["ops@example.com"],
    });
  });
});

describe("deliverAlert", () => {
  it("posts to the webhook and to Resend with the key as Bearer", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    });
    expect(await deliverAlert(alert, channels, { fetchFn, resendUrl: "http://mock/emails" })).toEqual([]);
    expect(calls.map((c) => c.url)).toEqual([WEBHOOK, "http://mock/emails"]);
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
  });

  it("reports failures per channel without the webhook URL or the key", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url === WEBHOOK) throw new TypeError(`connect failed to ${WEBHOOK}`);
      return new Response("{}", { status: 403 });
    });
    const errors = await deliverAlert(alert, channels, { fetchFn, sleep: async () => {} });
    expect(errors).toEqual(["webhook: TypeError", "email: HTTP 403"]);
    expect(errors.join(" ")).not.toContain("secret-token");
    expect(errors.join(" ")).not.toContain(KEY);
  });

  it("skips email until sender, recipients and key are all set", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    await deliverAlert(alert, { ...channels, webhookUrl: null, emailTo: [] }, { fetchFn });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
