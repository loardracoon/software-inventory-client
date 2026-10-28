import { useState, type FormEvent } from "react";
import { Globe, Loader2, Send, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorLine } from "@/components/shared/error-line";
import { Eyebrow } from "@/components/shared/eyebrow";
import { Field, NativeSelect } from "@/components/shared/filters";
import { useAuth } from "@/features/auth/auth-context";
import { formatDateTime } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import {
  addDomainRule,
  deleteAccessRule,
  fetchDomainRules,
  fetchUsers,
  inviteUser,
  normalizeDomain,
  removeUser,
  ROLE_HELP,
  ROLE_LABEL,
  setUserRole,
  type AppRole,
} from "./api";

const ROLE_OPTIONS = (["viewer", "operator", "admin"] as AppRole[]).map((r) => ({ value: r, label: `${ROLE_LABEL[r]}: ${ROLE_HELP[r]}` }));
const SHORT_ROLE_OPTIONS = (["viewer", "operator", "admin"] as AppRole[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }));
const DOMAIN_ROLE_OPTIONS = (["viewer", "operator"] as AppRole[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }));
const ACCESS_LABEL: Record<string, string> = { email: "Invited", domain: "Domain", account: "Account only" };

// Settings › Users and access (admins): who can sign in and with which role.
export function UsersCard() {
  const { profile } = useAuth();
  return profile?.role === "admin" ? <UsersAdmin selfId={profile.id} /> : null;
}

function UsersAdmin({ selfId }: { selfId: string }) {
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);
  const users = useLoad(`users:${version}`, fetchUsers);
  const domains = useLoad(`domains:${version}`, fetchDomainRules);

  async function run(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      toast.success(done);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    } finally {
      reload();
    }
  }

  return (
    <Card className="gap-6 px-6">
      <div className="flex flex-col gap-2">
        <Eyebrow>Administration</Eyebrow>
        <h2 className="m-0 text-xl">Users and access</h2>
        <p className="m-0 text-sm text-text-muted">
          Only the people you add here, or people with an email in one of your domains, can sign in. They sign in with a one-click link sent to their email.
        </p>
      </div>

      <InviteForm onDone={reload} />

      <div className="flex flex-col gap-3">
        <Eyebrow>Users</Eyebrow>
        {users.error ? <ErrorLine message={users.error} /> : null}
        {users.loading && !users.data ? <Skeleton className="h-24 w-full" /> : null}
        {users.data ? (
          <Table aria-label="Users">
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data.map((u) => {
                const self = u.id === selfId;
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-semibold text-text-strong">
                      {u.email}
                      {self ? <span className="ml-2 text-xs font-normal text-text-muted">(you)</span> : null}
                    </TableCell>
                    <TableCell className="min-w-36">
                      <NativeSelect
                        id={`role-${u.id}`}
                        value={u.role}
                        onChange={(v) => void run(() => setUserRole(u.id, v as AppRole), `${u.email} is now ${ROLE_LABEL[v as AppRole]}`)}
                        options={SHORT_ROLE_OPTIONS}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge color="slate" soft>
                        {ACCESS_LABEL[u.access] ?? u.access}
                      </Badge>
                    </TableCell>
                    <TableCell>{u.last_sign_in_at ? formatDateTime(u.last_sign_in_at) : "Never"}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" title="Send a sign-in link" onClick={() => void run(() => inviteUser(u.email, u.role), `Sign-in link sent to ${u.email}`)}>
                        <Send aria-hidden="true" />
                        <span className="sr-only">Send a sign-in link to {u.email}</span>
                      </Button>
                      {self ? null : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-text-critical"
                          title="Remove access"
                          onClick={() => {
                            if (window.confirm(`Remove ${u.email}? The account and its email rule are deleted.${u.access === "domain" ? " A domain rule still lets this person sign in again." : ""}`)) {
                              void run(() => removeUser(u.id), `${u.email} removed`);
                            }
                          }}
                        >
                          <Trash2 aria-hidden="true" />
                          <span className="sr-only">Remove {u.email}</span>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <Eyebrow>Domains</Eyebrow>
        <p className="m-0 text-sm text-text-muted">Anyone with an email in these domains can sign in, with no invitation. A domain never gives the admin role.</p>
        {domains.error ? <ErrorLine message={domains.error} /> : null}
        {(domains.data ?? []).length === 0 && !domains.loading ? <p className="m-0 text-sm text-text-muted">No domains.</p> : null}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {(domains.data ?? []).map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 text-sm">
              <Globe className="size-4 text-text-muted" aria-hidden="true" />
              <span className="font-semibold text-text-strong">@{d.value}</span>
              <Badge color="slate" soft>
                {ROLE_LABEL[d.role]}
              </Badge>
              <Button size="sm" variant="ghost" className="text-text-critical" onClick={() => void run(() => deleteAccessRule(d.id), `@${d.value} removed`)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <DomainForm onDone={reload} />
      </div>
    </Card>
  );
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await inviteUser(email.trim(), role);
      toast.success(r.status === "invited" ? `Invitation sent to ${email.trim()}` : `${email.trim()} is now ${ROLE_LABEL[role]}; sign-in link sent`);
      setEmail("");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the invitation");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Eyebrow>Add a user</Eyebrow>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Email" htmlFor="invite-email" className="min-w-64 flex-1">
          <Input id="invite-email" type="email" autoComplete="off" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Role" htmlFor="invite-role" className="min-w-72 flex-1">
          <NativeSelect id="invite-role" value={role} onChange={(v) => setRole(v as AppRole)} options={ROLE_OPTIONS} />
        </Field>
        <Button type="submit" size="sm" disabled={busy || !email.trim()}>
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
          Send invitation
        </Button>
      </div>
      {error ? <ErrorLine message={error} /> : null}
    </form>
  );
}

function DomainForm({ onDone }: { onDone: () => void }) {
  const [domain, setDomain] = useState("");
  const [role, setRole] = useState<AppRole>("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = normalizeDomain(domain);
    if (!value) return setError("Enter a domain, for example sophos.com");
    setBusy(true);
    setError(null);
    try {
      await addDomainRule(value, role);
      toast.success(`Anyone with an @${value} email can now sign in as ${ROLE_LABEL[role]}`);
      setDomain("");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the domain");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Domain" htmlFor="domain-value" className="min-w-64 flex-1">
          <Input id="domain-value" placeholder="sophos.com" autoComplete="off" value={domain} maxLength={253} onChange={(e) => setDomain(e.target.value)} />
        </Field>
        <Field label="Role" htmlFor="domain-role" className="min-w-40">
          <NativeSelect id="domain-role" value={role} onChange={(v) => setRole(v as AppRole)} options={DOMAIN_ROLE_OPTIONS} />
        </Field>
        <Button type="submit" size="sm" variant="secondary" disabled={busy || !domain.trim()}>
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Globe aria-hidden="true" />}
          Add domain
        </Button>
      </div>
      {error ? <ErrorLine message={error} /> : null}
    </form>
  );
}
