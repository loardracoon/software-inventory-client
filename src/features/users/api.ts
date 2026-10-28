// Settings › Users and access: users with their role, the one-click invitation (manage-users) and the
// domain rules. Every call is admin-only on the server; the card is only shown to admins.

import type { Database } from "@/integrations/supabase/types";
import { db, invokeFunction, orThrow } from "@/lib/supabase-query";

export type AppRole = Database["public"]["Enums"]["app_role"];
export type UserRow = Database["public"]["Functions"]["list_users"]["Returns"][number];
export type AccessRule = Database["public"]["Tables"]["access_rules"]["Row"];

export const ROLE_LABEL: Record<AppRole, string> = { admin: "Admin", operator: "Operator", viewer: "Viewer" };
export const ROLE_HELP: Record<AppRole, string> = {
  admin: "Changes everything, including Settings and users",
  operator: "Sees everything, exports and runs scans; cannot change Settings",
  viewer: "Sees inventory without usernames and searches",
};

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

// "@Sophos.com", " sophos.com " → "sophos.com"; null when it is not a domain.
export function normalizeDomain(value: string): string | null {
  const domain = value.trim().toLowerCase().replace(/^@+/, "");
  return DOMAIN.test(domain) ? domain : null;
}

export async function fetchUsers(): Promise<UserRow[]> {
  return (orThrow(await db().rpc("list_users")) ?? []) as UserRow[];
}

export async function fetchDomainRules(): Promise<AccessRule[]> {
  return (orThrow(await db().from("access_rules").select("*").eq("kind", "domain").order("value")) ?? []) as AccessRule[];
}

export function inviteUser(email: string, role: AppRole): Promise<{ ok: boolean; status: "invited" | "existing" }> {
  return invokeFunction("manage-users", { email, role, redirect_to: window.location.origin });
}

export async function setUserRole(userId: string, role: AppRole): Promise<void> {
  orThrow(await db().rpc("set_user_role", { p_user_id: userId, p_role: role }));
}

export async function removeUser(userId: string): Promise<void> {
  orThrow(await db().rpc("remove_user", { p_user_id: userId }));
}

export async function addDomainRule(domain: string, role: AppRole): Promise<void> {
  orThrow(await db().rpc("add_access_rule", { p_kind: "domain", p_value: domain, p_role: role }));
}

export async function deleteAccessRule(id: string): Promise<void> {
  orThrow(await db().rpc("delete_access_rule", { p_id: id }));
}
