import { useState, type FormEvent } from "react";
import { Bookmark, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/shared/filters";
import { useAuth } from "@/features/auth/auth-context";
import { saveSearch } from "./api";

// Saves the current /software URL filters with a name and pins them to the sidebar.
export function SaveSearchButton({ params }: { params: URLSearchParams }) {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!profile) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError("Enter a name");
    if (name.trim().length > 80) return setError("The name can have at most 80 characters");
    setSaving(true);
    setError(null);
    try {
      await saveSearch(name, params, shared, profile!.id);
      toast.success(`Saved “${name.trim()}” to the sidebar`);
      setOpen(false);
      setName("");
      setShared(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the search");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Bookmark aria-hidden="true" />
          Save search
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Save search</DialogTitle>
            <DialogDescription>The current filters are pinned to the sidebar under Saved searches.</DialogDescription>
          </DialogHeader>
          <Field label="Name" htmlFor="saved-search-name">
            <Input id="saved-search-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
          {profile.role === "admin" ? (
            <label className="flex items-center gap-2 text-sm text-text-body">
              <input type="checkbox" className="size-4 accent-action" checked={shared} onChange={(e) => setShared(e.target.checked)} />
              Share with everyone
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="m-0 text-sm text-text-critical">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
