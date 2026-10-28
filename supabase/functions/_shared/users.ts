// Input checks for manage-users. Runtime-neutral, so Vitest tests them.

export const ROLES = ["admin", "operator", "viewer"] as const;
export type Role = (typeof ROLES)[number];
export type Invite = { email: string; role: Role; redirectTo: string | null };

const EMAIL = /^[^@\s]+@[a-z0-9.-]+\.[a-z]{2,}$/;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

// The link in the email goes back to the console the admin used; Auth also checks its allow list.
function parseRedirect(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("redirect_to must be a URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("redirect_to must be a URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("redirect_to must be http or https");
  return `${url.origin}/`;
}

export function parseInvite(body: unknown): Invite {
  if (typeof body !== "object" || body === null) throw new Error("Send a JSON object");
  const b = body as Record<string, unknown>;
  const email = normalizeEmail(b.email);
  if (!email) throw new Error("Enter a valid email address");
  if (!ROLES.includes(b.role as Role)) throw new Error("Role must be admin, operator or viewer");
  return { email, role: b.role as Role, redirectTo: parseRedirect(b.redirect_to) };
}
