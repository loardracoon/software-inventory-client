import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorLine } from "@/components/shared/error-line";
import { Field } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { useAuth } from "@/features/auth/auth-context";
import { AUDIT_PAGE, auditCsv, collectAuditPages, downloadCsv, fetchAuditLog, verifyAuditLog } from "@/features/audit/api";
import { fetchUsers } from "@/features/users/api";
import { formatDateTime } from "@/lib/format";
import { useLoad } from "@/lib/use-load";

export function AuditLogPage() {
  const { profile } = useAuth();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const rows = useLoad(`audit-${from}-${to}`, () => fetchAuditLog(from, to));
  const chain = useLoad("audit-verify", verifyAuditLog);
  const users = useLoad("audit-users", fetchUsers);
  const emails = new Map((users.data ?? []).map((u) => [u.id, u.email]));

  if (profile?.role !== "admin") return <PageHeader eyebrow="Administration" title="Audit log" description="Only admins can see the audit log." />;

  async function exportCsv() {
    try {
      downloadCsv(auditCsv(await collectAuditPages((before) => fetchAuditLog(from, to, AUDIT_PAGE, before)), emails));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export");
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Audit log"
        description="Every change is chained to the one before it. Rows are kept 400 days."
        actions={
          <Button variant="secondary" size="sm" onClick={() => void exportCsv()}>
            <Download aria-hidden="true" />
            Export CSV
          </Button>
        }
      />
      <Card className="gap-4 px-6">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="From" htmlFor="audit-from">
            <Input id="audit-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To" htmlFor="audit-to">
            <Input id="audit-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          {chain.data ? (
            chain.data.first_bad_id === null ? (
              <Badge color="safe" soft>{`Chain verified ✓ (${chain.data.checked} rows)`}</Badge>
            ) : (
              <Badge color="critical">{`Chain broken at #${chain.data.first_bad_id}`}</Badge>
            )
          ) : null}
        </div>
        {chain.error ? <ErrorLine message={chain.error} /> : null}
        {rows.error ? <ErrorLine message={rows.error} /> : null}
        {rows.loading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows.data ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{formatDateTime(r.created_at)}</TableCell>
                  <TableCell>{r.user_id ? (emails.get(r.user_id) ?? r.user_id) : "system"}</TableCell>
                  <TableCell>{r.action}</TableCell>
                  <TableCell>{r.target}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="m-0 text-xs text-text-muted">Showing the latest 500 rows of the range; Export CSV has all of them.</p>
      </Card>
    </>
  );
}
