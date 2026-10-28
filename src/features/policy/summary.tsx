import { Link } from "react-router";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate, formatNumber } from "@/lib/format";
import type { PolicyOverview } from "./api";
import { ClassDot, ClassHint } from "./class-badge";
import { CLASS_INFO, CLASS_ORDER, classParam } from "./classes";

export function pct(part: number, total: number): string {
  if (!total) return "0%";
  const p = (part / total) * 100;
  return `${p > 0 && p < 1 ? "<1" : Math.round(p)}%`;
}

// Four compact cards: dot, class name, titles and percentage. The description, machine id and CIS
// reference are in the tooltip. Each card links to the Software list filtered by the class.
export function ClassSummary({ overview }: { overview: PolicyOverview | null }) {
  const byClass = new Map((overview?.classes ?? []).map((c) => [c.class, c]));
  const total = overview?.total_titles ?? 0;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="list" aria-label="Titles per class">
      {CLASS_ORDER.map((cls) => {
        const titles = byClass.get(cls)?.titles ?? 0;
        return (
          <div role="listitem" key={cls} className="min-w-0">
            <ClassHint cls={cls} link>
              <Link
                to={`/software?policy=${classParam(cls)}`}
                aria-label={`${CLASS_INFO[cls].label}: ${formatNumber(titles)} titles, ${pct(titles, total)}`}
                className="flex min-w-0 flex-col gap-2 rounded-md border-[1.5px] border-border-subtle bg-surface-raised px-4 py-3 text-text-body no-underline hover:border-border-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-text-strong">
                  <ClassDot cls={cls} />
                  {CLASS_INFO[cls].label}
                </span>
                <span className="flex items-baseline gap-2">
                  <span className="font-display text-[28px] leading-none text-text-strong">{formatNumber(titles)}</span>
                  <span className="text-[13px] text-text-muted">titles · {pct(titles, total)}</span>
                </span>
              </Link>
            </ClassHint>
          </div>
        );
      })}
    </div>
  );
}

export function DraftBar({ version, changes, canEdit, busy, onDiscard, onPublish }: {
  version: number;
  changes: number;
  canEdit: boolean;
  busy: boolean;
  onDiscard: () => void;
  onPublish: () => void;
}) {
  return (
    <div role="region" aria-label="Draft" className="flex flex-wrap items-center gap-3 rounded-lg border-[1.5px] border-action bg-surface-raised px-5 py-4">
      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-0.5">
        <span className="text-sm font-semibold text-text-strong">
          Draft version {version} · {changes} change{changes === 1 ? "" : "s"}
        </span>
        <span className="text-[13px] text-text-muted">
          The table and the title tester show the draft. Titles keep their published class until you publish.
        </span>
      </div>
      {canEdit ? (
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" size="sm" disabled={busy} onClick={onDiscard}>
            Discard draft
          </Button>
          <Button size="sm" disabled={busy} onClick={onPublish}>
            Publish
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// Tolerated rules whose review is overdue or due within 30 days (CIS 2.3: review monthly).
export function OverdueBanner({ overview }: { overview: PolicyOverview | null }) {
  const items = overview?.exceptions ?? [];
  if (!items.length) return null;
  const overdue = items.filter((e) => e.overdue || !e.review_by).length;
  return (
    <div role="status" className="flex flex-col gap-2 rounded-lg border-[1.5px] border-alert-orange bg-surface-raised px-5 py-4">
      <span className="flex items-center gap-2 text-sm font-semibold text-text-strong">
        <AlertTriangle className="size-4 text-status-high" aria-hidden="true" />
        {overdue ? `${overdue} exception${overdue === 1 ? " is" : "s are"} overdue for review` : "Exceptions are due for review"}
        {items.length > overdue ? ` · ${items.length - overdue} due in the next 30 days` : ""}
      </span>
      <span className="text-[13px] text-text-muted">CIS 2.3 asks for a review of documented exceptions at least monthly.</span>
      <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-sm">
        {items.map((e) => (
          <li key={e.lineage_id}>
            <Link to={`/policies/rules/${e.lineage_id}`}>{e.name}</Link>{" "}
            <span className="text-text-muted">
              · {e.review_by ? `${e.overdue ? "was due" : "due"} ${formatDate(`${e.review_by}T12:00:00Z`)}` : "no review date"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
