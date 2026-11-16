import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bearerToken, isTokenFormat, sha256, signJwt, toPgHex, userClaims, USER_JWT_TTL_SECONDS } from "./auth";

const TOKEN = "eimcp_" + "A".repeat(42) + "_";

function decode(part: string): unknown {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

describe("personal token", () => {
  it("accepts only eimcp_ + 43 base64url characters", () => {
    expect(isTokenFormat(TOKEN)).toBe(true);
    expect(isTokenFormat("eimcp_" + "A".repeat(42))).toBe(false);
    expect(isTokenFormat("eimcp_" + "A".repeat(42) + "=")).toBe(false);
    expect(isTokenFormat("eyJhbGciOiJIUzI1NiJ9.e30.x")).toBe(false);
  });

  it("reads it from a Bearer header and ignores anything else", () => {
    expect(bearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(bearerToken(`bearer   ${TOKEN} `)).toBe(TOKEN);
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("Bearer eyJhbGciOiJIUzI1NiJ9.e30.x")).toBeNull();
  });

  it("hashes like the database (sha256 → \\x hex)", async () => {
    const hex = toPgHex(await sha256("abc"));
    expect(hex).toBe("\\xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("user JWT", () => {
  it("carries the user, the authenticated role and a 5-minute expiry", () => {
    const claims = userClaims("00000000-0000-0000-0000-00000000000a", 1_000);
    expect(claims).toMatchObject({ sub: "00000000-0000-0000-0000-00000000000a", role: "authenticated", aud: "authenticated", iat: 1_000 });
    expect(claims.exp - claims.iat).toBe(USER_JWT_TTL_SECONDS);
    expect(USER_JWT_TTL_SECONDS).toBe(300);
    expect(claims.amr[0].method).toBe("mcp_token");
  });

  it("adds mcp_mask only when usernames are hidden", () => {
    expect(userClaims("u1", 1, { mask: true }).mcp_mask).toBe(true);
    expect("mcp_mask" in userClaims("u1", 1, { mask: false })).toBe(false);
    expect("mcp_mask" in userClaims("u1", 1)).toBe(false);
    expect(userClaims("u1", 1, { ttlSeconds: 60 }).exp).toBe(61);
  });

  it("names the token and its scope for the database limits and audit", () => {
    expect(userClaims("u1", 1, { token: { id: "t1", scope: "policy_draft" } })).toMatchObject({ mcp_token: "t1", mcp_scope: "policy_draft" });
    expect("mcp_token" in userClaims("u1", 1)).toBe(false);
  });

  it("is a valid HS256 token for the secret", async () => {
    const jwt = await signJwt(userClaims("u1", 1_000), "secret-of-at-least-32-characters-long!!");
    const [head, body, signature] = jwt.split(".");
    expect(decode(head)).toEqual({ alg: "HS256", typ: "JWT" });
    expect(decode(body)).toMatchObject({ sub: "u1", exp: 1_300 });
    const expected = createHmac("sha256", "secret-of-at-least-32-characters-long!!").update(`${head}.${body}`).digest("base64url");
    expect(signature).toBe(expected);
  });

  it("refuses to sign without a secret", async () => {
    await expect(signJwt(userClaims("u1", 1), "")).rejects.toThrow("MCP_JWT_SECRET");
  });
});
