import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { CLASS_INFO } from "./classes";
import { importPolicy, parsePolicyFile, type ImportedPolicy } from "./import-policy";

type Pending = { file: string; policy: ImportedPolicy } | { file: string; errors: string[] };

// Policies › Import policy (admins): pick a file made by Export policy, see what it holds or what is wrong
// with it, then replace the draft. The published policy changes only when the admin publishes.
export function ImportPolicyButton({ tenantId, hasDraft, onImported }: { tenantId: string; hasDraft: boolean; onImported: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    const parsed = parsePolicyFile(await file.text());
    setPending(parsed.ok ? { file: file.name, policy: parsed.policy } : { file: file.name, errors: parsed.errors });
    if (input.current) input.current.value = "";
  }

  async function confirm(policy: ImportedPolicy) {
    setBusy(true);
    try {
      const count = await importPolicy(tenantId, policy);
      toast.success(`Imported ${count} rule${count === 1 ? "" : "s"} into the draft. Review it, then publish.`);
      setPending(null);
      onImported();
    } catch (error) {
      toast.error(`Import failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => input.current?.click()}>
        Import policy
      </Button>
      <input ref={input} type="file" accept="application/json,.json" className="sr-only" aria-label="Policy file to import" tabIndex={-1} onChange={(e) => void pick(e.target.files?.[0])} />
      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && !busy && setPending(null)}>
        <AlertDialogContent>
          {pending && "errors" in pending ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>This file cannot be imported</AlertDialogTitle>
                <AlertDialogDescription>{pending.file} has these problems. Nothing was changed.</AlertDialogDescription>
              </AlertDialogHeader>
              <ul className="m-0 flex max-h-60 list-disc flex-col gap-1 overflow-auto pl-5 text-sm">
                {pending.errors.slice(0, 20).map((e) => (
                  <li key={e}>{e}</li>
                ))}
                {pending.errors.length > 20 ? <li className="text-text-muted">and {pending.errors.length - 20} more</li> : null}
              </ul>
              <AlertDialogFooter>
                <AlertDialogCancel>Close</AlertDialogCancel>
              </AlertDialogFooter>
            </>
          ) : pending ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Import {pending.policy.rules.length} rule{pending.policy.rules.length === 1 ? "" : "s"} into the draft?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  The {hasDraft ? "draft's" : "new draft's"} rules{pending.policy.default_class ? " and default class" : ""} are replaced by the rules in {pending.file}
                  {pending.policy.version ? ` (policy version ${pending.policy.version})` : ""}. The published policy does not change until you publish.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {pending.policy.default_class ? (
                <p className="m-0 text-sm">Default class: {CLASS_INFO[pending.policy.default_class].label}</p>
              ) : null}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={busy}
                  onClick={(e) => {
                    e.preventDefault();
                    void confirm(pending.policy);
                  }}
                >
                  {busy ? "Importing…" : "Replace the draft"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
