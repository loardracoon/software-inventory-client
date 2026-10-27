// Edge Runtime main service (self-hosted): routes /<function>/... to that function's worker. The JWT is
// verified here unless the function is listed in NO_VERIFY_JWT (the functions with verify_jwt = false in
// supabase/config.toml, which authenticate callers themselves).

declare const EdgeRuntime: {
  userWorkers: {
    create(options: Record<string, unknown>): Promise<{ fetch(req: Request): Promise<Response> }>;
  };
};

const JWT_SECRET = Deno.env.get("JWT_SECRET") ?? "";
const NO_VERIFY = new Set((Deno.env.get("NO_VERIFY_JWT") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const encoder = new TextEncoder();

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function b64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function validJwt(token: string): Promise<boolean> {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature || !JWT_SECRET) return false;
  try {
    const key = await crypto.subtle.importKey("raw", encoder.encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!(await crypto.subtle.verify("HMAC", key, b64url(signature), encoder.encode(`${header}.${payload}`)))) return false;
    const claims = JSON.parse(new TextDecoder().decode(b64url(payload))) as { exp?: number };
    return typeof claims.exp !== "number" || claims.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

// Workers get the environment without the JWT secret.
const workerEnv = Object.entries(Deno.env.toObject()).filter(([k]) => k !== "JWT_SECRET" && k !== "NO_VERIFY_JWT");

Deno.serve(async (req) => {
  const name = new URL(req.url).pathname.split("/")[1] ?? "";
  if (!/^[a-z0-9-]+$/.test(name) || name === "main") return json({ error: "Function not found" }, 404);
  try {
    await Deno.stat(`/home/deno/functions/${name}/index.ts`);
  } catch {
    return json({ error: "Function not found" }, 404);
  }
  if (req.method !== "OPTIONS" && !NO_VERIFY.has(name)) {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!(await validJwt(token))) return json({ msg: "Invalid JWT" }, 401);
  }
  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: `/home/deno/functions/${name}`,
      memoryLimitMb: 256,
      workerTimeoutMs: 150_000,
      noModuleCache: false,
      importMapPath: null,
      envVars: workerEnv,
    });
    return await worker.fetch(req);
  } catch (error) {
    return json({ error: `Function failed: ${(error as Error).message}` }, 500);
  }
});
