import { useState, type FormEvent } from "react";
import { BellRing, CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Eyebrow } from "@/components/shared/eyebrow";
import { Field } from "@/components/shared/filters";
import { useAuth } from "@/features/auth/auth-context";
import { formatDateTime } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { fetchAlertStatus, parseRecipients, removeAlertChannel, saveAlertSettings, sendTestAlert, type AlertStatus } from "./api";

// Settings › Alerts: where alerts go (webhook and/or email) and when they fire.
export function AlertsCard() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const status = useLoad("alert-status", fetchAlertStatus);
  const s = status.data;
  const anyChannel = Boolean(s?.webhook_configured || s?.email_configured);
  const [testing, setTesting] = useState(false);

  async function test() {
    setTesting(true);
    try {
      const result = await sendTestAlert();
      if (result.failed > 0) toast.error("The test alert could not be delivered. See the last error below.");
      else toast.success("Test alert sent");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send the test alert");
    } finally {
      setTesting(false);
      status.reload();
    }
  }

  async function remove(channel: "webhook" | "email") {
    try {
      await removeAlertChannel(channel);
      toast.success(channel === "webhook" ? "Webhook removed" : "Email alerts removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the channel");
    } finally {
      status.reload();
    }
  }

  return (
    <Card className="gap-5 px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Eyebrow>Operations</Eyebrow>
          <h2 className="m-0 text-xl">Alerts</h2>
        </div>
        {s ? (
          anyChannel && s.enabled ? (
            <Badge color="safe" soft>
              <CircleCheck aria-hidden="true" />
              On
            </Badge>
          ) : (
            <Badge color="high" soft>
              <CircleAlert aria-hidden="true" />
              {s.enabled ? "No channel" : "Off"}
            </Badge>
          )
        ) : null}
      </div>
      <p className="m-0 text-sm text-text-muted">
        A webhook (Teams, Slack or any JSON endpoint) and/or an email through Resend when a cycle closes below the coverage
        threshold, a query returns an error, or the collector stops running. The webhook URL and the Resend key are stored
        encrypted in Supabase Vault and never shown again.
      </p>
      {status.loading && !s ? <Skeleton className="h-24 w-full" /> : null}
      {status.error ? (
        <p role="alert" className="m-0 text-sm text-text-critical">
          {status.error}
        </p>
      ) : null}
      {s ? (
        <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-text-muted">Webhook</dt>
          <dd className="m-0 font-mono break-all text-text-strong">{s.webhook_configured ? (s.webhook_hint ?? "Configured") : "Not set"}</dd>
          <dt className="text-text-muted">Email</dt>
          <dd className="m-0 text-text-strong">
            {s.email_configured ? (isAdmin ? `${s.email_from} → ${(s.email_to ?? []).join(", ")}` : "Configured") : "Not set"}
          </dd>
          <dt className="text-text-muted">Fires when</dt>
          <dd className="m-0 text-text-strong">
            coverage below {s.coverage_threshold}% · collector silent for {s.stale_minutes} min · query errors
          </dd>
          <dt className="text-text-muted">Delivery</dt>
          <dd className="m-0 text-text-strong">
            {s.last_sent_at ? `Last sent ${formatDateTime(s.last_sent_at)}` : "Nothing sent yet"}
            {s.pending > 0 ? ` · ${s.pending} pending` : ""}
            {isAdmin && s.last_error ? <span className="block text-xs text-text-critical">Last error: {s.last_error}</span> : null}
          </dd>
        </dl>
      ) : null}
      {!isAdmin && s ? <p className="m-0 text-sm text-text-muted">Only admins can change alerts.</p> : null}
      {isAdmin && s ? <AlertsForm status={s} onSaved={status.reload} /> : null}
      {isAdmin && s ? (
        <div className="flex flex-wrap gap-3">
          <Button size="sm" variant="secondary" onClick={() => void test()} disabled={testing || !anyChannel}>
            {testing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <BellRing aria-hidden="true" />}
            Send test alert
          </Button>
          {s.webhook_configured ? (
            <Button size="sm" variant="ghost" className="text-text-critical" onClick={() => void remove("webhook")}>
              Remove webhook
            </Button>
          ) : null}
          {s.email_configured ? (
            <Button size="sm" variant="ghost" className="text-text-critical" onClick={() => void remove("email")}>
              Remove email
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function AlertsForm({ status, onSaved }: { status: AlertStatus; onSaved: () => void }) {
  const [webhookUrl, setWebhookUrl] = useState("");
  const [resendKey, setResendKey] = useState("");
  const [emailFrom, setEmailFrom] = useState(status.email_from ?? "");
  const [emailTo, setEmailTo] = useState((status.email_to ?? []).join(", "));
  const [threshold, setThreshold] = useState(String(status.coverage_threshold));
  const [stale, setStale] = useState(String(status.stale_minutes));
  const [enabled, setEnabled] = useState(status.enabled);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await saveAlertSettings({
        webhookUrl,
        resendKey,
        emailFrom,
        emailTo: parseRecipients(emailTo),
        coverageThreshold: Number(threshold),
        staleMinutes: Number(stale),
        enabled,
      });
      setWebhookUrl("");
      setResendKey("");
      toast.success("Alert settings saved");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the alert settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" autoComplete="off" aria-label="Alert settings">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={status.webhook_configured ? "New webhook URL (leave empty to keep)" : "Webhook URL"} htmlFor="alert-webhook">
          <Input id="alert-webhook" type="password" autoComplete="off" spellCheck={false} placeholder="https://" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} />
        </Field>
        <Field label={status.email_configured ? "New Resend API key (leave empty to keep)" : "Resend API key"} htmlFor="alert-resend">
          <Input id="alert-resend" type="password" autoComplete="new-password" spellCheck={false} value={resendKey} onChange={(e) => setResendKey(e.target.value)} />
        </Field>
        <Field label="Sender address" htmlFor="alert-from">
          <Input id="alert-from" type="email" placeholder="alerts@your-domain.com" value={emailFrom} onChange={(e) => setEmailFrom(e.target.value)} />
        </Field>
        <Field label="Recipients (comma-separated)" htmlFor="alert-to">
          <Input id="alert-to" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} />
        </Field>
        <Field label="Coverage threshold (%)" htmlFor="alert-threshold">
          <Input id="alert-threshold" type="number" min={1} max={100} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        </Field>
        <Field label="Collector silent for (minutes)" htmlFor="alert-stale">
          <Input id="alert-stale" type="number" min={10} max={1440} value={stale} onChange={(e) => setStale(e.target.value)} />
        </Field>
      </div>
      <label className="flex items-center gap-3 text-sm text-text-body">
        <input type="checkbox" role="switch" className="size-4 accent-action" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Alerts on
      </label>
      {error ? (
        <p role="alert" className="m-0 text-sm text-text-critical">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Save alert settings
        </Button>
      </div>
    </form>
  );
}
