import { useState, type FormEvent } from "react";
import { Copy, Download, FileCheck2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorLine } from "@/components/shared/error-line";
import { Field, NativeSelect } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { InventoryReviewCard } from "@/features/reports/review-card";
import { useCanEditContext } from "@/features/inventory/computer-context";
import { downloadAuditReport, fetchAuditReports, fetchScopeTags, generateAuditReport } from "@/features/reports/api";
import { useTenant } from "@/features/tenants/tenant-context";
import { formatDateTime } from "@/lib/format";
import { useLoad } from "@/lib/use-load";

// "YYYY-MM-DDTHH:mm" in the browser's time zone, the value of a datetime-local input.
function localNow(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function copyHash(hash: string) {
  void navigator.clipboard?.writeText(hash).then(
    () => toast.success("Hash copied"),
    () => toast.error("Could not copy"),
  );
}

async function download(id: string, onBusy?: (busy: boolean) => void) {
  onBusy?.(true);
  try {
    await downloadAuditReport(id);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Download failed");
  } finally {
    onBusy?.(false);
  }
}

export function ReportsPage() {
  const { tenants, selectedTenantId } = useTenant();
  const canGenerate = useCanEditContext();
  // "All tenants" with several tenants: a package and a review belong to one tenant, so the user picks it first.
  const tenantId = selectedTenantId ?? (tenants.length === 1 ? tenants[0].id : null);
  const tenantName = tenants.find((t) => t.id === tenantId)?.name ?? "";
  const [asOf, setAsOf] = useState(localNow);
  const [scopeTag, setScopeTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const reports = useLoad(`reports:${tenantId}`, () => (tenantId ? fetchAuditReports(tenantId) : Promise.resolve([])));
  const tags = useLoad(`report-tags:${tenantId}`, () => (tenantId && canGenerate ? fetchScopeTags(tenantId) : Promise.resolve([])));

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!tenantId) return;
    setBusy(true);
    try {
      const result = await generateAuditReport({ tenantId, asOf: new Date(asOf).toISOString(), scopeTag: scopeTag || null });
      toast.success(`Package generated. SHA-256 ${result.manifest_sha256.slice(0, 12)}`, {
        action: { label: "Download", onClick: () => void download(result.report_id) },
      });
      reports.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate the package");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Audit"
        title="Reports"
        description="Evidence packages for auditors: a dated ZIP with the inventory, vulnerabilities, policy and a manifest with SHA-256 hashes. A package is kept as generated and downloads unchanged."
      />
      {!tenantId ? (
        <p className="m-0 text-sm text-text-muted">Select a tenant to generate packages or record reviews</p>
      ) : canGenerate ? (
        <Card className="flex flex-col gap-3 p-5">
          <p className="m-0 text-sm font-semibold text-text-strong">Tenant: {tenantName}</p>
          <form onSubmit={generate} className="flex flex-wrap items-end gap-4">
            <Field label="Inventory as of" htmlFor="report-as-of" className="w-60">
              <input
                id="report-as-of"
                type="datetime-local"
                value={asOf}
                max={localNow()}
                onChange={(e) => setAsOf(e.target.value)}
                required
                className="h-10 w-full rounded-sm border-[1.5px] border-input bg-surface-raised px-3 text-[15px] text-text-body"
              />
            </Field>
            <Field label="Scope tag (optional)" htmlFor="report-scope" className="w-60">
              <NativeSelect
                id="report-scope"
                value={scopeTag}
                onChange={setScopeTag}
                options={[{ value: "", label: "All computers" }, ...(tags.data ?? []).map((t) => ({ value: t, label: t }))]}
              />
            </Field>
            <Button type="submit" disabled={busy || !asOf}>
              {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <FileCheck2 aria-hidden="true" />}
              Generate package
            </Button>
          </form>
        </Card>
      ) : (
        <p className="m-0 text-sm text-text-muted">Only admins and operators can download packages, because they contain user names.</p>
      )}
      {tenantId ? <InventoryReviewCard tenantId={tenantId} tenantName={tenantName} reports={reports.data ?? []} /> : null}
      {reports.error ? <ErrorLine message={reports.error} /> : null}
      {!tenantId ? null : reports.data && reports.data.length === 0 ? (
        <EmptyState title="No packages yet" description="Generated packages appear here and are never deleted." />
      ) : reports.data ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Generated</TableHead>
              <TableHead>Inventory as of</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>By</TableHead>
              <TableHead>SHA-256</TableHead>
              {canGenerate ? <TableHead>Package</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {reports.data.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{formatDateTime(r.generated_at)}</TableCell>
                <TableCell>{formatDateTime(r.as_of)}</TableCell>
                <TableCell>{r.scope_tag ?? "All computers"}</TableCell>
                <TableCell>{r.generated_by_email ?? "—"}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1 font-mono text-[13px]">
                    {r.manifest_sha256.slice(0, 12)}
                    <Button variant="ghost" size="icon" aria-label={`Copy hash ${r.manifest_sha256.slice(0, 12)}`} onClick={() => copyHash(r.manifest_sha256)}>
                      <Copy aria-hidden="true" />
                    </Button>
                  </span>
                </TableCell>
                {canGenerate ? (
                  <TableCell>
                    <Button variant="outline" size="sm" disabled={downloading === r.id} onClick={() => void download(r.id, (b) => setDownloading(b ? r.id : null))}>
                      {downloading === r.id ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
                      Download
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}
