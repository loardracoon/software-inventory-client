// AI assistants (MCP server, Phase 11): settings and personal tokens. A token comes back once, at creation.

import type { Database } from "@/integrations/supabase/types";
import { supabaseUrl } from "@/integrations/supabase/client";
import { db, orThrow } from "@/lib/supabase-query";

export type McpSettings = Database["public"]["Functions"]["get_mcp_settings"]["Returns"][number];
export type McpToken = Database["public"]["Functions"]["mcp_token_list"]["Returns"][number];
export type McpScope = Database["public"]["Enums"]["mcp_scope"];
export type CreatedToken = Database["public"]["Functions"]["mcp_token_create"]["Returns"][number];

export const TOKEN_DAYS = [7, 30, 90] as const;

export function mcpServerUrl(base: string = supabaseUrl): string {
  return `${(base ?? "").replace(/\/+$/, "")}/functions/v1/mcp`;
}

export async function fetchMcpSettings(): Promise<McpSettings | null> {
  return (orThrow(await db().rpc("get_mcp_settings")) ?? [])[0] ?? null;
}

export async function saveMcpSettings(enabled: boolean, showUsernames: boolean): Promise<void> {
  orThrow(await db().rpc("set_mcp_settings", { p_enabled: enabled, p_show_usernames: showUsernames }));
}

export async function fetchMcpTokens(): Promise<McpToken[]> {
  return orThrow(await db().rpc("mcp_token_list")) ?? [];
}

export async function createMcpToken(name: string, scope: McpScope, days: number): Promise<CreatedToken> {
  const row = (orThrow(await db().rpc("mcp_token_create", { p_name: name.trim(), p_scope: scope, p_days: days })) ?? [])[0];
  if (!row) throw new Error("The token was not created");
  return row;
}

export async function revokeMcpToken(id: string): Promise<void> {
  orThrow(await db().rpc("mcp_token_revoke", { p_id: id }));
}

export type TokenState = "active" | "expired" | "revoked";

export function tokenState(token: Pick<McpToken, "revoked_at" | "expires_at">, now: Date = new Date()): TokenState {
  if (token.revoked_at) return "revoked";
  return new Date(token.expires_at).getTime() <= now.getTime() ? "expired" : "active";
}

// Claude Code: claude mcp add --transport http endpoint-inventory <url> --header "Authorization: Bearer <token>"
export function claudeCodeCommand(url: string, token: string): string {
  return `claude mcp add --transport http endpoint-inventory ${url} --header "Authorization: Bearer ${token}"`;
}
