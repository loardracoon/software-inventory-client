import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Eyebrow } from "@/components/shared/eyebrow";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BudgetRow } from "./api";

// Scans › API budget: Sophos run limits per tenant (budget.ts enforces them; this only shows them).
export function BudgetCard({ loading, rows }: { loading: boolean; rows: BudgetRow[] }) {
  return (
    <Card className="gap-4 px-6">
      <div className="flex flex-col gap-1">
        <Eyebrow>Sophos API budget</Eyebrow>
        <p className="m-0 text-sm text-text-muted">
          Live Discover runs per tenant. Weekly tasks stop at the normal share; the reserve is kept for retries and Scan now.
        </p>
      </div>
      {loading && rows.length === 0 ? <Skeleton className="h-16 w-full" /> : null}
      {!loading && rows.length === 0 ? <p className="m-0 text-sm text-text-muted">No tenants yet.</p> : null}
      <ul className="m-0 flex list-none flex-col gap-5 p-0">
        {rows.map((r) => {
          const normalLimit = Math.floor((r.daily_run_limit * (100 - r.reserve_pct)) / 100);
          return (
            <li key={r.tenant_id} className="flex flex-col gap-3">
              <span className="text-sm font-semibold text-text-strong">{r.tenant_name}</span>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Meter label="This minute" used={r.runs_this_minute} limit={r.runs_per_minute} />
                <Meter label="Today" used={r.runs_today} limit={r.daily_run_limit} mark={normalLimit} />
                <Meter label="Active runs" used={r.active_runs} limit={r.max_active_runs} />
              </div>
              <p className="m-0 text-xs text-text-muted">
                {formatNumber(r.normal_left)} normal runs left today · {formatNumber(r.reserve_left)} of {formatNumber(r.daily_run_limit - normalLimit)} in reserve
              </p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// Number and label always written; the bar only repeats them. `mark` shows where the reserve starts.
function Meter({ label, used, limit, mark }: { label: string; used: number; limit: number; mark?: number }) {
  const pct = Math.min(100, (100 * used) / Math.max(1, limit));
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex justify-between text-xs">
        <span className="text-text-muted">{label}</span>
        <span className="font-semibold text-text-strong">
          {formatNumber(used)} / {formatNumber(limit)}
        </span>
      </span>
      <span
        className="relative block h-2 rounded-full bg-surface-subtle"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
      >
        <span className={cn("block h-full rounded-full", pct >= 90 ? "bg-status-critical" : "bg-action")} style={{ width: `${pct}%` }} />
        {mark !== undefined ? (
          <span className="absolute top-[-2px] h-3 w-0.5 bg-text-muted" style={{ left: `${(100 * mark) / Math.max(1, limit)}%` }} aria-hidden="true" />
        ) : null}
      </span>
    </div>
  );
}
