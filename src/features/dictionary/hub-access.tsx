import { useState, type FormEvent } from "react";
import { Loader2, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { CONSENT_CHECKBOX, CONSENT_TEXT, CONSENT_TITLE, CONSENT_VERSION, SOPHIZO_HUB_URL } from "@hub-consent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/shared/filters";
import { formatDateTime } from "@/lib/format";
import { hubAccessAction, requestHubAccess, type HubEnrollment } from "./api";

const OPEN = ["requesting", "unverified", "pending"];
const STATUS_TEXT: Record<string, string> = {
  requesting: "Sending the request…",
  unverified: "Waiting for the contact to confirm the email address (link valid for 24 hours).",
  pending: "Email confirmed. Waiting for a Hub admin to approve the request.",
  rejected: "The Hub rejected the request.",
  expired: "The request expired (14 days without a decision).",
  cancelled: "The request was cancelled.",
  unknown: "The Hub does not know this request any more.",
};

// Settings › Dictionary hub, when no Hub is connected: ask the Sophizo Hub for a key. This app makes the key, keeps it
// in the Vault and sends the Hub only its hash; once approved, the connection is saved by itself.
export function HubAccess({ enrollment, onChanged }: { enrollment: HubEnrollment | null; onChanged: () => void }) {
  const status = enrollment?.status ?? "none";
  if (OPEN.includes(status)) return <OpenRequest enrollment={enrollment!} onChanged={onChanged} />;
  return (
    <div className="flex flex-col gap-3">
      {status !== "none" && status !== "approved" ? <FinishedRequest enrollment={enrollment!} onChanged={onChanged} /> : null}
      <RequestForm onSent={onChanged} />
    </div>
  );
}

function OpenRequest({ enrollment, onChanged }: { enrollment: HubEnrollment; onChanged: () => void }) {
  const [busy, setBusy] = useState<"check" | "cancel" | null>(null);
  async function run(action: "check" | "cancel") {
    setBusy(action);
    try {
      const r = await hubAccessAction(action);
      if (action === "cancel") toast.success("Access request cancelled");
      else if (r.status === "approved") toast.success("Approved: the Hub is connected");
      else toast.message(STATUS_TEXT[r.status ?? ""] ?? "No change yet");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reach the Hub");
    } finally {
      setBusy(null);
      onChanged();
    }
  }
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-subtle p-4" aria-label="Access request">
      <p className="m-0 text-sm font-semibold text-text-strong">Access request to {enrollment.hub_url}</p>
      <p className="m-0 text-sm text-text-body">{STATUS_TEXT[enrollment.status] ?? enrollment.status}</p>
      <p className="m-0 text-xs text-text-muted">
        Sent {enrollment.requested_at ? formatDateTime(enrollment.requested_at) : ""} for {enrollment.name} · contact {enrollment.contact_email}
        {enrollment.next_check_at ? ` · next check ${formatDateTime(enrollment.next_check_at)}` : ""}
      </p>
      {enrollment.last_error ? <p className="m-0 text-xs text-text-critical">{enrollment.last_error}</p> : null}
      <div className="flex flex-wrap gap-3">
        <Button size="sm" variant="secondary" onClick={() => void run("check")} disabled={busy !== null}>
          {busy === "check" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          Check now
        </Button>
        <Button size="sm" variant="ghost" className="text-text-critical" onClick={() => void run("cancel")} disabled={busy !== null}>
          Cancel request
        </Button>
      </div>
    </div>
  );
}

function FinishedRequest({ enrollment, onChanged }: { enrollment: HubEnrollment; onChanged: () => void }) {
  async function dismiss() {
    try {
      await hubAccessAction("dismiss");
    } finally {
      onChanged();
    }
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-subtle p-4" role="status">
      <p className="m-0 text-sm text-text-strong">{STATUS_TEXT[enrollment.status] ?? enrollment.status}</p>
      {enrollment.note ? <p className="m-0 text-sm text-text-body">Note from the Hub admin: {enrollment.note}</p> : null}
      {enrollment.last_error ? <p className="m-0 text-xs text-text-critical">{enrollment.last_error}</p> : null}
      <div>
        <Button size="sm" variant="ghost" onClick={() => void dismiss()}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

function RequestForm({ onSent }: { onSent: () => void }) {
  const [name, setName] = useState("");
  const [organization, setOrganization] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      await requestHubAccess({ name, organization, contact_email: email, reason, consent, consent_version: CONSENT_VERSION });
      toast.success(`Request sent. ${email} gets an email to confirm it.`);
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the request");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-md border border-border-subtle p-4" aria-label="Request access to the Sophizo Hub">
      <div className="flex flex-col gap-1">
        <p className="m-0 text-sm font-semibold text-text-strong">Request access to the Sophizo Hub ({SOPHIZO_HUB_URL.replace("https://", "")})</p>
        <p className="m-0 text-xs text-text-muted">
          This app makes its own client key and keeps it encrypted. The request carries only a fingerprint (hash) of the key, and no email ever
          contains it. After the contact confirms the email address and the Hub approves, the connection is saved by itself.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Installation name" htmlFor="enroll-name">
          <Input id="enroll-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Organization" htmlFor="enroll-org">
          <Input id="enroll-org" maxLength={120} value={organization} onChange={(e) => setOrganization(e.target.value)} />
        </Field>
        <Field label="Contact email" htmlFor="enroll-email">
          <Input id="enroll-email" type="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Reason (optional)" htmlFor="enroll-reason">
          <Input id="enroll-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-col gap-2 rounded-md bg-surface-subtle p-3">
        <p className="m-0 text-sm font-semibold text-text-strong">{CONSENT_TITLE}</p>
        <p className="m-0 text-sm text-text-body">{CONSENT_TEXT}</p>
        <label className="flex items-start gap-2 text-sm font-semibold text-text-strong">
          <input type="checkbox" className="mt-0.5 size-4 accent-action" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          {CONSENT_CHECKBOX}
        </label>
        <p className="m-0 text-xs text-text-muted">
          More information:{" "}
          <a href="https://github.com/loardracoon/software-inventory-client#data-flow-what-leaves-this-app" target="_blank" rel="noreferrer">
            README › Data flow
          </a>
        </p>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-sm text-text-critical">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" size="sm" disabled={sending || !consent}>
          {sending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
          Request access
        </Button>
      </div>
    </form>
  );
}
