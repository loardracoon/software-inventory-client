import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eyebrow } from "@/components/shared/eyebrow";
import { useAuth } from "@/features/auth/auth-context";

// Email magic link for now; SSO (Entra ID via SAML) arrives in Phase 8.
export function LoginPage() {
  const { status, sendMagicLink } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  if (status === "signed_in") return <Navigate to={from} replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(null);
    const result = await sendMagicLink(email.trim(), from);
    setSending(false);
    if (result.error) setError(result.error);
    else setSentTo(email.trim());
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-dark-blue px-4 py-12">
      <Card className="w-full max-w-md gap-6 px-8 py-8">
        <div className="flex flex-col gap-3">
          <Eyebrow tone="brand" tick>
            Endpoint Inventory
          </Eyebrow>
          <h1 className="m-0 text-3xl">Sign in</h1>
        </div>
        {sentTo ? (
          <div role="status" className="flex flex-col gap-3">
            <MailCheck className="size-8 text-text-brand" aria-hidden="true" />
            <p className="m-0 text-sm">
              We sent a sign-in link to <strong className="font-semibold">{sentTo}</strong>. Open it on this device to continue.
            </p>
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setSentTo(null)}>
              Use another email
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email" className="text-[13px] font-semibold text-text-strong">
                Work email
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "email-error" : "email-hint"}
              />
              {error ? (
                <p id="email-error" role="alert" className="m-0 text-xs text-text-critical">
                  {error}
                </p>
              ) : (
                <p id="email-hint" className="m-0 text-xs text-text-muted">
                  We email you a one-time sign-in link.
                </p>
              )}
            </div>
            <Button type="submit" disabled={sending || status === "unconfigured"}>
              {sending ? "Sending link" : "Email me a sign-in link"}
            </Button>
            {status === "unconfigured" ? (
              <p className="m-0 text-xs text-text-critical">Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</p>
            ) : null}
          </form>
        )}
      </Card>
    </div>
  );
}
