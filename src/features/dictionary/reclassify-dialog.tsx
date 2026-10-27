import { useMemo, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/shared/filters";
import { fetchCategories } from "@/features/inventory/api";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";
import { subcategoryOptions } from "./category-options";
import { REASON_MAX, requestReclassification } from "./api";

const OTHER = "__other";

export type ReclassifyTarget = { titleId: string; name: string; currentCategory: string | null };

export function validateReclassification(suggested: string, reason: string, evidenceUrl: string): string | null {
  if (!suggested) return "Choose a suggested category";
  if (!reason.trim()) return "Enter a reason";
  if (reason.trim().length > REASON_MAX) return `The reason can have at most ${REASON_MAX} characters`;
  if (evidenceUrl.trim()) {
    try {
      const url = new URL(evidenceUrl.trim());
      if (url.protocol !== "http:" && url.protocol !== "https:") return "The evidence URL must be an http(s) link";
    } catch {
      return "The evidence URL must be an http(s) link";
    }
  }
  return null;
}

// "Request reclassification": the suggestion goes to the Dictionary Hub; its admin decides.
export function ReclassifyDialog({
  target,
  onOpenChange,
  onRequested,
}: {
  target: ReclassifyTarget | null;
  onOpenChange: (open: boolean) => void;
  onRequested: (titleId: string, requestId: string) => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {target ? <ReclassifyForm key={target.titleId} target={target} onDone={onRequested} onCancel={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ReclassifyForm({ target, onDone, onCancel }: { target: ReclassifyTarget; onDone: (titleId: string, requestId: string) => void; onCancel: () => void }) {
  const categories = useLoad("categories", fetchCategories);
  const options = useMemo(
    () => [{ value: "", label: "Choose a category" }, ...subcategoryOptions(categories.data ?? []), { value: OTHER, label: "Other (explain in the reason)" }],
    [categories.data],
  );
  const [suggested, setSuggested] = useState("");
  const [reason, setReason] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = validateReclassification(suggested, reason, evidenceUrl);
    setError(problem);
    if (problem) return;
    setSaving(true);
    try {
      const result = await requestReclassification({
        titleId: target.titleId,
        suggestedCategorySlug: suggested === OTHER ? null : suggested,
        reason,
        evidenceUrl,
      });
      toast.success(`Reclassification requested · ${result.id}`);
      onDone(target.titleId, result.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the request");
    } finally {
      setSaving(false);
    }
  }

  const left = REASON_MAX - reason.trim().length;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Request reclassification</DialogTitle>
        <DialogDescription>
          {target.name}. The request goes to the Dictionary Hub with this title's name and key only; no computers or users.
        </DialogDescription>
      </DialogHeader>
      <Field label="Current category" htmlFor="reclassify-current">
        <Input id="reclassify-current" readOnly value={target.currentCategory ?? "Unclassified"} />
      </Field>
      <Field label="Suggested category" htmlFor="reclassify-suggested">
        <NativeSelect id="reclassify-suggested" value={suggested} onChange={setSuggested} options={options} />
      </Field>
      <Field label="Reason" htmlFor="reclassify-reason">
        <textarea
          id="reclassify-reason"
          rows={4}
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-describedby="reclassify-reason-count"
          className="w-full min-w-0 rounded-sm border-[1.5px] border-input bg-surface-raised px-3 py-2 text-[15px] text-text-body focus-visible:border-action focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
        />
        <span id="reclassify-reason-count" className={cn("text-xs", left < 0 ? "text-text-critical" : "text-text-muted")}>
          {left} characters left
        </span>
      </Field>
      <Field label="Evidence URL (optional)" htmlFor="reclassify-evidence">
        <Input id="reclassify-evidence" type="url" placeholder="https://" value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} />
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
          Send request
        </Button>
      </DialogFooter>
    </form>
  );
}
