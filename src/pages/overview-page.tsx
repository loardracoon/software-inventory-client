import { Link } from "react-router";
import { Radar } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PolicyClass } from "@policy";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AttentionBadge } from "@/components/shared/category-tag";
import { ChangeBadge } from "@/components/shared/change-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorLine } from "@/components/shared/error-line";
import { CardHeading, OverviewWidget, StatTile, type WidgetSegment } from "@/components/shared/overview-widget";
import { PageHeader } from "@/components/shared/page-header";
import {
  fetchCycleOverview,
  fetchLatestChanges,
  fetchNeedsAttention,
  fetchOverviewStats,
  fetchWeeklyChanges,
  type ChangeRow,
  type CycleRow,
  type OverviewStats,
} from "@/features/inventory/api";
import { fetchPolicyOverview, type PolicyOverview } from "@/features/policy/api";
import { CLASS_INFO, CLASS_ORDER, classParam } from "@/features/policy/classes";
import { fetchVulnOverview, type VulnOverview } from "@/features/vulns/api";
import { useTenant } from "@/features/tenants/tenant-context";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { label, PLATFORM_LABEL, SOURCE_LABEL } from "@/lib/labels";
import { useLoad } from "@/lib/use-load";
import { CycleCard } from "@/features/inventory/cycle-card";
import { VulnOverviewCard } from "@/features/vulns/vuln-overview-card";

const plural = (n: number, one: string, many = `${one}s`) => `${formatNumber(n)} ${n === 1 ? one : many}`;

// At most four named groups; the rest go to a grey "Other" group, always last.
function topWithOther(entries: [string, number][], name: (key: string) => string, noun: string): WidgetSegment[] {
  const sorted = [...entries].sort((a, b) => b[1] - a[1]);
  const named = sorted.length > 4 ? sorted.slice(0, 3) : sorted;
  const rest = sorted.slice(named.length);
  const segments: WidgetSegment[] = named.map(([key, n]) => ({ key, label: name(key), n }));
  if (rest.length) {
    segments.push({
      key: "other",
      label: "Other",
      n: rest.reduce((t, [, n]) => t + n, 0),
      other: true,
      rows: rest.map(([key, n]) => ({ label: name(key), value: `${formatNumber(n)} ${noun}` })),
    });
  }
  return segments;
}

function changeRows(rows: ChangeRow[], change: string) {
  return rows
    .filter((r) => r.change === change)
    .slice(0, 3)
    .map((r) => ({
      label: change === "updated" && r.to_version ? `${r.canonical_name} → ${r.to_version}` : (r.canonical_name ?? "—"),
      sub: r.hostname ?? undefined,
      value: r.detected_at ? formatDate(r.detected_at) : undefined,
    }));
}

const classColor = (cls: PolicyClass) => `var(--class-${CLASS_INFO[cls].machineId.replace(/-(app|system)$/, "")})`;

function policySegments(o: PolicyOverview): WidgetSegment[] {
  // Most restrictive class first: it is the one that needs attention.
  return [...CLASS_ORDER].reverse().map((cls) => {
    const c = o.classes.find((x) => x.class === cls);
    const segment: WidgetSegment = {
      key: cls,
      label: CLASS_INFO[cls].label,
      n: c?.titles ?? 0,
      color: classColor(cls),
      to: `/software?policy=${classParam(cls)}`,
      meta: `${plural(c?.installations ?? 0, "install")}`,
    };
    if (cls === "unsanctioned_app" && o.default_titles > 0) segment.meta += ` · ${plural(o.default_titles, "title")} match no rule`;
    if (cls === "tolerated_app" && o.exceptions.length) {
      const overdue = o.exceptions.filter((e) => e.overdue || !e.review_by).length;
      if (overdue) segment.meta += ` · ${plural(overdue, "review")} overdue`;
      segment.rows = o.exceptions.slice(0, 3).map((e) => ({
        label: e.name,
        sub: e.overdue || !e.review_by ? "Review overdue" : `Review by ${formatDate(`${e.review_by}T12:00:00Z`)}`,
        critical: e.overdue || !e.review_by,
        value: e.owner ?? undefined,
      }));
    }
    return segment;
  });
}

function cycleLine(cycles: CycleRow[] | null): string {
  if (!cycles || cycles.length !== 1) return "Fleet coverage, this week's collection and what changed.";
  const c = cycles[0];
  const parts = [`Cycle opened ${formatDateTime(c.opened_at)}`, `${formatNumber(c.computers_collected)} of ${formatNumber(c.computers)} computers collected`];
  if (c.next_retry_at) parts.push(`next retry window ${formatDateTime(c.next_retry_at)}`);
  return parts.join(" · ");
}

function Widgets({ s, loading, latest, policy, vuln }: { s: OverviewStats | null; loading: boolean; latest: ChangeRow[]; policy: PolicyOverview | null; vuln: VulnOverview | null }) {
  const computers = s?.computers ?? 0;
  const supported = Math.max(0, computers - (s?.eol_computers ?? 0) - (s?.ending_soon_computers ?? 0));
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-5">
      <OverviewWidget
        loading={loading}
        value={formatNumber(s?.computers)}
        unit="Computers"
        caption="by operating system"
        noun="computers"
        segments={s ? topWithOther(Object.entries(s.computers_by_platform), (p) => label(PLATFORM_LABEL, p), "computers") : []}
        more={{ to: "/computers", label: "See all computers" }}
      />
      <OverviewWidget
        loading={loading}
        value={formatNumber(s?.coverage_current)}
        unit="Current"
        caption={s?.coverage_pct === null || s?.coverage_pct === undefined ? "inventory coverage · no open cycle" : `inventory coverage · ${s.coverage_pct}% collected this cycle`}
        noun="computers"
        segments={
          s
            ? [
                { key: "never", label: "Never inventoried", n: s.coverage_never, to: "/computers?coverage=never" },
                { key: "stale", label: "Stale", n: s.coverage_stale, to: "/computers?coverage=stale" },
                { key: "current", label: "Current", n: s.coverage_current, to: "/computers?coverage=current" },
              ]
            : []
        }
      />
      {vuln && vuln.cached > 0 ? (
        <OverviewWidget
          value={formatNumber(vuln.vulns)}
          unit="CVEs"
          caption={`open in installed applications · ${plural(vuln.kev, "known exploited", "known exploited")}`}
          noun="CVEs"
          ramp="red"
          segments={[
            { key: "critical", label: "Critical", n: vuln.critical, to: "/software?vuln=critical" },
            { key: "high", label: "High", n: vuln.high, to: "/software?vuln=high" },
            { key: "other", label: "Other", n: Math.max(0, vuln.vulns - vuln.critical - vuln.high), other: true, meta: "medium, low or no score" },
          ]}
          more={{ to: "/software?vuln=any", label: "See all vulnerable software" }}
        />
      ) : null}
      <OverviewWidget
        loading={loading}
        value={formatNumber(s?.changes_7d)}
        unit="Changes"
        caption="last 7 days"
        noun="changes"
        segments={
          s
            ? [
                { key: "added", label: "Added", n: s.added_7d, rows: changeRows(latest, "added") },
                { key: "updated", label: "Updated", n: s.updated_7d, rows: changeRows(latest, "updated") },
                { key: "removed", label: "Removed", n: s.removed_7d, rows: changeRows(latest, "removed") },
              ]
            : []
        }
        more={{ to: "/changes", label: "See all changes" }}
      />
      {policy && policy.total_titles > 0 ? (
        <OverviewWidget
          value={formatNumber(policy.total_titles)}
          unit="Titles"
          caption={policy.published ? "by policy class" : "no application policy published yet"}
          noun="titles"
          segments={policySegments(policy)}
          more={{ to: "/policies", label: "Open policies" }}
        />
      ) : (
        <OverviewWidget loading={loading} value={formatNumber(s?.titles)} unit="Titles" caption="programs, extensions and packages" noun="titles" more={{ to: "/software", label: "See all software" }} />
      )}
      {s && computers > 0 && (s.eol_computers !== undefined || s.ending_soon_computers !== undefined) ? (
        <OverviewWidget
          value={formatNumber(s.eol_computers ?? 0)}
          unit="Unsupported"
          caption="computers by OS support"
          noun="computers"
          ramp="red"
          segments={[
            { key: "eol", label: "Past end of life", n: s.eol_computers ?? 0, to: "/computers?support=eol" },
            { key: "ending_soon", label: "Ending within 90 days", n: s.ending_soon_computers ?? 0, to: "/computers?support=ending_soon" },
            { key: "supported", label: "Supported", n: supported, other: true, to: "/computers?support=supported" },
          ]}
        />
      ) : null}
      <OverviewWidget
        loading={loading}
        value={formatNumber(s?.extension_installs)}
        unit="Extensions"
        caption={`browser and IDE · ${formatNumber(s?.distinct_extensions)} distinct`}
        noun="installs"
        more={{ to: "/software?kind=extension", label: "See all extensions" }}
      />
      <OverviewWidget
        loading={loading}
        value={formatNumber(s?.package_installs)}
        unit="Packages"
        caption={s?.package_managers.length ? s.package_managers.map((m) => label(SOURCE_LABEL, m)).join(", ") : "npm, Chocolatey, pip, Homebrew"}
        noun="installs"
        more={{ to: "/software?kind=package", label: "See all packages" }}
      />
    </div>
  );
}

export function OverviewPage() {
  const { selectedTenantId } = useTenant();
  const key = selectedTenantId ?? "all";
  const stats = useLoad(`stats:${key}`, () => fetchOverviewStats(selectedTenantId));
  const cycles = useLoad(`cycles:${key}`, () => fetchCycleOverview(selectedTenantId));
  const attention = useLoad(`attention:${key}`, () => fetchNeedsAttention(selectedTenantId));
  const weeks = useLoad(`weeks:${key}`, () => fetchWeeklyChanges(selectedTenantId, 12));
  const latest = useLoad(`latest:${key}`, () => fetchLatestChanges(selectedTenantId, 30));
  const policy = useLoad(`policy-overview:${key}`, () => fetchPolicyOverview(selectedTenantId));
  const vuln = useLoad(`vuln-overview:${key}`, () => fetchVulnOverview(selectedTenantId));
  const s = stats.data;
  const hasFleet = !!s && s.computers > 0;
  const attentionRows = attention.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Overview"
        description={cycleLine(cycles.data)}
        actions={
          <Button asChild size="sm">
            <Link to="/scans">View scan status</Link>
          </Button>
        }
      />
      {stats.error ? <ErrorLine message={stats.error} /> : null}

      <Widgets s={s} loading={stats.loading} latest={latest.data ?? []} policy={policy.data} vuln={vuln.data} />

      {s && s.computers === 0 ? (
        <EmptyState
          icon={Radar}
          title="No inventory yet"
          description="Connect Sophos Central in Settings. The first weekly cycle fills this page."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link to="/settings">Open settings</Link>
            </Button>
          }
        />
      ) : null}

      {hasFleet ? <VulnOverviewCard tenantId={selectedTenantId} /> : null}

      {hasFleet ? (
        <div className="flex flex-wrap gap-6">
          <Card className="min-w-0 flex-[3_1_520px] gap-5 px-6">
            <CardHeading
              eyebrow="Unsupported software and systems"
              headline={`${plural(s.eol_titles ?? 0, "title")} past end of life, and ${plural(s.eol_computers ?? 0, "computer")} on an unsupported OS`}
            />
            <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
              <StatTile to="/software?support=eol" value={s.eol_titles ?? 0} label="Software past end of life" alert />
              <StatTile to="/software?support=ending_soon" value={s.ending_soon_titles ?? 0} label="Software ending within 90 days" />
              <StatTile to="/computers?support=eol" value={s.eol_computers ?? 0} label="Computers with an unsupported OS" alert />
              <StatTile to="/computers?support=ending_soon" value={s.ending_soon_computers ?? 0} label="OS ending within 90 days" />
            </div>
          </Card>
          {(s.patch_tracked_computers ?? 0) > 0 ? (
            <Card className="min-w-0 flex-[1_1_260px] gap-5 px-6">
              <CardHeading eyebrow="Patches" />
              <StatTile
                to="/computers?patch=stale"
                value={s.patch_stale_computers ?? 0}
                label="Computers without a recent patch"
                detail={`of ${formatNumber(s.patch_tracked_computers ?? 0)} with patch data`}
                alert
              />
            </Card>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-6">
        <div className="min-w-0 flex-[3_1_520px] [&>*]:h-full">
          <CycleCard loading={cycles.loading} cycles={cycles.data ?? []} />
        </div>
        <Card className="min-w-0 flex-[2_1_360px] gap-[18px] border-transparent bg-surface-inverse px-6 text-text-on-inverse">
          <div className="flex flex-col gap-2">
            <span className="font-display text-xs leading-none font-semibold tracking-[0.1em] text-text-on-inverse uppercase">Needs attention</span>
            {attentionRows.length ? (
              <h2 className="m-0 text-xl text-text-on-inverse">
                {attentionRows[0].level2_name} runs on {plural(attentionRows[0].computers, "computer")}
                {attentionRows.length > 1 ? `, with ${plural(attentionRows.length - 1, "more category", "more categories")} to review` : ""}
              </h2>
            ) : null}
          </div>
          {attention.loading ? <Skeleton className="h-24 w-full" /> : null}
          {attention.data && attention.data.length === 0 ? (
            <p className="m-0 text-sm text-text-on-inverse">No software in Review or Not allowed categories.</p>
          ) : null}
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {attentionRows.map((row) => (
              <li key={row.category_slug} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Link
                  to={`/software?category=${encodeURIComponent(row.category_slug)}`}
                  className="flex min-w-0 flex-[1_1_190px] flex-col gap-0.5 text-text-on-inverse no-underline hover:underline"
                >
                  <span className="text-xs">{row.level1_name}</span>
                  <span className="text-sm font-semibold">{row.level2_name}</span>
                </Link>
                <AttentionBadge level={row.attention_level} />
                <span className="text-sm whitespace-nowrap">
                  {plural(row.computers, "computer")} · {plural(row.titles, "title")}
                </span>
              </li>
            ))}
          </ul>
          <div className="h-px bg-slate" />
          <p className="m-0 text-xs leading-normal">
            Subcategories whose attention level is Review or Not allowed. Categories come from the Dictionary Hub, so a reclassification there updates the whole history.
          </p>
        </Card>
      </div>

      <div className="flex flex-wrap gap-6">
        <Card className="min-w-0 flex-[3_1_520px] gap-[18px] px-6">
          <CardHeading eyebrow="Changes per week" />
          <div className="flex flex-wrap gap-4 text-[13px] text-text-muted">
            {(
              [
                ["Added", "bg-action"],
                ["Updated", "bg-sky-blue"],
                ["Removed", "bg-slate"],
              ] as const
            ).map(([name, cls]) => (
              <span key={name} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className={`size-3 rounded-[3px] ${cls}`} />
                {name}
              </span>
            ))}
          </div>
          {weeks.loading ? <Skeleton className="h-60 w-full" /> : null}
          {weeks.data ? (
            <div className="h-60 w-full" role="img" aria-label="Added, updated and removed items per week for the last 12 weeks">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeks.data.map((w) => ({ ...w, label: formatDate(`${w.week_start}T12:00:00Z`) }))} barCategoryGap="18%">
                  <XAxis dataKey="label" tick={{ fill: "var(--text-muted)", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: "var(--text-muted)", fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
                  <Tooltip
                    cursor={{ fill: "var(--surface-subtle)" }}
                    contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--border-subtle)", borderRadius: 12, color: "var(--text-body)" }}
                  />
                  <Bar dataKey="added" name="Added" stackId="c" fill="var(--action)" />
                  <Bar dataKey="updated" name="Updated" stackId="c" fill="var(--sky-blue)" />
                  <Bar dataKey="removed" name="Removed" stackId="c" fill="var(--slate)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : null}
        </Card>
        <Card className="min-w-0 flex-[2_1_360px] gap-3.5 px-6">
          <CardHeading
            eyebrow="Latest changes"
            aside={
              <Link to="/changes" className="text-sm font-semibold">
                All changes
              </Link>
            }
          />
          {latest.data && latest.data.length === 0 ? <p className="m-0 text-sm text-text-muted">No changes recorded yet.</p> : null}
          <ul className="m-0 flex list-none flex-col p-0">
            {(latest.data ?? []).slice(0, 6).map((row) => (
              <li key={row.id} className="flex flex-col gap-1 border-b border-border-subtle py-3 last:border-b-0">
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <ChangeBadge change={row.change} />
                  <Link to={`/software/${row.title_id}`} className="font-semibold text-text-strong no-underline hover:underline">
                    {row.canonical_name}
                  </Link>
                </span>
                <span className="text-xs text-text-muted">
                  {row.detected_at ? formatDateTime(row.detected_at) : ""} · {row.hostname} · {row.from_version ?? "—"} → {row.to_version ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
