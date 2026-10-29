import { Link } from "react-router";
import { Radar } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AttentionBadge } from "@/components/shared/category-tag";
import { ChangeBadge } from "@/components/shared/change-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorLine } from "@/components/shared/error-line";
import { Eyebrow } from "@/components/shared/eyebrow";
import { KpiCard } from "@/components/shared/kpi-card";
import { PageHeader } from "@/components/shared/page-header";
import {
  fetchCycleOverview,
  fetchLatestChanges,
  fetchNeedsAttention,
  fetchOverviewStats,
  fetchWeeklyChanges,
} from "@/features/inventory/api";
import { useTenant } from "@/features/tenants/tenant-context";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { label, PLATFORM_LABEL, SOURCE_LABEL } from "@/lib/labels";
import { useLoad } from "@/lib/use-load";
import { CycleCard } from "@/features/inventory/cycle-card";
import { PolicyCard } from "@/features/policy/policy-card";
import { VulnOverviewCard } from "@/features/vulns/vuln-overview-card";

export function OverviewPage() {
  const { selectedTenantId } = useTenant();
  const key = selectedTenantId ?? "all";
  const stats = useLoad(`stats:${key}`, () => fetchOverviewStats(selectedTenantId));
  const cycles = useLoad(`cycles:${key}`, () => fetchCycleOverview(selectedTenantId));
  const attention = useLoad(`attention:${key}`, () => fetchNeedsAttention(selectedTenantId));
  const weeks = useLoad(`weeks:${key}`, () => fetchWeeklyChanges(selectedTenantId, 12));
  const latest = useLoad(`latest:${key}`, () => fetchLatestChanges(selectedTenantId, 8));
  const s = stats.data;

  const platforms = s ? Object.entries(s.computers_by_platform).map(([p, n]) => `${formatNumber(n)} ${label(PLATFORM_LABEL, p)}`).join(" · ") : "";

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Overview"
        description="Fleet coverage, this week's collection and what changed."
        actions={
          <Button asChild size="sm">
            <Link to="/scans">View scan status</Link>
          </Button>
        }
      />
      {stats.error ? <ErrorLine message={stats.error} /> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Computers" loading={stats.loading} value={formatNumber(s?.computers)} description={platforms || "No computers yet"} />
        <KpiCard
          label="Cycle coverage"
          loading={stats.loading}
          value={s?.coverage_pct === null || s?.coverage_pct === undefined ? "—" : s.coverage_pct}
          unit={s?.coverage_pct === null || s?.coverage_pct === undefined ? undefined : "%"}
          description="Collected in the open weekly cycle"
        />
        <KpiCard label="Software titles" loading={stats.loading} value={formatNumber(s?.titles)} description="Programs, extensions and packages" />
        <KpiCard
          label="Extensions"
          loading={stats.loading}
          value={formatNumber(s?.extension_installs)}
          description={`Installs of ${formatNumber(s?.distinct_extensions)} distinct extensions`}
        />
        <KpiCard
          label="Packages"
          loading={stats.loading}
          value={formatNumber(s?.package_installs)}
          description={s?.package_managers.length ? s.package_managers.map((m) => label(SOURCE_LABEL, m)).join(", ") : "npm, Chocolatey, pip, Homebrew"}
        />
        <KpiCard
          label="Changes · 7 days"
          loading={stats.loading}
          value={formatNumber(s?.changes_7d)}
          description={`${formatNumber(s?.added_7d)} added · ${formatNumber(s?.updated_7d)} updated · ${formatNumber(s?.removed_7d)} removed`}
        />
      </div>

      {s && s.computers > 0 ? <PolicyCard tenantId={selectedTenantId} /> : null}
      {s && s.computers > 0 ? <VulnOverviewCard tenantId={selectedTenantId} /> : null}

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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
        <CycleCard loading={cycles.loading} cycles={cycles.data ?? []} />
        <Card className="gap-4 px-6">
          <Eyebrow>Needs attention</Eyebrow>
          {attention.loading ? <Skeleton className="h-24 w-full" /> : null}
          {attention.data && attention.data.length === 0 ? (
            <p className="m-0 text-sm text-text-muted">No software in Review or Not allowed categories.</p>
          ) : null}
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {(attention.data ?? []).map((row) => (
              <li key={row.category_slug} className="flex flex-wrap items-center justify-between gap-2">
                <Link to={`/software?category=${encodeURIComponent(row.category_slug)}`} className="flex min-w-0 flex-col no-underline">
                  <span className="text-xs text-text-muted">{row.level1_name}</span>
                  <span className="text-sm text-text-strong">{row.level2_name}</span>
                </Link>
                <span className="flex items-center gap-2 text-sm text-text-muted">
                  <AttentionBadge level={row.attention_level} />
                  {formatNumber(row.computers)} computer{row.computers === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
        <Card className="gap-4 px-6">
          <Eyebrow>Changes per week</Eyebrow>
          {weeks.loading ? <Skeleton className="h-64 w-full" /> : null}
          {weeks.data ? (
            <div className="h-64 w-full" role="img" aria-label="Added, updated and removed items per week for the last 12 weeks">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeks.data.map((w) => ({ ...w, label: formatDate(`${w.week_start}T12:00:00Z`) }))}>
                  <CartesianGrid vertical={false} stroke="var(--border-subtle)" />
                  <XAxis dataKey="label" tick={{ fill: "var(--text-muted)", fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: "var(--text-muted)", fontSize: 12 }} tickLine={false} axisLine={false} width={40} />
                  <Tooltip
                    contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--border-subtle)", borderRadius: 8, color: "var(--text-body)" }}
                  />
                  <Legend />
                  <Bar dataKey="added" name="Added" stackId="c" fill="var(--status-safe)" />
                  <Bar dataKey="updated" name="Updated" stackId="c" fill="var(--sky-blue)" />
                  <Bar dataKey="removed" name="Removed" stackId="c" fill="var(--alert-red)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : null}
        </Card>
        <Card className="gap-4 px-6">
          <div className="flex items-center justify-between gap-2">
            <Eyebrow>Latest changes</Eyebrow>
            <Link to="/changes" className="text-sm">
              All changes
            </Link>
          </div>
          {latest.data && latest.data.length === 0 ? <p className="m-0 text-sm text-text-muted">No changes recorded yet.</p> : null}
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {(latest.data ?? []).map((row) => (
              <li key={row.id} className="flex flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <ChangeBadge change={row.change} />
                  <Link to={`/software/${row.title_id}`}>{row.canonical_name}</Link>
                </span>
                <span className="text-xs text-text-muted">
                  {row.hostname} · {row.from_version ?? "—"} → {row.to_version ?? "—"} · {row.detected_at ? formatDateTime(row.detected_at) : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
