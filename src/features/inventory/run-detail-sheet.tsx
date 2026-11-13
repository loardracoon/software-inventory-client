// Scans › Recent runs drawer: what came back from one run, per computer — task status and message, row count,
// stored size, ingest status and a simple table of the first rows. For troubleshooting, not for reading inventory.
import { Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorLine } from "@/components/shared/error-line";
import { asScanStatus, StatusBadge } from "@/components/shared/status-badge";
import { fetchRunDetail, type RunDetailComputer } from "@/features/inventory/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useLoad } from "@/lib/use-load";

const CELL_MAX = 80;
const PROVIDER: Record<string, string> = { live_endpoint_search: "Live Endpoint Search", live_discover_rest: "Live Discover REST", data_lake: "Sophos Data Lake" };

const text = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v));
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

export function RunDetailSheet({ runId, onClose }: { runId: string | null; onClose: () => void }) {
  return (
    <Sheet open={runId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-3xl">
        {runId ? <RunDetailBody runId={runId} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function RunDetailBody({ runId }: { runId: string }) {
  const detail = useLoad(`run-detail:${runId}`, () => fetchRunDetail(runId));
  const d = detail.data;
  return (
    <>
      <SheetHeader className="border-b border-border-subtle">
        <SheetTitle className="font-mono text-base">{d ? `${d.run.query_name ?? d.run.domain}.v${d.run.query_version}` : "Run"}</SheetTitle>
        <SheetDescription>
          {d
            ? `${PROVIDER[d.run.provider] ?? d.run.provider} · ${d.run.platform} · ${d.run.status}${d.run.cancelled ? " (cancelled)" : ""} · started ${formatDateTime(d.run.started_at)}${
                d.run.finished_at ? `, finished ${formatDateTime(d.run.finished_at)}` : ""
              } · ${formatNumber(d.run.endpoints)} computers`
            : "Loading the run…"}
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-4 p-4">
        {detail.loading ? <Loader2 className="animate-spin text-text-muted" aria-label="Loading" /> : null}
        {detail.error ? <ErrorLine message={detail.error} /> : null}
        {!detail.loading && !detail.error && !d ? <p className="m-0 text-sm text-text-muted">This run is not available.</p> : null}
        {d?.run.error ? <ErrorLine message={d.run.error} /> : null}
        {d && !d.preview_allowed ? (
          <p className="m-0 text-sm text-text-muted">Only admins and operators see the rows: they can hold user names and paths.</p>
        ) : null}
        {d?.computers.map((c) => <ComputerResult key={c.computer_id} c={c} />)}
      </div>
    </>
  );
}

function ComputerResult({ c }: { c: RunDetailComputer }) {
  const columns = c.rows ? [...new Set(c.rows.flatMap((r) => Object.keys(r)))] : [];
  return (
    <section className="flex flex-col gap-2 rounded-md border border-border-subtle p-3" aria-label={c.hostname}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-sm font-semibold">{c.hostname}</h3>
        {c.task_status ? <StatusBadge status={asScanStatus(c.task_status)} label={c.task_status.replace(/_/g, " ")} /> : null}
        <span className="text-xs text-text-muted">
          {c.row_count === null ? "no result stored" : `${formatNumber(c.row_count)} rows · ${kb(c.bytes ?? 0)}`}
          {c.received_at ? ` · received ${formatDateTime(c.received_at)}` : ""}
          {c.ingested_at ? " · ingested" : c.row_count !== null ? " · not ingested yet" : ""}
        </span>
      </div>
      {c.last_error ? <p className="m-0 text-sm text-text-critical">{c.last_error}</p> : null}
      {c.ingest_error ? <p className="m-0 text-sm text-text-critical">Ingest error: {c.ingest_error}</p> : null}
      {c.rows && c.rows.length > 0 ? (
        <>
          <p className="m-0 text-xs text-text-muted">
            Preview: first {c.rows.length} of {formatNumber(c.row_count)} rows, as stored.
          </p>
          <div className="overflow-x-auto">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  {columns.map((k) => (
                    <TableHead key={k} className="font-mono">
                      {k}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.rows.map((r, i) => (
                  <TableRow key={i}>
                    {columns.map((k) => {
                      const v = text(r[k]);
                      return (
                        <TableCell key={k} className="max-w-[24rem] font-mono whitespace-nowrap" title={v.length > CELL_MAX ? v : undefined}>
                          {v.length > CELL_MAX ? `${v.slice(0, CELL_MAX)}…` : v}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : null}
    </section>
  );
}
