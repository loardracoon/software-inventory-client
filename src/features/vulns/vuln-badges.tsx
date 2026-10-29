import { ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/format";

const SEVERITY_COLOR = { CRITICAL: "critical", HIGH: "high", MEDIUM: "medium", LOW: "low", NONE: "slate" } as const;

export function SeverityBadge({ severity, score }: { severity: string | null; score?: number | null }) {
  const color = SEVERITY_COLOR[(severity ?? "NONE") as keyof typeof SEVERITY_COLOR] ?? "slate";
  const text = severity ? severity.charAt(0) + severity.slice(1).toLowerCase() : "No score";
  return (
    <Badge color={color} soft>
      {text}
      {score != null ? ` ${Number(score).toFixed(1)}` : ""}
    </Badge>
  );
}

export function KevBadge() {
  return (
    <Badge color="critical">
      <ShieldAlert aria-hidden="true" />
      Known exploited
    </Badge>
  );
}

// Counts of one product or installation. Nothing when there is nothing to show.
export function VulnSummary({ vulns, kev, critical, high, possible, maxCvss }: {
  vulns: number;
  kev: number;
  critical?: number;
  high?: number;
  possible?: number;
  maxCvss?: number | null;
}) {
  if (!vulns && !possible) return <span className="text-text-muted">—</span>;
  return (
    <div className="flex flex-col items-start gap-1">
      {kev > 0 ? <KevBadge /> : null}
      {vulns > 0 ? (
        <span className="text-sm">
          {formatNumber(vulns)} CVE{vulns === 1 ? "" : "s"}
          {maxCvss != null ? <span className="text-text-muted"> · max {Number(maxCvss).toFixed(1)}</span> : null}
        </span>
      ) : null}
      {critical || high ? (
        <span className="text-xs text-text-muted">
          {[critical ? `${critical} critical` : "", high ? `${high} high` : ""].filter(Boolean).join(" · ")}
        </span>
      ) : null}
      {possible ? <span className="text-xs text-text-muted">{formatNumber(possible)} may apply (version unknown)</span> : null}
    </div>
  );
}
