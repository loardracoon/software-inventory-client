// Status check of the open access request (phase 10c): run by the collector when due and by Settings › Check now.
// approved → the request's Vault secret becomes the Hub connection key (hub_enrollment_activate) and the sync starts;
// rejected, expired, cancelled or unknown → the key is deleted.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { errorMessage } from "./edge.ts";
import { nextCheckDelayMs, readStatus, type FetchLike } from "./hub-enroll.ts";

const OPEN = ["unverified", "pending"];

export async function enrollmentCheckDue(admin: SupabaseClient): Promise<boolean> {
  const { data } = await admin.from("hub_enrollment").select("status, next_check_at").eq("id", 1).maybeSingle();
  return Boolean(data && OPEN.includes(data.status) && (!data.next_check_at || Date.parse(data.next_check_at) <= Date.now()));
}

// Returns the status after the check (null when no request is open).
export async function checkHubEnrollment(admin: SupabaseClient, fetchFn: FetchLike = fetch): Promise<string | null> {
  const { data, error } = await admin.rpc("hub_enrollment_key");
  if (error) throw new Error(`Could not read the access request: ${error.message}`);
  const row = (data as { hub_url: string; key: string; status: string }[] | null)?.[0];
  if (!row?.key || !OPEN.includes(row.status)) return row?.status ?? null;
  const { data: e } = await admin.from("hub_enrollment").select("requested_at").eq("id", 1).maybeSingle();
  const next = () => new Date(Date.now() + nextCheckDelayMs(e?.requested_at ?? null)).toISOString();
  const update = (status: string, note: string | null, err: string | null, nextAt: string | null) =>
    admin.rpc("hub_enrollment_update", { p_status: status, p_note: note, p_error: err, p_next_check_at: nextAt });

  let answer;
  try {
    answer = await readStatus(fetchFn, row.hub_url, row.key);
  } catch (err) {
    await update(row.status, null, errorMessage(err), next());
    return row.status;
  }
  if (answer.status === "approved") {
    const { error: activateError } = await admin.rpc("hub_enrollment_activate");
    if (activateError) throw new Error(`Could not save the Hub connection: ${activateError.message}`);
    return "approved";
  }
  await update(answer.status, answer.note ?? null, null, OPEN.includes(answer.status) ? next() : null);
  return answer.status;
}
