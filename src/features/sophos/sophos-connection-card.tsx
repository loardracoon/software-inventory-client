import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CircleAlert, CircleCheck, KeyRound, Loader2, PlugZap, RefreshCw } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Eyebrow } from "@/components/shared/eyebrow";
import { useAuth } from "@/features/auth/auth-context";
import { formatDateTime } from "@/lib/format";
import {
  fetchSophosConnectionStatus,
  removeSophosCredential,
  saveSophosCredential,
  syncComputers,
  testSophosConnection,
  type SophosConnectionStatus,
} from "./sophos-connection";

type LoadState = { status: SophosConnectionStatus | null; error: string | null; loading: boolean };

export function SophosConnectionCard({ onSynced }: { onSynced?: () => void }) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [state, setState] = useState<LoadState>({ status: null, error: null, loading: true });
  const [editing, setEditing] = useState(false);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<"test" | "sync" | null>(null);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let active = true;
    fetchSophosConnectionStatus()
      .then((status) => active && setState({ status, error: null, loading: false }))
      .catch((error: Error) => active && setState({ status: null, error: error.message, loading: false }));
    return () => {
      active = false;
    };
  }, [version]);

  const configured = state.status?.configured ?? false;
  const showForm = isAdmin && (editing || (!state.loading && !state.error && !configured));

  async function test() {
    setBusy("test");
    try {
      const result = await testSophosConnection();
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not test the connection");
    } finally {
      setBusy(null);
      reload();
    }
  }

  async function sync() {
    setBusy("sync");
    try {
      const result = await syncComputers();
      if (result.ok) toast.success(`Sync finished · ${result.message}`);
      else toast.error(result.error ?? `Sync finished with errors · ${result.message}`);
      onSynced?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sync computers");
    } finally {
      setBusy(null);
      reload();
    }
  }

  async function remove() {
    try {
      await removeSophosCredential();
      toast.success("Sophos Central credential removed");
      setEditing(false);
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the credential");
    }
  }

  return (
    <Card className="gap-5 px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Eyebrow>Sophos Central</Eyebrow>
          <h2 className="m-0 text-xl">API connection</h2>
        </div>
        {state.loading ? null : configured ? (
          <Badge color="safe" soft>
            <CircleCheck aria-hidden="true" />
            Configured
          </Badge>
        ) : (
          <Badge color="high" soft>
            <CircleAlert aria-hidden="true" />
            Not configured
          </Badge>
        )}
      </div>

      <p className="m-0 text-sm text-text-muted">
        One API credential from Sophos Central. A partner or organization credential covers all of its tenants. The
        secret is stored encrypted in Supabase Vault, used only by the collector and never shown again.
      </p>

      {state.loading ? <Skeleton className="h-16 w-full" /> : null}
      {state.error ? (
        <p role="alert" className="m-0 text-sm text-text-critical">
          {state.error}
        </p>
      ) : null}

      {configured && state.status && isAdmin ? <ConnectionDetails status={state.status} /> : null}

      {!isAdmin && !state.loading ? (
        <>
          {configured && state.status ? (
            <p className="m-0 flex flex-wrap items-center gap-2 text-sm text-text-muted">
              Last sync:
              <ResultLine at={state.status.last_sync_at} ok={state.status.last_sync_ok} message={null} empty="never" />
            </p>
          ) : null}
          <p className="m-0 text-sm text-text-muted">Only admins can change the connection.</p>
        </>
      ) : null}

      {showForm ? (
        <CredentialForm
          replacing={configured}
          onCancel={configured ? () => setEditing(false) : undefined}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      ) : null}

      {isAdmin && configured && !editing ? (
        <div className="flex flex-wrap gap-3">
          <Button size="sm" onClick={() => void sync()} disabled={busy !== null}>
            {busy === "sync" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            {busy === "sync" ? "Syncing computers" : "Sync now"}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void test()} disabled={busy !== null}>
            {busy === "test" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <PlugZap aria-hidden="true" />}
            {busy === "test" ? "Testing" : "Test connection"}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)} disabled={busy !== null}>
            <KeyRound aria-hidden="true" />
            Replace credential
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-text-critical">
                Remove
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove the Sophos Central credential?</AlertDialogTitle>
                <AlertDialogDescription>
                  Collection stops until a new credential is saved. Inventory history is kept.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => void remove()}>
                  Remove credential
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}
    </Card>
  );
}

function ConnectionDetails({ status }: { status: SophosConnectionStatus }) {
  return (
    <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
      <dt className="text-text-muted">Client ID</dt>
      <dd className="m-0 font-mono text-text-strong">{status.client_id_hint}</dd>
      <dt className="text-text-muted">Saved</dt>
      <dd className="m-0 text-text-strong">
        {status.configured_at ? formatDateTime(status.configured_at) : "—"}
        {status.configured_by_email ? ` by ${status.configured_by_email}` : ""}
      </dd>
      <dt className="text-text-muted">Connection test</dt>
      <dd className="m-0 text-text-strong">
        <ResultLine at={status.last_test_at} ok={status.last_test_ok} message={status.last_test_message} empty="Not tested yet" />
      </dd>
      <dt className="text-text-muted">Last sync</dt>
      <dd className="m-0 text-text-strong">
        <ResultLine at={status.last_sync_at} ok={status.last_sync_ok} message={status.last_sync_message} empty="Never synced" />
      </dd>
    </dl>
  );
}

// Outcome as a word and an icon (never colour alone), then the time and the server's message.
function ResultLine({ at, ok, message, empty }: { at: string | null; ok: boolean | null; message: string | null; empty: string }) {
  if (!at) return <span className="text-text-muted">{empty}</span>;
  return (
    <span className="flex flex-col gap-1">
      <span className="inline-flex flex-wrap items-center gap-2">
        {ok ? (
          <Badge color="safe" soft>
            <CircleCheck aria-hidden="true" />
            Passed
          </Badge>
        ) : (
          <Badge color="critical" soft>
            <CircleAlert aria-hidden="true" />
            Failed
          </Badge>
        )}
        {formatDateTime(at)}
      </span>
      {message ? <span className="text-xs text-text-muted">{message}</span> : null}
    </span>
  );
}

function CredentialForm({
  replacing,
  onCancel,
  onSaved,
}: {
  replacing: boolean;
  onCancel?: () => void;
  onSaved: () => void;
}) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await saveSophosCredential(clientId.trim(), clientSecret.trim());
      setClientSecret("");
      toast.success("Sophos Central credential saved");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the credential");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" autoComplete="off" aria-label="Sophos Central credential">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sophos-client-id" className="text-[13px] font-semibold text-text-strong">
          Client ID
        </Label>
        <Input
          id="sophos-client-id"
          required
          spellCheck={false}
          autoComplete="off"
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sophos-client-secret" className="text-[13px] font-semibold text-text-strong">
          Client secret
        </Label>
        <Input
          id="sophos-client-secret"
          type="password"
          required
          spellCheck={false}
          autoComplete="new-password"
          value={clientSecret}
          onChange={(event) => setClientSecret(event.target.value)}
          aria-describedby="sophos-secret-hint"
        />
        <p id="sophos-secret-hint" className="m-0 text-xs text-text-muted">
          Create it in Sophos Central under API credentials management, with the least-privileged role that can run
          Live Discover.
        </p>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-sm text-text-critical">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {replacing ? "Save new credential" : "Save credential"}
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
