import { useState, type FormEvent } from "react";
import { CircleAlert, CircleCheck, KeyRound, Loader2, RefreshCw } from "lucide-react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Eyebrow } from "@/components/shared/eyebrow";
import { Field } from "@/components/shared/filters";
import { useAuth } from "@/features/auth/auth-context";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { fetchHubStatus, removeHubConnection, saveHubConnection, setHubSharing, syncHub } from "./api";

// Settings › Dictionary hub: connection (key write-only, kept in Vault), sharing switch and sync state.
export function HubCard() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const status = useLoad("hub-status", fetchHubStatus);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"sync" | "share" | null>(null);
  const s = status.data;
  const configured = s?.configured ?? false;

  async function sync() {
    setBusy("sync");
    try {
      const result = await syncHub();
      if (result.ok) {
        toast.success(`Dictionary synced · ${formatNumber(result.upserted)} entries, ${formatNumber(result.submitted)} titles shared, ${formatNumber(result.requestsUpdated)} requests updated`);
      } else toast.error(result.error ?? "Dictionary sync failed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sync the dictionary");
    } finally {
      setBusy(null);
      status.reload();
    }
  }

  async function toggleShare(share: boolean) {
    setBusy("share");
    try {
      await setHubSharing(share);
      toast.success(share ? "Unknown titles will be shared with the hub" : "Unknown titles stay in this app");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change the setting");
    } finally {
      setBusy(null);
      status.reload();
    }
  }

  async function remove() {
    try {
      await removeHubConnection();
      toast.success("Dictionary Hub connection removed");
      setEditing(false);
      status.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the connection");
    }
  }

  return (
    <Card className="gap-5 px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Eyebrow>Dictionary</Eyebrow>
          <h2 className="m-0 text-xl">Dictionary hub</h2>
        </div>
        {status.loading && !s ? null : configured ? (
          s?.delayed ? (
            <Badge color="high" soft>
              <CircleAlert aria-hidden="true" />
              Sync delayed
            </Badge>
          ) : (
            <Badge color="safe" soft>
              <CircleCheck aria-hidden="true" />
              Connected
            </Badge>
          )
        ) : (
          <Badge color="high" soft>
            <CircleAlert aria-hidden="true" />
            Not configured
          </Badge>
        )}
      </div>
      <p className="m-0 text-sm text-text-muted">
        Categories come from the Dictionary Hub. This app reads them, can share unknown titles (name, vendor, description
        and key only; never computers, users or tenants) and sends reclassification requests.
      </p>

      {status.loading && !s ? <Skeleton className="h-16 w-full" /> : null}
      {status.error ? (
        <p role="alert" className="m-0 text-sm text-text-critical">
          {status.error}
        </p>
      ) : null}

      {s ? (
        <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
          {isAdmin && s.url ? (
            <>
              <dt className="text-text-muted">Hub URL</dt>
              <dd className="m-0 font-mono break-all text-text-strong">{s.url}</dd>
              <dt className="text-text-muted">Client key</dt>
              <dd className="m-0 font-mono text-text-strong">{s.key_hint}</dd>
            </>
          ) : null}
          <dt className="text-text-muted">Last sync</dt>
          <dd className="m-0 text-text-strong">
            {s.synced_at ? `${formatDateTime(s.synced_at)} · seq ${formatNumber(s.last_seq)}` : "Never synced"}
            {s.next_attempt_at ? <span className="block text-xs text-text-muted">Next attempt {formatDateTime(s.next_attempt_at)}</span> : null}
          </dd>
          {isAdmin && s.last_error ? (
            <>
              <dt className="text-text-muted">Last error</dt>
              <dd className="m-0 text-text-critical">{s.last_error}</dd>
            </>
          ) : null}
          <dt className="text-text-muted">Waiting to share</dt>
          <dd className="m-0 text-text-strong">{formatNumber(s.pending_submissions)} unknown titles</dd>
        </dl>
      ) : null}

      {s ? (
        <label className="flex items-center gap-3 text-sm text-text-body">
          <input
            type="checkbox"
            role="switch"
            className="size-4 accent-action"
            checked={s.share_unknown_titles}
            disabled={!isAdmin || busy !== null}
            onChange={(e) => void toggleShare(e.target.checked)}
          />
          Share unknown titles with the hub
        </label>
      ) : null}

      {!isAdmin && s ? <p className="m-0 text-sm text-text-muted">Only admins can change the dictionary settings.</p> : null}

      {isAdmin && s && (editing || !configured) ? (
        <HubForm
          replacing={configured}
          onCancel={configured ? () => setEditing(false) : undefined}
          onSaved={() => {
            setEditing(false);
            status.reload();
          }}
        />
      ) : null}

      {isAdmin && configured && !editing ? (
        <div className="flex flex-wrap gap-3">
          <Button size="sm" onClick={() => void sync()} disabled={busy !== null}>
            {busy === "sync" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            {busy === "sync" ? "Syncing dictionary" : "Sync now"}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)} disabled={busy !== null}>
            <KeyRound aria-hidden="true" />
            Replace connection
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-text-critical">
                Remove
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove the Dictionary Hub connection?</AlertDialogTitle>
                <AlertDialogDescription>Titles keep the categories already synced; no new ones arrive until a hub is saved again.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => void remove()}>
                  Remove connection
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}
    </Card>
  );
}

function HubForm({ replacing, onCancel, onSaved }: { replacing: boolean; onCancel?: () => void; onSaved: () => void }) {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await saveHubConnection(url.trim(), key.trim());
      setKey("");
      toast.success("Dictionary Hub connection saved");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the connection");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" autoComplete="off" aria-label="Dictionary Hub connection">
      <Field label="Hub URL" htmlFor="hub-url">
        <Input id="hub-url" type="url" required placeholder="https://<project>.supabase.co" spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)} />
      </Field>
      <Field label="Client key" htmlFor="hub-key">
        <Input id="hub-key" type="password" required autoComplete="new-password" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} />
      </Field>
      <p className="m-0 text-xs text-text-muted">The hub admin creates the key under Clients. It is stored encrypted in Supabase Vault and never shown again.</p>
      {error ? (
        <p role="alert" className="m-0 text-sm text-text-critical">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {replacing ? "Save new connection" : "Save connection"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
