import { useState, type FormEvent } from "react";
import { ClipboardCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorLine } from "@/components/shared/error-line";
import { Field, NativeSelect } from "@/components/shared/filters";
import { useAuth } from "@/features/auth/auth-context";
import { fetchInventoryReviews, fetchReviewStatus, recordInventoryReview, type AuditReportRow, type ReviewOutcome } from "@/features/reports/api";
import { formatDateTime } from "@/lib/format";
import { useLoad } from "@/lib/use-load";

const OUTCOME_LABEL: Record<string, string> = { accurate: "Accurate", accurate_with_changes: "Accurate with changes" };
const DEFAULT_STATEMENT = "I reviewed the inventory in the attached evidence package and confirm it reflects the assets in scope.";
const WEEK_MS = 7 * 86_400_000;
const CONTROL =
  "w-full min-w-0 rounded-sm border-[1.5px] border-input bg-surface-raised px-3 py-2 text-[15px] text-text-body focus-visible:border-action focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none";

function ReviewDialog({ packages, onClose, onDone }: { packages: AuditReportRow[]; onClose: () => void; onDone: () => void }) {
  const [reportId, setReportId] = useState(packages[0]?.id ?? "");
  const [outcome, setOutcome] = useState<ReviewOutcome>("accurate");
  const [statement, setStatement] = useState(DEFAULT_STATEMENT);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await recordInventoryReview({ reportId, outcome, statement: statement.trim(), notes: notes.trim() || null });
      toast.success("Review recorded");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the review");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Record inventory review</DialogTitle>
            <DialogDescription>Your email and the time are stored with the review. A review needs a package generated in the last 7 days.</DialogDescription>
          </DialogHeader>
          {packages.length === 0 ? (
            <p role="alert" className="m-0 text-sm text-text-critical">
              Generate a new evidence package first (the last one is older than 7 days).
            </p>
          ) : (
            <Field label="Evidence package" htmlFor="review-package">
              <NativeSelect
                id="review-package"
                value={reportId}
                onChange={setReportId}
                options={packages.map((p) => ({ value: p.id, label: `${formatDateTime(p.generated_at)} · ${p.manifest_sha256.slice(0, 12)}` }))}
              />
            </Field>
          )}
          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className="mb-1.5 p-0 text-[13px] font-semibold text-text-strong">Outcome</legend>
            {(["accurate", "accurate_with_changes"] as const).map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm text-text-body">
                <input type="radio" name="review-outcome" checked={outcome === o} onChange={() => setOutcome(o)} />
                {OUTCOME_LABEL[o]}
              </label>
            ))}
          </fieldset>
          <Field label="Statement" htmlFor="review-statement">
            <textarea id="review-statement" rows={3} required minLength={20} maxLength={2000} value={statement} onChange={(e) => setStatement(e.target.value)} className={CONTROL} />
          </Field>
          <Field label="Notes (optional)" htmlFor="review-notes">
            <textarea id="review-notes" rows={3} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} className={CONTROL} />
          </Field>
          {error ? <ErrorLine message={error} /> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving || !reportId}>
              {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Save review
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Periodic inventory review (PCI DSS 12.5.1): who reviewed, when, against which package. Only tenant admins record.
export function InventoryReviewCard({ tenantId, reports }: { tenantId: string; reports: AuditReportRow[] }) {
  const { profile } = useAuth();
  const [open, setOpen] = useState<AuditReportRow[] | null>(null);
  const status = useLoad(`review-status:${tenantId}`, () => fetchReviewStatus(tenantId));
  const history = useLoad(`reviews:${tenantId}`, () => fetchInventoryReviews(tenantId));
  const s = status.data;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-base font-semibold text-text-strong">Inventory review</h2>
          {s?.last_reviewed_at ? (
            <p className="m-0 text-sm text-text-body">
              Last review {formatDateTime(s.last_reviewed_at)} by {s.last_reviewer}
            </p>
          ) : (
            <p className="m-0 text-sm text-text-muted">No review recorded yet.</p>
          )}
          {s ? (
            <p className="m-0 flex items-center gap-2 text-sm text-text-body">
              Next review due {formatDateTime(s.due_at)}
              {s.overdue ? (
                <Badge color="critical" soft>
                  Overdue
                </Badge>
              ) : null}
            </p>
          ) : null}
        </div>
        {profile?.role === "admin" ? (
          <Button size="sm" onClick={() => setOpen(reports.filter((r) => Date.now() - new Date(r.generated_at).getTime() < WEEK_MS))}>
            <ClipboardCheck aria-hidden="true" />
            Record review
          </Button>
        ) : null}
      </div>
      {status.error ? <ErrorLine message={status.error} /> : null}
      {history.error ? <ErrorLine message={history.error} /> : null}
      {history.data && history.data.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reviewed</TableHead>
              <TableHead>By</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Package</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.data.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{formatDateTime(r.reviewed_at)}</TableCell>
                <TableCell>{r.reviewer_email}</TableCell>
                <TableCell>{OUTCOME_LABEL[r.outcome] ?? r.outcome}</TableCell>
                <TableCell className="font-mono text-[13px]">{reports.find((p) => p.id === r.report_id)?.manifest_sha256.slice(0, 12) ?? r.report_id.slice(0, 8)}</TableCell>
                <TableCell>{r.notes ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      {open ? (
        <ReviewDialog
          // The server rule: generated in the last 7 days.
          packages={open}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            status.reload();
            history.reload();
          }}
        />
      ) : null}
    </Card>
  );
}
