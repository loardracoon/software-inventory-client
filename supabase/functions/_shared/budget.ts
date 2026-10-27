// How many Sophos runs a tenant may start now (scan_settings limits vs. budget_snapshot usage).
// Normal tasks stop at daily_run_limit × (1 − reserve_pct/100); Scan now and retries may also use the
// reserve, up to daily_run_limit. Runtime-neutral (Deno and Node).

export type BudgetSettings = {
  max_active_runs: number;
  runs_per_minute: number;
  daily_run_limit: number;
  reserve_pct: number;
};

export type BudgetUsage = {
  runs_this_minute: number;
  runs_today: number;
  active_runs: number;
};

export type RunAllowance = {
  // Runs any due task may start.
  normal: number;
  // Extra runs only priority and retry tasks may start.
  reserveOnly: number;
};

export function runAllowance(settings: BudgetSettings, usage: BudgetUsage): RunAllowance {
  const free = Math.min(settings.max_active_runs - usage.active_runs, settings.runs_per_minute - usage.runs_this_minute);
  const normalDaily = Math.floor((settings.daily_run_limit * (100 - settings.reserve_pct)) / 100) - usage.runs_today;
  const totalDaily = settings.daily_run_limit - usage.runs_today;
  const normal = Math.max(0, Math.min(free, normalDaily));
  const reserveOnly = Math.max(0, Math.min(free, totalDaily) - normal);
  return { normal, reserveOnly };
}

// Takes one run from the allowance; normal runs first.
export function spendRun(allowance: RunAllowance, reserve: boolean): RunAllowance {
  if (!reserve && allowance.normal > 0) return { ...allowance, normal: allowance.normal - 1 };
  if (reserve && allowance.reserveOnly > 0) return { ...allowance, reserveOnly: allowance.reserveOnly - 1 };
  throw new Error("No run left in the budget");
}
