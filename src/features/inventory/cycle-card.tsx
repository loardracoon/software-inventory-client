import { Link } from "react-router";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CardHeading } from "@/components/shared/overview-widget";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { CycleRow } from "./api";

function Swatch({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={`size-3 rounded-[3px] ${className}`} />
      {children}
    </span>
  );
}

// Open weekly cycle(s): computers collected, task progress bar and counts, next retry window.
export function CycleCard({ loading, cycles }: { loading: boolean; cycles: CycleRow[] }) {
  return (
    <Card className="gap-5 px-6">
      <CardHeading eyebrow="Weekly cycle" />
      {loading ? <Skeleton className="h-24 w-full" /> : null}
      {!loading && cycles.length === 0 ? <p className="m-0 text-sm text-text-muted">No cycle is open.</p> : null}
      {cycles.map((cycle) => {
        const total = Math.max(1, cycle.tasks - cycle.skipped);
        const pct = (n: number) => `${(100 * n) / total}%`;
        return (
          <div key={cycle.cycle_id} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="m-0 text-xl">
                {cycles.length > 1 ? `${cycle.tenant_name}: ` : ""}
                {formatNumber(cycle.computers_collected)} of {formatNumber(cycle.computers)} computers collected
              </h2>
              <span className="rounded-full bg-sky-blue/18 px-2.5 py-[5px] text-xs leading-none font-semibold text-text-strong ring-1 ring-border-subtle ring-inset">
                Open · closes {formatDateTime(cycle.closes_at)}
              </span>
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
              <Swatch className="bg-action">Collected · {formatNumber(cycle.collected)}</Swatch>
              <span>Waiting · {formatNumber(cycle.pending + cycle.dispatched)}</span>
              <Swatch className="bg-alert-orange">Retry scheduled · {formatNumber(cycle.retrying)}</Swatch>
              <Swatch className="bg-alert-red">Query errors · {formatNumber(cycle.errors)}</Swatch>
              <span>Missed · {formatNumber(cycle.missed)}</span>
              {cycle.skipped ? <span>Skipped · {formatNumber(cycle.skipped)}</span> : null}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-muted">
              <span>{cycle.next_retry_at ? `Next retry window ${formatDateTime(cycle.next_retry_at)}` : "No retry window scheduled"}</span>
              {cycle.retrying + cycle.errors > 0 ? (
                <Link to="/scans" className="font-semibold">
                  Open retry queue
                </Link>
              ) : null}
            </div>
          </div>
        );
      })}
    </Card>
  );
}
