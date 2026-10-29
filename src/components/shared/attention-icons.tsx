import type { LucideIcon } from "lucide-react";
import { Ban, Eye, Flame, Shield, ShieldAlert, ShieldHalf, ShieldQuestionMark, ShieldX } from "lucide-react";
import { Hint } from "@/components/shared/hint";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

// Attention points of a software row or a computer as icons with a counter, details on hover, focus or
// tap. Order: Not allowed, Review, known exploited, then CVEs by severity, then CVEs that may apply.
// The colour never stands alone: each point has its own icon and the tooltip names it.

export type AttentionCategory = { level1: string; level2: string; attention: "review" | "not_allowed" | "info"; titles?: string[] };
export type VulnTop = { id: string; severity: string | null; score: number | null; kev: boolean; uncertain: boolean; title?: string };
export type VulnCounts = { critical: number; high: number; medium: number; low: number; kev: number; possible: number; top: VulnTop[] };

type Tone = "critical" | "high" | "medium" | "low" | "kev" | "muted";

const TONE: Record<Tone, string> = {
  critical: "bg-alert-red/14 text-text-strong ring-alert-red/40",
  high: "bg-alert-orange/22 text-text-strong ring-alert-orange/50",
  medium: "bg-alert-yellow/30 text-text-strong ring-alert-yellow/60",
  low: "bg-alert-lime/30 text-text-strong ring-alert-lime/60",
  kev: "bg-status-critical text-on-status-critical ring-status-critical",
  muted: "bg-surface-subtle text-text-muted ring-border-subtle",
};

function IconCount({ icon: Icon, count, tone, label, details }: { icon: LucideIcon; count: number; tone: Tone; label: string; details: React.ReactNode }) {
  return (
    <Hint
      content={
        <span className="flex flex-col gap-1">
          <span className="font-semibold text-text-strong">{label}</span>
          {details}
        </span>
      }
    >
      <button
        type="button"
        aria-label={label}
        className={cn(
          "inline-flex h-6 cursor-help items-center gap-1 rounded-full px-2 text-xs font-semibold tabular-nums ring-1 ring-inset",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
          TONE[tone],
        )}
      >
        <Icon aria-hidden="true" className="size-3.5" />
        {formatNumber(count)}
      </button>
    </Hint>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${formatNumber(n)} ${n === 1 ? one : many}`;

function CategoryList({ items }: { items: AttentionCategory[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {items.map((c) => (
        <li key={`${c.level1}/${c.level2}`}>
          <span className="text-text-strong">
            {c.level1} / {c.level2}
          </span>
          {c.titles?.length ? <span className="block text-xs text-text-muted">{c.titles.join(", ")}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function CveList({ items, total }: { items: VulnTop[]; total: number }) {
  if (!items.length) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
      {items.map((v) => (
        <li key={v.id} className="text-xs">
          <span className="font-mono text-text-strong">{v.id}</span>
          {v.score != null ? ` · ${Number(v.score).toFixed(1)}` : ""}
          {v.kev ? " · known exploited" : ""}
          {v.title ? <span className="text-text-muted"> · {v.title}</span> : null}
        </li>
      ))}
      {total > items.length ? <li className="text-xs text-text-muted">and {formatNumber(total - items.length)} more</li> : null}
    </ul>
  );
}

const SEVERITIES: { key: "critical" | "high" | "medium" | "low"; severity: string; label: string; icon: LucideIcon }[] = [
  { key: "critical", severity: "CRITICAL", label: "critical", icon: ShieldX },
  { key: "high", severity: "HIGH", label: "high", icon: ShieldAlert },
  { key: "medium", severity: "MEDIUM", label: "medium", icon: ShieldHalf },
  { key: "low", severity: "LOW", label: "low", icon: Shield },
];

export function AttentionIcons({ categories = [], vulns, scope }: { categories?: AttentionCategory[]; vulns?: VulnCounts | null; scope: "title" | "computer" }) {
  const notAllowed = categories.filter((c) => c.attention === "not_allowed");
  const review = categories.filter((c) => c.attention === "review");
  const top = vulns?.top ?? [];
  const certain = top.filter((v) => !v.uncertain);
  const where = scope === "computer" ? "installed on this computer" : "in the installed versions";
  const chips = [
    notAllowed.length > 0 && (
      <IconCount
        key="not_allowed"
        icon={Ban}
        count={notAllowed.length}
        tone="critical"
        label={`Not allowed: ${plural(notAllowed.length, "category", "categories")}`}
        details={<CategoryList items={notAllowed} />}
      />
    ),
    review.length > 0 && (
      <IconCount
        key="review"
        icon={Eye}
        count={review.length}
        tone="high"
        label={`Review: ${plural(review.length, "category", "categories")}`}
        details={<CategoryList items={review} />}
      />
    ),
    vulns && vulns.kev > 0 && (
      <IconCount
        key="kev"
        icon={Flame}
        count={vulns.kev}
        tone="kev"
        label={`Known exploited (CISA KEV): ${plural(vulns.kev, "CVE")}`}
        details={<CveList items={certain.filter((v) => v.kev)} total={vulns.kev} />}
      />
    ),
    ...SEVERITIES.map(
      (s) =>
        vulns &&
        vulns[s.key] > 0 && (
          <IconCount
            key={s.key}
            icon={s.icon}
            count={vulns[s.key]}
            tone={s.key}
            label={`${plural(vulns[s.key], `${s.label} CVE`)} ${where}`}
            details={<CveList items={certain.filter((v) => v.severity === s.severity)} total={vulns[s.key]} />}
          />
        ),
    ),
    vulns && vulns.possible > 0 && (
      <IconCount
        key="possible"
        icon={ShieldQuestionMark}
        count={vulns.possible}
        tone="muted"
        label={`May apply: ${plural(vulns.possible, "CVE")} (installed version unknown)`}
        details={<CveList items={top.filter((v) => v.uncertain)} total={vulns.possible} />}
      />
    ),
  ].filter(Boolean);
  if (chips.length === 0) return <span className="text-text-muted">—</span>;
  return <div className="flex max-w-56 min-w-36 flex-wrap gap-1">{chips}</div>;
}
