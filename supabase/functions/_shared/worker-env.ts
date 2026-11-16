// Environment each Edge Function worker gets from the self-hosted router (deploy/k3s/functions/main).
// Runtime-neutral so Vitest pins the rule: no worker sees JWT_SECRET; only mcp gets it, as MCP_JWT_SECRET
// (Phase 11: it signs 5-minute user JWTs for personal tokens).

const HIDDEN = new Set(["JWT_SECRET", "NO_VERIFY_JWT", "MCP_JWT_SECRET"]);

export type WorkerEnvs = { forWorker(name: string): [string, string][] };

export function workerEnvs(env: Record<string, string>): WorkerEnvs {
  const base = Object.entries(env).filter(([k]) => !HIDDEN.has(k));
  const secret = env.JWT_SECRET ?? "";
  const mcp: [string, string][] = secret ? [...base, ["MCP_JWT_SECRET", secret]] : base;
  return { forWorker: (name) => (name === "mcp" ? mcp : base) };
}
