import { useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export type WidgetRamp = "blue" | "red" | "green";

export type WidgetRow = {
  label: string;
  sub?: string;
  critical?: boolean; // the sub line is a problem (red text, not colour alone: the words say it)
  value?: string;
};

export type WidgetSegment = {
  key: string;
  label: string;
  n: number;
  to?: string; // filtered list for this segment
  meta?: string; // extra line in the popover, after the count and share
  rows?: WidgetRow[];
  color?: string; // CSS colour for a fixed meaning (policy classes); otherwise the ramp decides
  other?: boolean; // the grey "Other" group, always last
};

type OverviewWidgetProps = {
  value: ReactNode;
  unit: string;
  caption: ReactNode;
  noun: string; // what the segments count ("computers", "CVEs"), for the popover and the screen reader
  ramp?: WidgetRamp;
  segments?: WidgetSegment[];
  more?: { to: string; label: string };
  loading?: boolean;
};

const pct = (n: number, total: number) => (total > 0 ? `${((n * 100) / total).toFixed(1)}%` : "0%");

function segmentColors(ramp: WidgetRamp, segments: WidgetSegment[]): string[] {
  let step = 0;
  return segments.map((s) => s.color ?? (s.other ? "var(--ramp-other)" : `var(--ramp-${ramp}-${Math.min(4, ++step)})`));
}

// Overview widget (mock MainWidgets.dc.html): big number, one segmented bar with a legend, and a popover
// per segment on hover or focus with its count, share, details and a link to the filtered list.
export function OverviewWidget({ value, unit, caption, noun, ramp = "blue", segments = [], more, loading = false }: OverviewWidgetProps) {
  const [open, setOpen] = useState<number | null>(null);
  const total = segments.reduce((n, s) => n + s.n, 0);
  const colors = segmentColors(ramp, segments);
  const active = open === null ? null : segments[open];
  const close = () => setOpen(null);

  let caretLeft = "50%";
  if (open !== null && total > 0) {
    const before = segments.slice(0, open).reduce((n, s) => n + s.n, 0);
    caretLeft = `${(((before + segments[open].n / 2) * 100) / total).toFixed(1)}%`;
  }

  const onBlur = (e: FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") close();
  };

  return (
    <section
      aria-label={`${unit}, ${typeof caption === "string" ? caption : ""}`}
      className={cn(
        "relative flex min-w-0 flex-col gap-1.5 rounded-lg border border-border-subtle bg-surface-raised px-6 pt-6 pb-5 shadow-sm",
        active && "z-30 shadow-md",
      )}
      onMouseLeave={close}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    >
      {loading ? (
        <Skeleton className="h-[52px] w-28" />
      ) : (
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="font-display text-[52px] leading-none font-normal tracking-[-0.02em] text-text-strong">{value}</span>
          <span className="font-subtitle text-[15px] font-semibold tracking-[0.04em] text-text-muted uppercase">{unit}</span>
        </div>
      )}
      <span className="text-xs text-text-muted">{caption}</span>

      {!loading && segments.length > 0 ? (
        <>
          <div className="relative mt-3.5">
            <div className="flex h-5 items-center gap-0.5" role="group" aria-label={`${unit} ${typeof caption === "string" ? caption : ""}`}>
              {total === 0 ? <span className="block h-2 w-full rounded-full bg-surface-subtle" aria-hidden="true" /> : null}
              {total > 0
                ? segments.map((s, i) =>
                    s.n > 0 ? (
                      <button
                        key={s.key}
                        type="button"
                        className="flex h-5 min-w-1.5 cursor-pointer items-center border-0 bg-transparent p-0 focus-visible:rounded-xs"
                        style={{ flex: `${s.n} 1 0px` }}
                        aria-label={`${s.label}: ${formatNumber(s.n)} ${noun}, ${pct(s.n, total)}`}
                        aria-expanded={open === i}
                        onMouseEnter={() => setOpen(i)}
                        onFocus={() => setOpen(i)}
                        onClick={() => setOpen(i)}
                      >
                        <span
                          className={cn(
                            "block w-full transition-[height,opacity] duration-150",
                            i === 0 ? "rounded-l-full" : "rounded-l-[2px]",
                            i === segments.length - 1 || segments.slice(i + 1).every((x) => x.n === 0) ? "rounded-r-full" : "rounded-r-[2px]",
                          )}
                          style={{ background: colors[i], height: open === i ? 12 : 8, opacity: open === null || open === i ? 1 : 0.35 }}
                        />
                      </button>
                    ) : null,
                  )
                : null}
            </div>

            {active ? (
              <>
                <span
                  aria-hidden="true"
                  className="absolute top-[calc(100%+6px)] z-[2] -ml-[7px] size-3.5 rotate-45 border-t border-l border-border-subtle bg-surface-raised"
                  style={{ left: caretLeft }}
                />
                <div
                  role="group"
                  aria-label={`${active.label} details`}
                  className="absolute top-[calc(100%+13px)] -right-[25px] -left-[25px] z-[1] flex flex-col rounded-md border border-border-subtle bg-surface-raised px-4 pt-4 pb-2 shadow-lg"
                >
                  <div className="flex flex-col gap-1 pb-2.5">
                    <span className="inline-flex items-center gap-2 font-subtitle text-lg text-text-strong">
                      <i aria-hidden="true" className="inline-block size-3 rounded-[3px]" style={{ background: colors[open!] }} />
                      {active.label}
                    </span>
                    <span className="text-[13px] text-text-muted">
                      {formatNumber(active.n)} {noun} · {pct(active.n, total)}
                      {active.meta ? ` · ${active.meta}` : ""}
                    </span>
                  </div>
                  {(active.rows ?? []).map((r, i) => (
                    <div key={`${r.label}-${i}`} className="flex items-center gap-2.5 border-t border-border-subtle py-2">
                      <div className="flex min-w-0 flex-auto flex-col gap-px">
                        <span className="truncate text-sm text-text-strong">{r.label}</span>
                        {r.sub ? <span className={cn("truncate text-xs", r.critical ? "text-text-critical" : "text-text-muted")}>{r.sub}</span> : null}
                      </div>
                      {r.value ? <span className="flex-none text-sm font-semibold whitespace-nowrap text-text-strong">{r.value}</span> : null}
                    </div>
                  ))}
                  {active.to || more ? (
                    <Link
                      to={active.to ?? more!.to}
                      className="block border-t border-border-subtle pt-2.5 pb-1.5 text-center text-sm font-semibold no-underline"
                    >
                      {active.to ? `Show ${active.label.toLowerCase()}` : more!.label}
                    </Link>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>

          <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-3 gap-y-1 p-0">
            {segments.map((s, i) => {
              const content = (
                <>
                  <i aria-hidden="true" className="inline-block size-2 rounded-[2px]" style={{ background: colors[i] }} />
                  {s.label} · {formatNumber(s.n)}
                </>
              );
              const cls = cn(
                "inline-flex items-center gap-[5px] text-xs whitespace-nowrap",
                open === i ? "font-semibold text-text-strong" : "text-text-muted",
              );
              return (
                <li key={s.key}>
                  {s.to ? (
                    <Link to={s.to} className={cn(cls, "no-underline hover:text-text-strong")} onMouseEnter={() => setOpen(i)} onFocus={() => setOpen(i)}>
                      {content}
                    </Link>
                  ) : (
                    <span className={cls}>{content}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {more && segments.length === 0 && !loading ? (
        <Link to={more.to} className="mt-3 text-sm font-semibold">
          {more.label}
        </Link>
      ) : null}
    </section>
  );
}

// Tile inside a card (mock .v-tile): number, label and an optional detail, linking to the filtered list.
export function StatTile({ to, value, label, detail, alert }: { to: string; value: number; label: string; detail?: string; alert?: boolean }) {
  return (
    <Link to={to} className="flex flex-col gap-2 rounded-lg bg-surface-subtle px-[18px] py-4 no-underline outline-offset-2 hover:ring-1 hover:ring-border-control">
      <span className="font-display text-[11px] leading-none font-semibold tracking-[0.1em] text-text-strong uppercase">{label}</span>
      <span className={cn("font-display text-4xl leading-none", alert && value > 0 ? "text-text-critical" : "text-text-strong")}>{formatNumber(value)}</span>
      {detail ? <span className="text-[13px] leading-normal text-text-muted">{detail}</span> : null}
    </Link>
  );
}

// Card heading from the mock: eyebrow, then a one-sentence headline that states the finding.
export function CardHeading({ eyebrow, headline, aside }: { eyebrow: string; headline?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2">
        <span className="font-display text-xs leading-none font-semibold tracking-[0.1em] text-text-strong uppercase">{eyebrow}</span>
        {headline ? <h2 className="m-0 text-xl">{headline}</h2> : null}
      </div>
      {aside}
    </div>
  );
}
