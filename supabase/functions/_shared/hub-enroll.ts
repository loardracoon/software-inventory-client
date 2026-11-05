// Access request to the Sophizo Hub (phase 10c), shared by the hub-enroll function and the collector. This app makes
// the client key, keeps it in the Vault and sends the Hub only its SHA-256 hash, so the key is never handed over (not
// in the request, not in an email); the request status is read with the key itself, as later API calls are. Runtime-neutral (Deno and Node) so Vitest can test it.

import { CONSENT_VERSION, SOPHIZO_HUB_URL } from "./hub-consent.ts";

export { CONSENT_VERSION, SOPHIZO_HUB_URL };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type EnrollmentForm = { name: string; organization: string | null; contact_email: string; reason: string | null };
export type HubAnswer = { status: string; note?: string | null; expires_at?: string | null };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const HEX = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

// 256 random bits in the Hub's key format.
export function newClientKey(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return `hubk_${HEX(random(32))}`;
}

export async function sha256Hex(value: string): Promise<string> {
  return HEX(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

// The Hub this app asks: the Sophizo Hub. ENROLLMENT_HUB_URL (server env, never the browser) points tests at a local Hub.
export function enrollmentHubUrl(env: (name: string) => string | undefined): string {
  return (env("ENROLLMENT_HUB_URL") || SOPHIZO_HUB_URL).replace(/\/+$/, "");
}

export function validateForm(body: Record<string, unknown>): EnrollmentForm {
  const text = (v: unknown, field: string, max: number, required: boolean): string | null => {
    const s = typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim() : "";
    if (!s) {
      if (required) throw new Error(`Enter the ${field}`);
      return null;
    }
    if (s.length > max) throw new Error(`The ${field} can have at most ${max} characters`);
    return s;
  };
  if (body.consent !== true || body.consent_version !== CONSENT_VERSION) {
    throw new Error("Agree that application information is sent to the Hub and processed by third-party AI models");
  }
  const email = text(body.contact_email, "contact email", 254, true)!.toLowerCase();
  if (!EMAIL.test(email)) throw new Error("Enter a valid contact email");
  return {
    name: text(body.name, "installation name", 120, true)!,
    organization: text(body.organization, "organization", 120, false),
    contact_email: email,
    reason: text(body.reason, "reason", 500, false),
  };
}

// The request body: these fields only (never the key, never inventory data).
export function requestBody(form: EnrollmentForm, keyHash: string, key: string, clientVersion: string | null) {
  return {
    action: "create",
    name: form.name,
    organization: form.organization,
    contact_email: form.contact_email,
    reason: form.reason,
    key_hash: keyHash,
    key_prefix: key.slice(0, 11),
    consent_version: CONSENT_VERSION,
    client_version: clientVersion,
  };
}

// How long to wait before the next status check: every 5 minutes in the first hour, then every 15 minutes, then hourly
// after a day (a request ends after 14 days).
export function nextCheckDelayMs(requestedAt: string | null, now = Date.now()): number {
  const age = requestedAt ? now - Date.parse(requestedAt) : 0;
  if (age < 3600_000) return 5 * 60_000;
  if (age < 86_400_000) return 15 * 60_000;
  return 60 * 60_000;
}

// Calls to the Hub never follow redirects: the key goes to the Hub's own address only.
export async function hubCall(fetchFn: FetchLike, url: string, init: RequestInit): Promise<Response> {
  return await fetchFn(url, { ...init, redirect: "error" });
}

export async function readStatus(fetchFn: FetchLike, hubUrl: string, key: string): Promise<HubAnswer> {
  const res = await hubCall(fetchFn, `${hubUrl}/functions/v1/client-enrollments`, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
  const body = (await res.json().catch(() => null)) as HubAnswer | null;
  if (res.status === 404) return { status: "unknown" };
  if (!res.ok || !body?.status) throw new Error(`The Hub answered HTTP ${res.status}`);
  return body;
}
