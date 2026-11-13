// Settings › Audit log: rows, chain verification and CSV export. All calls are admin-only on the server.

import type { Database } from "@/integrations/supabase/types";
import { db, orThrow } from "@/lib/supabase-query";

export type AuditRow = Database["public"]["Tables"]["audit_log"]["Row"];

const DAY_MS = 86_400_000;

// from/to are "YYYY-MM-DD" (local days, both inclusive); empty = open.
function range(from: string, to: string) {
  return {
    p_from: from ? new Date(`${from}T00:00:00`).toISOString() : (null as unknown as string),
    p_to: to ? new Date(new Date(`${to}T00:00:00`).getTime() + DAY_MS).toISOString() : (null as unknown as string),
  };
}

export const AUDIT_PAGE = 500;

// Newest first; beforeId = keyset cursor for the next page.
export async function fetchAuditLog(from: string, to: string, limit = AUDIT_PAGE, beforeId?: number): Promise<AuditRow[]> {
  let query = db().rpc("export_audit_log", range(from, to));
  if (beforeId !== undefined) query = query.lt("id", beforeId);
  return (orThrow(await query.limit(limit)) ?? []) as AuditRow[];
}

// Every row of the range, oldest first. The server caps one answer (max_rows), so page until a short page.
export async function collectAuditPages(fetchPage: (beforeId?: number) => Promise<AuditRow[]>): Promise<AuditRow[]> {
  const all: AuditRow[] = [];
  for (let before: number | undefined; ; ) {
    const page = await fetchPage(before);
    all.push(...page);
    if (page.length < AUDIT_PAGE) break;
    before = page[page.length - 1].id;
  }
  return all.reverse();
}

export async function verifyAuditLog(): Promise<{ checked: number; first_bad_id: number | null }> {
  const row = (orThrow(await db().rpc("verify_audit_log")) ?? [])[0];
  return { checked: Number(row?.checked ?? 0), first_bad_id: row?.first_bad_id ?? null };
}

// RFC 4180 quoting; a cell starting with = + - @ gets a leading ' so spreadsheets do not run it as a formula.
function cell(value: unknown): string {
  let text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function auditCsv(rows: AuditRow[], emails: Map<string, string>): string {
  const head = "id,created_at,user,action,target,data,prev_hash,row_hash";
  const lines = rows.map((r) =>
    [r.id, r.created_at, r.user_id ? (emails.get(r.user_id) ?? r.user_id) : "", r.action, r.target, r.data, r.prev_hash, r.row_hash].map(cell).join(","),
  );
  return [head, ...lines].join("\r\n");
}

export function downloadCsv(csv: string): void {
  const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
