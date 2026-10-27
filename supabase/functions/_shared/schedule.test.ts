import { describe, expect, it } from "vitest";
import { cycleStartAtOrBefore, nextCycleStart, nextOfflineCheck, nextRetryAt, parseTime, wallTime, zonedTimeToUtc } from "./schedule.ts";

const SP = "America/Sao_Paulo"; // UTC-3, no DST since 2019
const NY = "America/New_York"; // DST

describe("time zone helpers", () => {
  it("converts wall time to UTC and back", () => {
    expect(zonedTimeToUtc(2026, 10, 26, 10, 0, 0, SP).toISOString()).toBe("2026-10-26T13:00:00.000Z");
    expect(wallTime(new Date("2026-10-26T13:00:00Z"), SP)).toMatchObject({ year: 2026, month: 10, day: 26, hour: 10, weekday: 1 });
  });

  it("follows DST in zones that have it", () => {
    expect(zonedTimeToUtc(2026, 7, 6, 10, 0, 0, NY).toISOString()).toBe("2026-07-06T14:00:00.000Z");
    expect(zonedTimeToUtc(2026, 12, 7, 10, 0, 0, NY).toISOString()).toBe("2026-12-07T15:00:00.000Z");
  });

  it("parses Postgres times", () => {
    expect(parseTime("10:00:00")).toEqual({ hour: 10, minute: 0, second: 0 });
    expect(parseTime("7:05")).toEqual({ hour: 7, minute: 5, second: 0 });
    expect(() => parseTime("25:00")).toThrow();
  });
});

describe("cycleStartAtOrBefore (Monday 10:00, São Paulo)", () => {
  const start = (iso: string) => cycleStartAtOrBefore(new Date(iso), 1, "10:00:00", SP).toISOString();

  it("is this Monday once 10:00 has passed", () => {
    expect(start("2026-10-26T13:00:00Z")).toBe("2026-10-26T13:00:00.000Z"); // exactly Mon 10:00
    expect(start("2026-10-28T18:00:00Z")).toBe("2026-10-26T13:00:00.000Z"); // Wednesday
  });

  it("is the previous Monday before 10:00 on Monday and at the end of the week", () => {
    expect(start("2026-10-26T12:59:00Z")).toBe("2026-10-19T13:00:00.000Z"); // Mon 09:59
    expect(start("2026-11-02T02:30:00Z")).toBe("2026-10-26T13:00:00.000Z"); // Sun 23:30 local
  });

  it("crosses month and year ends", () => {
    expect(start("2027-01-01T12:00:00Z")).toBe("2026-12-28T13:00:00.000Z");
  });

  it("closes at the next period start", () => {
    expect(nextCycleStart(new Date("2026-12-28T13:00:00Z"), "10:00", SP).toISOString()).toBe("2027-01-04T13:00:00.000Z");
  });
});

describe("nextOfflineCheck (São Paulo, retry window 11:00)", () => {
  it("is one hour later while the day lasts", () => {
    expect(nextOfflineCheck(new Date("2026-10-27T14:05:00Z"), "11:00:00", SP).toISOString()).toBe("2026-10-27T15:05:00.000Z");
    expect(nextOfflineCheck(new Date("2026-10-28T01:30:00Z"), "11:00:00", SP).toISOString()).toBe("2026-10-28T02:30:00.000Z"); // 22:30 → 23:30
  });

  it("moves to the next day's retry window once the day is over", () => {
    expect(nextOfflineCheck(new Date("2026-10-28T02:30:00Z"), "11:00:00", SP).toISOString()).toBe("2026-10-28T14:00:00.000Z"); // 23:30 → 11:00
  });
});

describe("nextRetryAt (11:00, São Paulo)", () => {
  it("is today before the window and tomorrow after it", () => {
    expect(nextRetryAt(new Date("2026-10-27T13:30:00Z"), "11:00:00", SP).toISOString()).toBe("2026-10-27T14:00:00.000Z");
    expect(nextRetryAt(new Date("2026-10-27T14:00:00Z"), "11:00:00", SP).toISOString()).toBe("2026-10-28T14:00:00.000Z");
    expect(nextRetryAt(new Date("2026-10-27T20:00:00Z"), "11:00:00", SP).toISOString()).toBe("2026-10-28T14:00:00.000Z");
  });

  it("uses the local date, not the UTC date, late at night", () => {
    // 22:30 local on Oct 27 is already Oct 28 in UTC; the next window is Oct 28 11:00 local.
    expect(nextRetryAt(new Date("2026-10-28T01:30:00Z"), "11:00", SP).toISOString()).toBe("2026-10-28T14:00:00.000Z");
  });
});
