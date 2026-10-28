import { useMemo, useState, type FormEvent } from "react";
import { Loader2, MessageSquareWarning, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Eyebrow } from "@/components/shared/eyebrow";
import { Field, NativeSelect } from "@/components/shared/filters";
import { useAuth } from "@/features/auth/auth-context";
import { fetchCategories } from "@/features/inventory/api";
import { formatDate } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import {
  fetchLocalOverride,
  fetchTitleRequests,
  removeLocalOverride,
  saveLocalOverride,
  useCanContribute,
  type AttentionLevel,
  type ReclassificationRequest,
} from "./api";
import { subcategoryOptions } from "./category-options";
import { ReclassifyDialog } from "./reclassify-dialog";

const STATUS_LABEL: Record<string, { label: string; color: "info" | "safe" | "critical" | "slate" }> = {
  open: { label: "Open", color: "info" },
  accepted: { label: "Accepted", color: "safe" },
  rejected: { label: "Rejected", color: "critical" },
  superseded: { label: "Superseded", color: "slate" },
};

// Title page: "Request reclassification" (admins, operators), local override (admins) and the
// title's requests with the hub admin's answer.
export function TitleClassificationActions({ titleId, name, currentCategory, onChanged }: { titleId: string; name: string; currentCategory: string | null; onChanged: () => void }) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const canContribute = useCanContribute();
  const requests = useLoad(`requests:${titleId}`, () => fetchTitleRequests(titleId));
  const override = useLoad(`override:${titleId}`, () => fetchLocalOverride(titleId));
  const [reclassifying, setReclassifying] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const open = (requests.data ?? []).find((r) => r.status === "open");

  async function removeOverride() {
    try {
      await removeLocalOverride(titleId);
      toast.success("Local override removed");
      override.reload();
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the override");
    }
  }

  return (
    <>
      {open ? (
        <Badge color="info" soft>
          <MessageSquareWarning aria-hidden="true" />
          Reclassification requested · {open.hub_request_id}
        </Badge>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canContribute && !open ? (
          <Button size="sm" variant="secondary" onClick={() => setReclassifying(true)}>
            Request reclassification
          </Button>
        ) : null}
        {isAdmin ? (
          <Button size="sm" variant="secondary" onClick={() => setOverriding(true)}>
            <ShieldCheck aria-hidden="true" />
            {override.data ? "Change local override" : "Set local override"}
          </Button>
        ) : null}
        {isAdmin && override.data ? (
          <Button size="sm" variant="ghost" className="text-text-critical" onClick={() => void removeOverride()}>
            Remove override
          </Button>
        ) : null}
      </div>
      {override.data?.note ? <p className="m-0 text-xs text-text-muted">Override note: {override.data.note}</p> : null}
      <ReclassifyDialog
        target={reclassifying ? { titleId, name, currentCategory } : null}
        onOpenChange={setReclassifying}
        onRequested={() => {
          setReclassifying(false);
          requests.reload();
          onChanged();
        }}
      />
      <OverrideDialog
        open={overriding}
        onOpenChange={setOverriding}
        titleId={titleId}
        name={name}
        initial={override.data ? { slug: override.data.category_slug, attention: override.data.attention_level, note: override.data.note ?? "" } : null}
        onSaved={() => {
          setOverriding(false);
          override.reload();
          onChanged();
        }}
      />
    </>
  );
}

export function TitleRequestsCard({ titleId, refreshKey }: { titleId: string; refreshKey: number }) {
  const requests = useLoad(`requests:${titleId}:${refreshKey}`, () => fetchTitleRequests(titleId));
  const categories = useLoad("categories", fetchCategories);
  const nameOf = (slug: string | null) => (slug ? (categories.data ?? []).find((c) => c.slug === slug)?.name ?? slug : "Other");
  if (!requests.data || requests.data.length === 0) return null;
  return (
    <Card className="gap-4 px-6">
      <Eyebrow>Reclassification requests</Eyebrow>
      <ul className="m-0 flex list-none flex-col gap-4 p-0">
        {requests.data.map((r: ReclassificationRequest) => {
          const status = STATUS_LABEL[r.status] ?? STATUS_LABEL.open;
          return (
            <li key={r.id} className="flex flex-col gap-1 text-sm">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{r.hub_request_id}</span>
                <Badge color={status.color} soft>
                  {status.label}
                </Badge>
                <span className="text-text-muted">
                  {formatDate(r.created_at)} · suggested {nameOf(r.suggested_category_slug)}
                </span>
              </span>
              <span className="text-text-body">{r.reason}</span>
              {r.admin_note ? <span className="text-text-muted">Hub admin: {r.admin_note}</span> : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

const ATTENTION_OPTIONS = [
  { value: "", label: "Category default" },
  { value: "info", label: "Info" },
  { value: "review", label: "Review" },
  { value: "not_allowed", label: "Not allowed" },
];

function OverrideDialog({
  open,
  onOpenChange,
  titleId,
  name,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titleId: string;
  name: string;
  initial: { slug: string; attention: AttentionLevel | null; note: string } | null;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? <OverrideForm titleId={titleId} name={name} initial={initial} onSaved={onSaved} onCancel={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function OverrideForm({
  titleId,
  name,
  initial,
  onSaved,
  onCancel,
}: {
  titleId: string;
  name: string;
  initial: { slug: string; attention: AttentionLevel | null; note: string } | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const categories = useLoad("categories", fetchCategories);
  const options = useMemo(() => [{ value: "", label: "Choose a category" }, ...subcategoryOptions(categories.data ?? [])], [categories.data]);
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [attention, setAttention] = useState<string>(initial?.attention ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!slug) return setError("Choose a category");
    if (note.trim().length > 500) return setError("The note can have at most 500 characters");
    setSaving(true);
    setError(null);
    try {
      await saveLocalOverride(titleId, slug, (attention || null) as AttentionLevel | null, note);
      toast.success("Local override saved");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the override");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Local override</DialogTitle>
        <DialogDescription>{name}. Applies in this app only and wins over the hub dictionary. It is never sent to the hub.</DialogDescription>
      </DialogHeader>
      <Field label="Category" htmlFor="override-category">
        <NativeSelect id="override-category" value={slug} onChange={setSlug} options={options} />
      </Field>
      <Field label="Attention" htmlFor="override-attention">
        <NativeSelect id="override-attention" value={attention} onChange={setAttention} options={ATTENTION_OPTIONS} />
      </Field>
      <Field label="Note (optional)" htmlFor="override-note">
        <textarea
          id="override-note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full min-w-0 rounded-sm border-[1.5px] border-input bg-surface-raised px-3 py-2 text-[15px] text-text-body focus-visible:border-action focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
        />
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
          Save override
        </Button>
      </DialogFooter>
    </form>
  );
}
