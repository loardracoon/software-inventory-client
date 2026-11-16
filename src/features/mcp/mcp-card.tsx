import { useState, type FormEvent } from "react";
import { Bot, CircleAlert, CircleCheck, Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
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
  claudeCodeCommand,
  createMcpToken,
  fetchMcpSettings,
  fetchMcpTokens,
  mcpServerUrl,
  revokeMcpToken,
  saveMcpSettings,
  TOKEN_DAYS,
  tokenState,
  type CreatedToken,
  type McpScope,
  type McpSettings,
} from "./api";

const STATE_LABEL = { active: "Active", expired: "Expired", revoked: "Revoked" } as const;
const SCOPE_LABEL: Record<McpScope, string> = { read: "Read", policy_draft: "Read + policy draft" };

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Could not copy. Select the text and copy it.");
  }
}

// Settings › AI assistants: the MCP server switch, username masking and personal tokens.
export function McpCard() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);
  const settings = useLoad(`mcp-settings:${version}`, fetchMcpSettings);
  const tokens = useLoad(`mcp-tokens:${version}`, fetchMcpTokens);
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const s = settings.data;
  const url = mcpServerUrl();

  async function revoke(id: string, name: string) {
    if (!window.confirm(`Revoke the token "${name}"? Assistants that use it stop working at once.`)) return;
    try {
      await revokeMcpToken(id);
      toast.success(`Token "${name}" revoked`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not revoke the token");
    } finally {
      reload();
    }
  }

  return (
    <Card className="gap-5 px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Eyebrow>Integrations</Eyebrow>
          <h2 className="m-0 text-xl">AI assistants</h2>
        </div>
        {s ? (
          s.enabled ? (
            <Badge color="safe" soft>
              <CircleCheck aria-hidden="true" />
              On
            </Badge>
          ) : (
            <Badge color="slate" soft>
              <CircleAlert aria-hidden="true" />
              Off
            </Badge>
          )
        ) : null}
      </div>
      <p className="m-0 text-sm text-text-muted">
        Connect Claude or another MCP client to ask about the inventory, write reports and draft policy rules. The assistant reads with your own
        access. What it reads goes to the provider of the assistant you use, so this is off until an admin turns it on. Every call is audited.
      </p>
      {settings.error ? <ErrorLine message={settings.error} /> : null}
      {settings.loading && !s ? <Skeleton className="h-16 w-full" /> : null}
      {s ? (
        <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-text-muted">Server URL</dt>
          <dd className="m-0 flex flex-wrap items-center gap-2">
            <code className="font-mono break-all text-text-strong">{url}</code>
            <Button size="sm" variant="ghost" onClick={() => void copy(url, "Server URL")}>
              <Copy aria-hidden="true" />
              <span className="sr-only">Copy the server URL</span>
            </Button>
          </dd>
          <dt className="text-text-muted">Usernames</dt>
          <dd className="m-0 text-text-strong">{s.show_usernames ? "Shown to assistants (as in the console for your role)" : "Masked for everyone, admins included"}</dd>
        </dl>
      ) : null}
      {isAdmin && s ? <SettingsForm settings={s} onSaved={reload} /> : null}
      {!isAdmin && s ? <p className="m-0 text-sm text-text-muted">Only admins can turn AI assistants on or off.</p> : null}

      <div className="flex flex-col gap-3">
        <Eyebrow>Personal tokens</Eyebrow>
        <p className="m-0 text-sm text-text-muted">
          A token lets an assistant act as you. It is shown once; store it like a password. {isAdmin ? "You see everyone's tokens and can revoke any of them." : ""}
        </p>
        {created ? <NewToken token={created} url={url} onClose={() => setCreated(null)} /> : <CreateTokenForm isAdmin={isAdmin} onCreated={(t) => { setCreated(t); reload(); }} />}
        {tokens.error ? <ErrorLine message={tokens.error} /> : null}
        {tokens.loading && !tokens.data ? <Skeleton className="h-16 w-full" /> : null}
        {tokens.data && tokens.data.length === 0 ? <p className="m-0 text-sm text-text-muted">No tokens yet.</p> : null}
        {tokens.data && tokens.data.length > 0 ? (
          <Table aria-label="Personal tokens">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                {isAdmin ? <TableHead>Owner</TableHead> : null}
                <TableHead>Access</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.data.map((t) => {
                const state = tokenState(t);
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-semibold text-text-strong">
                      {t.name}
                      <span className="ml-2 font-mono text-xs font-normal text-text-muted">…{t.token_hint}</span>
                    </TableCell>
                    {isAdmin ? <TableCell>{t.email}</TableCell> : null}
                    <TableCell>{SCOPE_LABEL[t.scope]}</TableCell>
                    <TableCell>
                      <Badge color={state === "active" ? "safe" : "slate"} soft>
                        {state === "active" ? <CircleCheck aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
                        {STATE_LABEL[state]}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDateTime(t.expires_at)}</TableCell>
                    <TableCell>{t.last_used_at ? formatDateTime(t.last_used_at) : "Never"}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {state === "active" ? (
                        <Button size="sm" variant="ghost" className="text-text-critical" title="Revoke" onClick={() => void revoke(t.id, t.name)}>
                          <Trash2 aria-hidden="true" />
                          <span className="sr-only">Revoke {t.name}</span>
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}
      </div>
    </Card>
  );
}

function SettingsForm({ settings, onSaved }: { settings: McpSettings; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [showUsernames, setShowUsernames] = useState(settings.show_usernames);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await saveMcpSettings(enabled, showUsernames);
      toast.success("AI assistant settings saved");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-label="AI assistant settings">
      <label className="flex items-center gap-3 text-sm text-text-body">
        <input type="checkbox" role="switch" className="size-4 accent-action" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Allow AI assistants (MCP)
      </label>
      <label className="flex items-center gap-3 text-sm text-text-body">
        <input type="checkbox" role="switch" className="size-4 accent-action" checked={showUsernames} onChange={(e) => setShowUsernames(e.target.checked)} />
        Show usernames to AI assistants (otherwise masked for everyone)
      </label>
      {error ? <ErrorLine message={error} /> : null}
      <div>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Bot aria-hidden="true" />}
          Save
        </Button>
      </div>
    </form>
  );
}

function CreateTokenForm({ isAdmin, onCreated }: { isAdmin: boolean; onCreated: (token: CreatedToken) => void }) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<McpScope>("read");
  const [days, setDays] = useState("30");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onCreated(await createMcpToken(name, scope, Number(days)));
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the token");
    } finally {
      setSaving(false);
    }
  }

  const scopes = [{ value: "read", label: SCOPE_LABEL.read }, ...(isAdmin ? [{ value: "policy_draft", label: SCOPE_LABEL.policy_draft }] : [])];
  return (
    <form onSubmit={submit} className="flex flex-col gap-3" autoComplete="off" aria-label="Create a personal token">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Name" htmlFor="mcp-token-name">
          <Input id="mcp-token-name" maxLength={80} placeholder="Claude Desktop on my laptop" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Access" htmlFor="mcp-token-scope">
          <NativeSelect id="mcp-token-scope" value={scope} onChange={(v) => setScope(v as McpScope)} options={scopes} />
        </Field>
        <Field label="Expires in" htmlFor="mcp-token-days">
          <NativeSelect id="mcp-token-days" value={days} onChange={setDays} options={TOKEN_DAYS.map((d) => ({ value: String(d), label: `${d} days` }))} />
        </Field>
      </div>
      {error ? <ErrorLine message={error} /> : null}
      <div>
        <Button type="submit" size="sm" disabled={saving || !name.trim()}>
          {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
          Create token
        </Button>
      </div>
    </form>
  );
}

function NewToken({ token, url, onClose }: { token: CreatedToken; url: string; onClose: () => void }) {
  const command = claudeCodeCommand(url, token.token);
  return (
    <div role="status" className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-subtle p-4">
      <p className="m-0 text-sm font-semibold text-text-strong">Copy your token now. It will not be shown again.</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="font-mono text-sm break-all text-text-strong">{token.token}</code>
        <Button size="sm" variant="secondary" onClick={() => void copy(token.token, "Token")}>
          <Copy aria-hidden="true" />
          Copy token
        </Button>
      </div>
      <p className="m-0 text-sm text-text-muted">Expires {formatDateTime(token.expires_at)}. Claude Code:</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="font-mono text-xs break-all text-text-body">{command}</code>
        <Button size="sm" variant="ghost" onClick={() => void copy(command, "Command")}>
          <Copy aria-hidden="true" />
          <span className="sr-only">Copy the Claude Code command</span>
        </Button>
      </div>
      <div>
        <Button size="sm" variant="secondary" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
