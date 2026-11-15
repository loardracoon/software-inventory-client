import { useState } from "react";
import { Link } from "react-router";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorLine } from "@/components/shared/error-line";
import { Field, NativeSelect } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { downloadCsv } from "@/features/audit/api";
import { SeverityBadge } from "@/features/vulns/vuln-badges";
import { FINDING_STATUS_LABEL, dueLabel, fetchFindings, findingsToCsv, type FindingStatus } from "@/features/vulns/api";
import { useTenant } from "@/features/tenants/tenant-context";
import { formatDateTime } from "@/lib/format";
import { useLoad } from "@/lib/use-load";

const PAGE = 100;
const STATUS_OPTIONS = [
  { value: "", label: "Not resolved" },
  ...Object.entries(FINDING_STATUS_LABEL).map(([value, label]) => ({ value, label })),
];
const SEVERITY_OPTIONS = [{ value: "", label: "Any" }, ...["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))];

// Remediation (Stage 3): every certain vulnerability match with its due date; overdue ones first.
export function RemediationPage() {
  const { selectedTenantId } = useTenant();
  const [status, setStatus] = useState<FindingStatus>("");
  const [severity, setSeverity] = useState("");
  const [kev, setKev] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const filters = { tenantId: selectedTenantId, status, severity, kev: kev === "kev", search };
  const data = useLoad(`findings:${JSON.stringify(filters)}:${page}`, () => fetchFindings(filters, { pageIndex: page, pageSize: PAGE, sorting: [], signal: new AbortController().signal }));
  const rows = data.data?.rows ?? [];
  const total = data.data?.rowCount ?? 0;
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(0);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Risk"
        title="Remediation"
        description="Known vulnerabilities on installed software, each with a due date from its severity (set in Scans) or the CISA date when earlier. A finding closes when the software is updated or removed."
        actions={
          <Button variant="outline" disabled={rows.length === 0} onClick={() => downloadCsv(findingsToCsv(rows), "remediation")}>
            <Download aria-hidden /> Export CSV
          </Button>
        }
      />
      <Card className="grid gap-3 px-6 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Status" htmlFor="f-status">
          <NativeSelect id="f-status" value={status} onChange={reset((v: string) => setStatus(v as FindingStatus))} options={STATUS_OPTIONS} />
        </Field>
        <Field label="Severity" htmlFor="f-severity">
          <NativeSelect id="f-severity" value={severity} onChange={reset(setSeverity)} options={SEVERITY_OPTIONS} />
        </Field>
        <Field label="Exploited" htmlFor="f-kev">
          <NativeSelect id="f-kev" value={kev} onChange={reset(setKev)} options={[{ value: "", label: "Any" }, { value: "kev", label: "Known exploited (KEV)" }]} />
        </Field>
        <Field label="Search" htmlFor="f-search">
          <Input id="f-search" value={search} placeholder="Software or CVE" onChange={(e) => reset(setSearch)(e.target.value)} />
        </Field>
      </Card>
      {data.error ? <ErrorLine message={data.error} /> : null}
      {!data.loading && !data.error && rows.length === 0 ? <EmptyState title="No findings" description="Nothing matches these filters." /> : null}
      {rows.length > 0 ? (
        <Card className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CVE</TableHead>
                <TableHead>Software</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Computers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    {r.vuln_id} {r.kev ? <Badge color="critical" soft>KEV</Badge> : null}
                  </TableCell>
                  <TableCell>
                    <Link to={`/software/${r.title_id}`}>{r.canonical_name}</Link> {r.version}
                  </TableCell>
                  <TableCell><SeverityBadge severity={r.severity} /></TableCell>
                  <TableCell>{FINDING_STATUS_LABEL[r.status as keyof typeof FINDING_STATUS_LABEL] ?? r.status}</TableCell>
                  <TableCell title={r.due_at ? formatDateTime(r.due_at) : undefined}>{dueLabel(r)}</TableCell>
                  <TableCell className="text-right">{r.status?.startsWith("resolved") ? "" : r.computers}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between px-6 py-3 text-sm text-text-muted">
            <span>{total} finding{total === 1 ? "" : "s"}</span>
            <span className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Next</Button>
            </span>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
