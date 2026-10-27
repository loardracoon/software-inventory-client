// Alert settings (webhook URL and Resend key are write-only: they go to Vault and never come back).

import type { Database } from "@/integrations/supabase/types";
import { db, invokeFunction, orThrow } from "@/lib/supabase-query";

export type AlertStatus = Database["public"]["Functions"]["get_alert_status"]["Returns"][number];

export type AlertSettingsInput = {
  webhookUrl: string; // empty = keep
  resendKey: string; // empty = keep
  emailFrom: string;
  emailTo: string[];
  coverageThreshold: number;
  staleMinutes: number;
  enabled: boolean;
};

export async function fetchAlertStatus(): Promise<AlertStatus> {
  return (orThrow(await db().rpc("get_alert_status")) ?? [])[0];
}

export async function saveAlertSettings(input: AlertSettingsInput): Promise<void> {
  orThrow(
    await db().rpc("set_alert_settings", {
      ...(input.webhookUrl.trim() ? { p_webhook_url: input.webhookUrl.trim() } : {}),
      ...(input.resendKey.trim() ? { p_resend_key: input.resendKey.trim() } : {}),
      p_email_from: input.emailFrom.trim(),
      p_email_to: input.emailTo,
      p_coverage_threshold: input.coverageThreshold,
      p_stale_minutes: input.staleMinutes,
      p_enabled: input.enabled,
    }),
  );
}

export async function removeAlertChannel(channel: "webhook" | "email"): Promise<void> {
  orThrow(await db().rpc("clear_alert_channel", { p_channel: channel }));
}

export function sendTestAlert(): Promise<{ ok: boolean; sent: number; failed: number; error?: string }> {
  return invokeFunction("alerts", { test: true });
}

export function parseRecipients(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
