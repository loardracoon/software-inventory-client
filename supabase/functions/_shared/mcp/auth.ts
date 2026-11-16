// MCP auth (Phase 11, runtime-neutral): personal token format and hash, and the short-lived JWT the mcp
// function signs for the token's user so PostgREST applies RLS, my_tenant_roles() and masking.
// Uses only Web Crypto, so Vitest covers it.

export const TOKEN_PREFIX = "eimcp_";
// "eimcp_" + base64url of 32 bytes without padding (43 characters).
const TOKEN_PATTERN = /^eimcp_[A-Za-z0-9_-]{43}$/;
export const USER_JWT_TTL_SECONDS = 300;

const encoder = new TextEncoder();

export function isTokenFormat(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

// "Bearer eimcp_…" → the token, or null when the header is missing or is not a personal token.
export function bearerToken(header: string | null): string | null {
  const token = header?.replace(/^Bearer\s+/i, "").trim() ?? "";
  return isTokenFormat(token) ? token : null;
}

export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

// PostgREST takes bytea arguments as "\x…" hex.
export function toPgHex(bytes: Uint8Array): string {
  return "\\x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlJson(value: unknown): string {
  return base64url(encoder.encode(JSON.stringify(value)));
}

export type UserJwtClaims = {
  sub: string;
  role: "authenticated";
  aud: "authenticated";
  iat: number;
  exp: number;
  // Lets the database and the logs tell MCP calls from console calls.
  amr: [{ method: "mcp_token"; timestamp: number }];
  // Read JWT while usernames are hidden from assistants: my_tenant_roles() then reports 'viewer', so every
  // view and screen RPC masks users (migration *_mcp_masking.sql).
  mcp_mask?: true;
};

export function userClaims(userId: string, nowSeconds: number, options: { mask?: boolean; ttlSeconds?: number } = {}): UserJwtClaims {
  const ttl = options.ttlSeconds ?? USER_JWT_TTL_SECONDS;
  return {
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
    iat: nowSeconds,
    exp: nowSeconds + ttl,
    amr: [{ method: "mcp_token", timestamp: nowSeconds }],
    ...(options.mask ? { mcp_mask: true as const } : {}),
  };
}

export async function signJwt(claims: object, secret: string): Promise<string> {
  if (!secret) throw new Error("MCP_JWT_SECRET is not set");
  const head = base64urlJson({ alg: "HS256", typ: "JWT" });
  const body = base64urlJson(claims);
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${head}.${body}`)));
  return `${head}.${body}.${base64url(signature)}`;
}
