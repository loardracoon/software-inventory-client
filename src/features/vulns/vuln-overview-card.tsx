import { Link } from "react-router";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorLine } from "@/components/shared/error-line";
import { Eyebrow } from "@/components/shared/eyebrow";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";
import { fetchVulnOverview } from "./api";

function Stat({ to, value, label, detail, alert }: { to: string; value: number; label: string; detail?: string; alert?: boolean }) {
  return (
    <Link to={to} className="flex flex-col gap-0.5 rounded-md border border-border-subtle p-3 no-underline hover:bg-surface-subtle">
      <span className={cn("text-2xl font-semibold", alert && value > 0 ? "text-text-critical" : "text-text-strong")}>{formatNumber(value)}</span>
      <span className="text-sm text-text-strong">{label}</span>
      {detail ? <span className="text-xs text-text-muted">{detail}</span> : null}
    </Link>
  );
}

// Overview: known CVEs that affect installed versions (Phase 10b).
export function VulnOverviewCard({ tenantId }: { tenantId: string | null }) {
  const data = useLoad(`vuln-overview:${tenantId ?? "all"}`, () => fetchVulnOverview(tenantId));
  const v = data.data;
  return (
    <Card className="gap-4 px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>Known vulnerabilities</Eyebrow>
        {v?.evaluated_at ? <span className="text-xs text-text-muted">Matched {formatDateTime(v.evaluated_at)}</span> : null}
      </div>
      {data.error ? <ErrorLine message={data.error} /> : null}
      {data.loading ? <Skeleton className="h-20 w-full" /> : null}
      {v && v.cached === 0 ? (
        <p className="m-0 text-sm text-text-muted">
          No CVE data yet. The Dictionary Hub sends it with the dictionary; an admin can start a sync in{" "}
          <Link to="/settings">Settings</Link>.
        </p>
      ) : null}
      {v && v.cached > 0 ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat
            to="/software?vuln=kev"
            value={v.kev}
            label="Known exploited CVEs"
            detail={`${formatNumber(v.kev_installations)} installation${v.kev_installations === 1 ? "" : "s"} on ${formatNumber(v.kev_computers)} computer${v.kev_computers === 1 ? "" : "s"}`}
            alert
          />
          <Stat to="/software?vuln=critical" value={v.critical} label="Critical CVEs" alert />
          <Stat to="/software?vuln=high" value={v.high} label="High CVEs" />
          <Stat to="/software?vuln=any" value={v.titles} label="Affected titles" detail={`${formatNumber(v.vulns)} CVEs in total`} />
          <Stat
            to="/software?vuln=possible"
            value={v.possible}
            label="CVEs that may apply"
            detail={`${formatNumber(v.possible_titles)} title${v.possible_titles === 1 ? "" : "s"} · no version to compare`}
          />
        </div>
      ) : null}
    </Card>
  );
}
