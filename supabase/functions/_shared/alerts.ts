// Alert delivery: a JSON webhook (the `text` field works for Teams and Slack incoming webhooks) and an
// email through the Resend API. Runtime-neutral (Deno and Node) so Vitest can test it. The webhook URL
// and the Resend key never appear in errors or logs.

import { fetchWithRetry, type FetchLike, type Sleep } from "./http.ts";

export const RESEND_API_URL = "https://api.resend.com/emails";

export type Alert = {
  id: number;
  kind: string;
  title: string;
  body: string;
  data: unknown;
  created_at: string;
  tenant_name: string | null;
};

export type Channels = {
  webhookUrl: string | null;
  resendKey: string | null;
  emailFrom: string | null;
  emailTo: string[];
};

export function webhookPayload(alert: Alert) {
  const where = alert.tenant_name ? ` · ${alert.tenant_name}` : "";
  return {
    text: `Endpoint Inventory${where}: ${alert.title}\n${alert.body}`,
    title: alert.title,
    kind: alert.kind,
    tenant: alert.tenant_name,
    created_at: alert.created_at,
    data: alert.data,
  };
}

export function emailPayload(alert: Alert, from: string, to: string[]) {
  return {
    from,
    to,
    subject: `[Endpoint Inventory] ${alert.title}`,
    text: `${alert.body}\n\n${alert.tenant_name ? `Tenant: ${alert.tenant_name}\n` : ""}Detected: ${alert.created_at}\nKind: ${alert.kind}\n`,
  };
}

export function emailReady(channels: Channels): boolean {
  return Boolean(channels.resendKey && channels.emailFrom && channels.emailTo.length > 0);
}

// Sends one alert to every configured channel; returns one error message per failed channel.
export async function deliverAlert(
  alert: Alert,
  channels: Channels,
  options: { fetchFn?: FetchLike; sleep?: Sleep; resendUrl?: string } = {},
): Promise<string[]> {
  const fetchFn = options.fetchFn ?? fetch;
  const errors: string[] = [];
  const post = async (channel: string, url: string, headers: Record<string, string>, body: unknown) => {
    try {
      const response = await fetchWithRetry(fetchFn, url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }, { sleep: options.sleep });
      await response.body?.cancel();
      if (!response.ok) errors.push(`${channel}: HTTP ${response.status}`);
    } catch (error) {
      errors.push(`${channel}: ${error instanceof Error ? error.name : "network error"}`);
    }
  };
  if (channels.webhookUrl) await post("webhook", channels.webhookUrl, {}, webhookPayload(alert));
  if (emailReady(channels)) {
    await post("email", options.resendUrl ?? RESEND_API_URL, { Authorization: `Bearer ${channels.resendKey}` }, emailPayload(alert, channels.emailFrom!, channels.emailTo));
  }
  return errors;
}
