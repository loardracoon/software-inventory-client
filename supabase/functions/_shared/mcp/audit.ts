// What the mcp function writes to mcp_audit (Phase 11, runtime-neutral): the call, never its result.

const SECRET_KEY = /secret|token|password|passwd|api[_-]?key|authorization|cookie/i;
export const MAX_AUDIT_ARGUMENT_BYTES = 8192;

export type McpAuditRow = {
  user_id: string | null;
  token_id: string | null;
  method: string;
  tool: string | null;
  arguments: unknown;
  tenant_id: string | null;
  row_count: number | null;
  duration_ms: number;
  outcome: "ok" | "denied" | "error" | "disabled";
  error: string | null;
};

function scrub(value: unknown, depth: number): unknown {
  if (depth > 6) return "[…]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? "[removed]" : scrub(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 500) return value.slice(0, 500) + "…";
  return value;
}

// Arguments as stored: secrets removed by key name, long strings cut, the whole value capped.
export function auditArguments(args: unknown): unknown {
  if (args === undefined || args === null) return null;
  const clean = scrub(args, 0);
  const text = JSON.stringify(clean);
  if (new TextEncoder().encode(text).length <= MAX_AUDIT_ARGUMENT_BYTES) return clean;
  return { truncated: true, keys: clean && typeof clean === "object" ? Object.keys(clean).slice(0, 50) : [] };
}

export function auditError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}
