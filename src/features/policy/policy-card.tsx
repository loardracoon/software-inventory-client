import { Link } from "react-router";
import type { PolicyClass } from "@policy";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ErrorLine } from "@/components/shared/error-line";
import { Eyebrow } from "@/components/shared/eyebrow";
import { formatNumber } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";
import { fetchPolicyOverview, type PolicyOverview } from "./api";
import { ClassDot } from "./class-badge";
import { CLASS_INFO, CLASS_ORDER, classParam } from "./classes";
import { pct } from "./summary";

function StackedBar({ label, values, total }: { label: string; values: Record<PolicyClass, number>; total: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-text-strong">
        {label} <span className="font-normal text-text-muted">· {formatNumber(total)}</span>
      </span>
      {/* Segments are separated by 2 px of the card surface; numbers are in the legend below. */}
      <div className="flex h-6 w-full gap-0.5 overflow-hidden rounded-[4px] bg-surface-raised">
        {total === 0 ? <span className="h-full w-full bg-surface-subtle" aria-hidden="true" /> : null}
        {CLASS_ORDER.filter((c) => values[c] > 0).map((cls) => (
          <Tooltip key={cls}>
            <TooltipTrigger asChild>
              <Link
                to={`/software?policy=${classParam(cls)}`}
                aria-label={`${label}: ${CLASS_INFO[cls].label}, ${formatNumber(values[cls])} (${pct(values[cls], total)})`}
                className={cn("h-full min-w-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring", CLASS_INFO[cls].bar)}
                style={{ flexGrow: values[cls], flexBasis: 0 }}
              />
            </TooltipTrigger>
            <TooltipContent>
              <span className="font-semibold text-text-strong">{CLASS_INFO[cls].label}</span> · {formatNumber(values[cls])} {label.toLowerCase()} · {pct(values[cls], total)}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

function headline(o: PolicyOverview): string {
  if (o.total_titles === 0) return "No software is installed yet.";
  if (!o.published && o.not_evaluated_titles === o.total_titles) return "No application policy is published yet.";
  const unsanctioned = o.classes.find((c) => c.class === "unsanctioned_app")?.titles ?? 0;
  return `${formatNumber(unsanctioned)} title${unsanctioned === 1 ? " is" : "s are"} unsanctioned, and ${formatNumber(o.default_titles)} title${o.default_titles === 1 ? "" : "s"} match no rule yet.`;
}

// Dashboard card: class proportions of titles and installations, with a legend that doubles as the table view.
export function PolicyCard({ tenantId }: { tenantId: string | null }) {
  const overview = useLoad(`policy-overview:${tenantId ?? "all"}`, () => fetchPolicyOverview(tenantId));
  const o = overview.data;
  const titles = Object.fromEntries(CLASS_ORDER.map((c) => [c, o?.classes.find((x) => x.class === c)?.titles ?? 0])) as Record<PolicyClass, number>;
  const installs = Object.fromEntries(CLASS_ORDER.map((c) => [c, o?.classes.find((x) => x.class === c)?.installations ?? 0])) as Record<PolicyClass, number>;
  const classifiedTitles = CLASS_ORDER.reduce((n, c) => n + titles[c], 0);
  const classifiedInstalls = CLASS_ORDER.reduce((n, c) => n + installs[c], 0);
  const overdue = (o?.exceptions ?? []).filter((e) => e.overdue || !e.review_by).length;

  return (
    <Card className="gap-5 px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <Eyebrow>Application policy</Eyebrow>
          <p className="m-0 font-subtitle text-lg text-text-strong">{o ? headline(o) : " "}</p>
        </div>
        <Link to="/policies" className="text-sm">
          Open policies
        </Link>
      </div>
      {overview.error ? <ErrorLine message={overview.error} /> : null}
      {overview.loading && !o ? <Skeleton className="h-32 w-full" /> : null}
      {o ? (
        <div className="flex flex-wrap gap-6">
          <div className="flex min-w-0 flex-[3_1_420px] flex-col gap-4">
            <StackedBar label="Software titles" values={titles} total={classifiedTitles} />
            <StackedBar label="Installations" values={installs} total={classifiedInstalls} />
            <table className="w-full border-collapse text-[13px]">
              <caption className="sr-only">Titles and installations per policy class</caption>
              <thead>
                <tr className="text-left text-text-muted">
                  <th scope="col" className="py-1 pr-3 font-normal">Class</th>
                  <th scope="col" className="py-1 pr-3 text-right font-normal">Titles</th>
                  <th scope="col" className="py-1 text-right font-normal">Installations</th>
                </tr>
              </thead>
              <tbody>
                {CLASS_ORDER.map((cls) => (
                  <tr key={cls} className="border-t border-border-subtle">
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                      <Link to={`/software?policy=${classParam(cls)}`} className="inline-flex items-center gap-2 text-text-strong no-underline">
                        <ClassDot cls={cls} />
                        {CLASS_INFO[cls].label}
                      </Link>
                    </th>
                    <td className="py-1.5 pr-3 text-right text-text-body">
                      {formatNumber(titles[cls])} <span className="text-text-muted">· {pct(titles[cls], classifiedTitles)}</span>
                    </td>
                    <td className="py-1.5 text-right text-text-body">
                      {formatNumber(installs[cls])} <span className="text-text-muted">· {pct(installs[cls], classifiedInstalls)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {o.not_evaluated_titles > 0 ? (
              <p className="m-0 text-xs text-text-muted">{formatNumber(o.not_evaluated_titles)} titles are not classified yet (no published policy, or waiting for the next evaluation).</p>
            ) : null}
          </div>
          <ul className="m-0 flex min-w-0 flex-[1_1_220px] list-none flex-col gap-4 p-0">
            <li className="flex flex-col gap-0.5">
              <span className="font-display text-2xl text-text-strong">{formatNumber(o.unsanctioned_installations)}</span>
              <Link to={`/software?policy=${classParam("unsanctioned_app")}`} className="text-[13px]">
                unsanctioned installations on {formatNumber(o.unsanctioned_computers)} computer{o.unsanctioned_computers === 1 ? "" : "s"}
              </Link>
            </li>
            <li className="flex flex-col gap-0.5">
              <span className="font-display text-2xl text-text-strong">{formatNumber(overdue)}</span>
              <Link to="/policies" className="text-[13px]">
                exception{overdue === 1 ? "" : "s"} overdue for review
              </Link>
            </li>
            <li className="flex flex-col gap-0.5">
              <span className="font-display text-2xl text-text-strong">{formatNumber(o.default_titles)}</span>
              <Link to="/policies" className="text-[13px]">
                title{o.default_titles === 1 ? "" : "s"} fall to the default class
              </Link>
            </li>
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
