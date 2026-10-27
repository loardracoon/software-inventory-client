import { describe, expect, it, vi } from "vitest";
import { endOfDayIso, formatDuration, formatNumber } from "./format";

vi.mock("@/integrations/supabase/client", () => ({ supabase: null, isSupabaseConfigured: false }));
const { likePattern } = await import("@/features/inventory/api");

describe("endOfDayIso", () => {
  it("is the last second of the day in the tenant time zone", () => {
    expect(endOfDayIso("2026-10-15")).toBe("2026-10-16T02:59:59.000Z"); // São Paulo, UTC-3
    expect(endOfDayIso("2026-07-06", "America/New_York")).toBe("2026-07-07T03:59:59.000Z"); // EDT
    expect(endOfDayIso("2026-12-31", "UTC")).toBe("2026-12-31T23:59:59.000Z");
  });
});

describe("formatting", () => {
  it("formats numbers and durations", () => {
    expect(formatNumber(1284)).toBe("1,284");
    expect(formatNumber(null)).toBe("—");
    expect(formatDuration(42)).toBe("42 s");
    expect(formatDuration(610)).toBe("10 min 10 s");
    expect(formatDuration(3700)).toBe("1 h 1 min");
  });
});

describe("likePattern", () => {
  it("removes characters with a meaning in PostgREST filters", () => {
    expect(likePattern("anydesk")).toBe("%anydesk%");
    expect(likePattern("a,b(c)*")).toBe("%a b c%");
    expect(likePattern("100%_x")).toBe("%100  x%");
  });
});
