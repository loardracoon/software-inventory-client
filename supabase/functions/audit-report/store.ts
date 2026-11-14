// Stores a package with record_audit_report. With INTERNAL_REST_URL (the compose, VPS and K3S layouts) the call goes
// straight to PostgREST on the internal network: the gateway caps REST bodies (RL_BODY_REST, 2 MB) and the hex archive
// is twice the ZIP size. Without it (Supabase CLI, Kong) it goes through supabase-js.

export type RpcResult = { data: unknown; error: { code?: string; message: string } | null };

export async function storeReport(
  args: Record<string, unknown>,
  opts: { restUrl: string | undefined; serviceKey: string; rpc: (args: Record<string, unknown>) => PromiseLike<RpcResult>; fetch?: typeof fetch },
): Promise<RpcResult> {
  if (!opts.restUrl) return opts.rpc(args);
  const response = await (opts.fetch ?? fetch)(`${opts.restUrl.replace(/\/+$/, "")}/rpc/record_audit_report`, {
    method: "POST",
    headers: { apikey: opts.serviceKey, Authorization: `Bearer ${opts.serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const payload = (await response.json().catch(() => null)) as { code?: string; message?: string } | string | null;
  if (response.ok) return { data: payload, error: null };
  const error = typeof payload === "object" && payload ? payload : {};
  return { data: null, error: { code: error.code, message: error.message ?? `HTTP ${response.status}` } };
}
