import { describe, expect, it, vi } from "vitest";
import { fetchWithRetry, parseRetryAfter, retryDelayMs } from "./http.ts";

const noJitter = () => 0;

function responses(...statuses: (number | Error)[]) {
  const queue = [...statuses];
  return vi.fn(async () => {
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return new Response(null, { status: next, headers: next === 429 ? { "Retry-After": "3" } : {} });
  });
}

describe("parseRetryAfter", () => {
  it("reads seconds and HTTP dates", () => {
    expect(parseRetryAfter("7")).toBe(7000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
  });
});

describe("retryDelayMs", () => {
  it("backs off 1, 2, 4, 8 s with jitter up to 25%", () => {
    expect([1, 2, 3, 4, 5].map((a) => retryDelayMs(a, null, noJitter))).toEqual([1000, 2000, 4000, 8000, 8000]);
    expect(retryDelayMs(1, null, () => 0.999)).toBe(1249);
  });

  it("honours Retry-After, capped at 60 s", () => {
    expect(retryDelayMs(1, "3", noJitter)).toBe(3000);
    expect(retryDelayMs(1, "600", noJitter)).toBe(60_000);
  });
});

describe("fetchWithRetry", () => {
  it("retries 429 using Retry-After", async () => {
    const fetchFn = responses(429, 200);
    const sleep = vi.fn(async () => {});
    const response = await fetchWithRetry(fetchFn, "https://x.test/a", {}, { sleep, random: noJitter });
    expect(response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("stops after 5 tries on 5xx", async () => {
    const fetchFn = responses(503, 502, 500, 504, 503);
    const sleep = vi.fn(async () => {});
    const response = await fetchWithRetry(fetchFn, "https://x.test/a", {}, { sleep, random: noJitter });
    expect(response.status).toBe(503);
    expect(fetchFn).toHaveBeenCalledTimes(5);
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([1000, 2000, 4000, 8000]);
  });

  it("retries network errors and does not retry 4xx", async () => {
    const sleep = vi.fn(async () => {});
    const flaky = responses(new Error("ECONNRESET"), 200);
    expect((await fetchWithRetry(flaky, "https://x.test/a", {}, { sleep, random: noJitter })).status).toBe(200);

    const forbidden = responses(403);
    expect((await fetchWithRetry(forbidden, "https://x.test/a", {}, { sleep })).status).toBe(403);
    expect(forbidden).toHaveBeenCalledTimes(1);
  });

  it("reports every attempt", async () => {
    const onAttempt = vi.fn();
    await fetchWithRetry(responses(500, 200), "https://x.test/a", {}, { sleep: async () => {}, onAttempt });
    expect(onAttempt.mock.calls.map((c) => [c[0].attempt, c[0].status])).toEqual([
      [1, 500],
      [2, 200],
    ]);
  });
});
