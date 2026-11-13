import { useRef, useState, type FormEvent } from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/shared/filters";
import { useAuth } from "@/features/auth/auth-context";
import { importComputerContext, setComputerContext, type ContextImportResult } from "./api";

export const CRITICALITY_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "critical", label: "critical" },
];

// Admins and operators change the context; viewers only see it. The server enforces the same rule.
export function useCanEditContext(): boolean {
  const { profile } = useAuth();
  return profile?.role === "admin" || profile?.role === "operator";
}

// RFC 4180: quoted fields with "" escapes, CRLF or LF, an optional BOM; blank lines are skipped.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const endRow = () => {
    row.push(field);
    field = "";
    if (row.some((cell) => cell !== "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRow();
    } else field += ch;
  }
  if (field !== "" || row.length) endRow();
  return rows;
}

const COLUMNS = ["endpoint_id", "hostname", "owner", "department", "criticality", "scope_tags"];

// Header required (case-insensitive); unknown columns are ignored; a column that is absent leaves the value unchanged.
export function csvToImportRows(text: string): Record<string, string>[] {
  const [header, ...body] = parseCsv(text);
  const names = (header ?? []).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  if (!names.includes("endpoint_id") && !names.includes("hostname")) throw new Error("The CSV needs a header with endpoint_id or hostname");
  const use = COLUMNS.filter((c) => names.includes(c));
  return body.map((cells) => Object.fromEntries(use.map((c) => [c, (cells[names.indexOf(c)] ?? "").trim()])));
}

export type ContextValues = { owner: string | null; department: string | null; criticality: string | null; scope_tags: string[] };

// "Edit context" for one computer.
export function EditContextButton({ computerId, values, onSaved }: { computerId: string; values: ContextValues; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Edit context
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          {open ? (
            <ContextForm
              computerId={computerId}
              values={values}
              onCancel={() => setOpen(false)}
              onSaved={() => {
                setOpen(false);
                onSaved();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ContextForm({ computerId, values, onCancel, onSaved }: { computerId: string; values: ContextValues; onCancel: () => void; onSaved: () => void }) {
  const [owner, setOwner] = useState(values.owner ?? "");
  const [department, setDepartment] = useState(values.department ?? "");
  const [criticality, setCriticality] = useState(values.criticality ?? "");
  const [tags, setTags] = useState(values.scope_tags.join(", "));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await setComputerContext([computerId], {
        owner,
        department,
        criticality,
        scopeTags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      toast.success("Context saved");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the context");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Edit context</DialogTitle>
        <DialogDescription>Owner, department, criticality and scope for audits. The Sophos Central sync never changes these values.</DialogDescription>
      </DialogHeader>
      <Field label="Owner" htmlFor="ctx-owner">
        <Input id="ctx-owner" maxLength={200} placeholder="A name or an email" value={owner} onChange={(e) => setOwner(e.target.value)} />
      </Field>
      <Field label="Department" htmlFor="ctx-department">
        <Input id="ctx-department" maxLength={200} value={department} onChange={(e) => setDepartment(e.target.value)} />
      </Field>
      <Field label="Criticality" htmlFor="ctx-criticality">
        <NativeSelect id="ctx-criticality" value={criticality} onChange={setCriticality} options={CRITICALITY_OPTIONS} />
      </Field>
      <Field label="Scope tags" htmlFor="ctx-tags">
        <Input id="ctx-tags" placeholder="pci, iso27001 (up to 10, separated by commas)" value={tags} onChange={(e) => setTags(e.target.value)} />
      </Field>
      {error ? (
        <p role="alert" className="m-0 text-sm text-text-critical">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

// "Import CSV": endpoint_id,hostname,owner,department,criticality,scope_tags (tags separated by ";").
export function ImportContextButton({ tenantId, onDone }: { tenantId: string | null; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ContextImportResult | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      setResult(await importComputerContext(tenantId!, csvToImportRows(await file.text())));
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not import the CSV");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <>
      <input ref={input} type="file" accept=".csv,text/csv" aria-label="CSV file" className="sr-only" tabIndex={-1} onChange={(e) => void onFile(e.target.files?.[0])} />
      <Button variant="secondary" size="sm" disabled={busy || !tenantId} title={tenantId ? undefined : "Select one tenant to import"} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
        Import CSV
      </Button>
      <Dialog open={result !== null} onOpenChange={(open) => (open ? null : setResult(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import finished</DialogTitle>
            <DialogDescription>
              {result?.applied} applied{result?.errors.length ? `, ${result.errors.length} with errors (nothing changed for them)` : ""}
            </DialogDescription>
          </DialogHeader>
          {result?.errors.length ? (
            <ul className="m-0 max-h-64 overflow-auto pl-5 text-sm">
              {result.errors.map((e) => (
                <li key={e.row}>
                  Row {e.row}: {e.message}
                </li>
              ))}
            </ul>
          ) : null}
          <DialogFooter>
            <Button size="sm" onClick={() => setResult(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
