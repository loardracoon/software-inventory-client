import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Eyebrow } from "@/components/shared/eyebrow";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { CycleRow } from "./api";

// Open weekly cycle(s): computers collected, task progress bar and counts, next retry window.
export function CycleCard({ loading, cycles }: { loading: boolean; cycles: CycleRow[] }) {
  return (
    <Card className="gap-4 px-6">
      <Eyebrow>Weekly cycle</Eyebrow>
      {loading ? <Skeleton className="h-24 w-full" /> : null}
      {!loading && cycles.length === 0 ? <p className="m-0 text-sm text-text-muted">No cycle is open.</p> : null}
      {cycles.map((cycle) => {
        const total = Math.max(1, cycle.tasks - cycle.skipped);
        const pct = (n: number) => `${(100 * n) / total}%`;
        return (
          <div key={cycle.cycle_id} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="m-0 text-lg">
                {cycles.length > 1 ? `${cycle.tenant_name}: ` : ""}
                {formatNumber(cycle.computers_collected)} of {formatNumber(cycle.computers)} computers collected
              </h2>
              <span className="text-sm text-text-muted">Closes {formatDateTime(cycle.closes_at)}</span>
            </div>
            <div
              role="img"
              aria-label={`${cycle.collected} collected, ${cycle.retrying} retrying, ${cycle.errors} errors, ${cycle.missed} missed of ${total} tasks`}
              className="flex h-3.5 gap-0.5 overflow-hidden rounded-full bg-surface-subtle"
            >
              <div style={{ width: pct(cycle.collected) }} className="bg-action" />
              <div style={{ width: pct(cycle.retrying) }} className="bg-alert-orange" />
              <div style={{ width: pct(cycle.errors) }} className="bg-alert-red" />
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-text-muted">
              <span>Collected · {formatNumber(cycle.collected)}</span>
              <span>Waiting · {formatNumber(cycle.pending + cycle.dispatched)}</span>
              <span>Retry scheduled · {formatNumber(cycle.retrying)}</span>
              <span>Query errors · {formatNumber(cycle.errors)}</span>
              <span>Missed · {formatNumber(cycle.missed)}</span>
              {cycle.skipped ? <span>Skipped · {formatNumber(cycle.skipped)}</span> : null}
            </div>
            {cycle.next_retry_at ? (
              <p className="m-0 text-sm text-text-muted">Next retry window {formatDateTime(cycle.next_retry_at)}</p>
            ) : null}
          </div>
        );
      })}
    </Card>
  );
}
