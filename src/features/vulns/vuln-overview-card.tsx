import { Link } from "react-router";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorLine } from "@/components/shared/error-line";
import { CardHeading, StatTile } from "@/components/shared/overview-widget";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { fetchOverdueSummary, fetchVulnOverview, type VulnOverview } from "./api";

const plural = (n: number, one: string, many = `${one}s`) => `${formatNumber(n)} ${n === 1 ? one : many}`;

function headline(v: VulnOverview): string {
  if (v.kev > 0) return `${plural(v.kev, "known-exploited CVE")} reach ${plural(v.kev_computers, "computer")}`;
  if (v.vulns > 0) return `${plural(v.vulns, "CVE")} affect ${plural(v.titles, "installed title")}, none known exploited`;
  return "No known CVE affects an installed version";
}

// Overview: known CVEs that affect installed versions (Phase 10b).
export function VulnOverviewCard({ tenantId }: { tenantId: string | null }) {
  const data = useLoad(`vuln-overview:${tenantId ?? "all"}`, () => fetchVulnOverview(tenantId));
  const overdue = useLoad(`vuln-overdue:${tenantId ?? "all"}`, () => fetchOverdueSummary(tenantId)).data;
  const v = data.data;
  return (
    <Card className="gap-5 px-6">
      <CardHeading
        eyebrow="Vulnerabilities · installed applications"
        headline={v && v.cached > 0 ? headline(v) : undefined}
        aside={
          <Link to="/software?vuln=any" className="text-sm font-semibold">
            All vulnerable software
          </Link>
        }
      />
      {v?.evaluated_at ? (
        <span className="-mt-2 text-xs text-text-muted">
          Installed versions matched to CVE records and the CISA Known Exploited Vulnerabilities catalog · last match {formatDateTime(v.evaluated_at)}
        </span>
      ) : null}
      {data.error ? <ErrorLine message={data.error} /> : null}
      {data.loading ? <Skeleton className="h-20 w-full" /> : null}
      {v && v.cached === 0 ? (
        <p className="m-0 text-sm text-text-muted">
          No CVE data yet. The Dictionary Hub sends it with the dictionary; an admin can start a sync in{" "}
          <Link to="/settings">Settings</Link>.
        </p>
      ) : null}
      {v && v.cached > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
          <StatTile
            to="/software?vuln=kev"
            value={v.kev}
            label="Known exploited CVEs"
            detail={`${plural(v.kev_installations, "installation")} on ${plural(v.kev_computers, "computer")}`}
            alert
          />
          <StatTile
            to="/remediation"
            value={overdue?.overdue ?? 0}
            label="Overdue vulnerabilities"
            detail={`${formatNumber(overdue?.critical ?? 0)} critical · ${formatNumber(overdue?.high ?? 0)} high`}
            alert
          />
          <StatTile to="/software?vuln=critical" value={v.critical} label="Critical CVEs" alert />
          <StatTile to="/software?vuln=high" value={v.high} label="High CVEs" />
          <StatTile to="/software?vuln=any" value={v.titles} label="Affected titles" detail={`${formatNumber(v.vulns)} CVEs in total`} />
          <StatTile
            to="/software?vuln=possible"
            value={v.possible}
            label="CVEs that may apply"
            detail={`${plural(v.possible_titles, "title")} · no version to compare`}
          />
        </div>
      ) : null}
    </Card>
  );
}
