import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorLine } from "@/components/shared/error-line";
import { Eyebrow } from "@/components/shared/eyebrow";
import { formatDate, formatNumber } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { fetchTitleVulns, nvdUrl, type TitleVulnRow } from "./api";
import { KevBadge, SeverityBadge } from "./vuln-badges";

const FIRST = 20;

function VulnItem({ v }: { v: TitleVulnRow }) {
  const versions = v.versions.map((x) => x || "no version");
  return (
    <li className="flex flex-col gap-1.5 border-t border-border-subtle pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <a href={nvdUrl(v.vuln_id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-sm font-semibold">
          {v.vuln_id}
          <ExternalLink aria-hidden="true" className="size-3" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        <SeverityBadge severity={v.severity} score={v.cvss_score} />
        {v.kev_added ? <KevBadge /> : null}
        {v.epss != null ? (
          <span className="text-xs text-text-muted" title="FIRST EPSS: probability of exploitation in the next 30 days">
            EPSS {(Number(v.epss) * 100).toFixed(1)}%
          </span>
        ) : null}
        {v.uncertain ? <span className="text-xs text-text-muted">May apply: the installed version is unknown</span> : null}
      </div>
      {v.summary ? <p className="m-0 line-clamp-3 text-sm">{v.summary}</p> : null}
      <p className="m-0 text-xs text-text-muted">
        Affects installed {versions.length === 1 ? "version" : "versions"} <span className="font-mono">{versions.join(", ")}</span> on{" "}
        {formatNumber(v.computers)} computer{v.computers === 1 ? "" : "s"}
        {v.fixed_in ? (
          <>
            {" "}
            · fixed in <span className="font-mono">{v.fixed_in}</span>
          </>
        ) : null}
        {v.kev_added ? ` · in CISA KEV since ${formatDate(v.kev_added)}${v.kev_due ? `, remediation due ${formatDate(v.kev_due)}` : ""}` : ""}
        {v.published ? ` · published ${formatDate(v.published)}` : ""}
      </p>
    </li>
  );
}

// The CVEs that affect the installed versions of this product (every spelling).
export function TitleVulnsCard({ titleId, tenantId }: { titleId: string; tenantId: string | null }) {
  const [all, setAll] = useState(false);
  const vulns = useLoad(`title-vulns:${titleId}:${tenantId ?? "all"}`, () => fetchTitleVulns(titleId, tenantId));
  const rows = vulns.data ?? [];
  const shown = all ? rows : rows.slice(0, FIRST);
  return (
    <Card className="gap-4 px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>Known vulnerabilities</Eyebrow>
        <span className="text-xs text-text-muted">CVE data from the Dictionary Hub (NVD, OSV, CISA KEV, FIRST EPSS)</span>
      </div>
      {vulns.error ? <ErrorLine message={vulns.error} /> : null}
      {vulns.loading ? <Skeleton className="h-16 w-full" /> : null}
      {vulns.data && rows.length === 0 ? <p className="m-0 text-sm text-text-muted">No known vulnerabilities affect the installed versions.</p> : null}
      {shown.length ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Known vulnerabilities">
          {shown.map((v) => (
            <VulnItem key={v.vuln_id} v={v} />
          ))}
        </ul>
      ) : null}
      {rows.length > FIRST ? (
        <Button variant="outline" size="sm" className="self-start" onClick={() => setAll((x) => !x)}>
          {all ? "Show fewer" : `Show all ${formatNumber(rows.length)}`}
        </Button>
      ) : null}
    </Card>
  );
}
