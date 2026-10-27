import { describe, expect, it } from "vitest";
import { runAllowance, spendRun, type BudgetSettings } from "./budget.ts";

const settings: BudgetSettings = { max_active_runs: 4, runs_per_minute: 10, daily_run_limit: 1000, reserve_pct: 20 };

describe("runAllowance", () => {
  it("is limited by active runs", () => {
    expect(runAllowance(settings, { runs_this_minute: 0, runs_today: 0, active_runs: 1 })).toEqual({ normal: 3, reserveOnly: 0 });
    expect(runAllowance(settings, { runs_this_minute: 0, runs_today: 0, active_runs: 4 })).toEqual({ normal: 0, reserveOnly: 0 });
  });

  it("is limited by runs this minute", () => {
    expect(runAllowance({ ...settings, max_active_runs: 4 }, { runs_this_minute: 8, runs_today: 8, active_runs: 0 })).toEqual({
      normal: 2,
      reserveOnly: 0,
    });
  });

  it("keeps the reserve for retries and Scan now", () => {
    expect(runAllowance(settings, { runs_this_minute: 0, runs_today: 798, active_runs: 0 })).toEqual({ normal: 2, reserveOnly: 2 });
    expect(runAllowance(settings, { runs_this_minute: 0, runs_today: 800, active_runs: 0 })).toEqual({ normal: 0, reserveOnly: 4 });
    expect(runAllowance(settings, { runs_this_minute: 0, runs_today: 998, active_runs: 0 })).toEqual({ normal: 0, reserveOnly: 2 });
    expect(runAllowance(settings, { runs_this_minute: 0, runs_today: 1000, active_runs: 0 })).toEqual({ normal: 0, reserveOnly: 0 });
  });

  it("never goes negative", () => {
    expect(runAllowance(settings, { runs_this_minute: 12, runs_today: 1200, active_runs: 6 })).toEqual({ normal: 0, reserveOnly: 0 });
  });

  it("works with REST limits and no reserve", () => {
    expect(runAllowance({ ...settings, daily_run_limit: 500, reserve_pct: 0 }, { runs_this_minute: 0, runs_today: 499, active_runs: 0 })).toEqual({
      normal: 1,
      reserveOnly: 0,
    });
  });
});

describe("spendRun", () => {
  it("spends normal runs first and the reserve only for reserve runs", () => {
    expect(spendRun({ normal: 1, reserveOnly: 1 }, false)).toEqual({ normal: 0, reserveOnly: 1 });
    expect(spendRun({ normal: 0, reserveOnly: 1 }, true)).toEqual({ normal: 0, reserveOnly: 0 });
    expect(() => spendRun({ normal: 0, reserveOnly: 1 }, false)).toThrow();
  });
});
