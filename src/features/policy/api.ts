// Application policy (Phase 9). Reads go through policy_get / policy_overview / policy_preview_inputs;
// every change is an RPC on the tenant's draft (admins only, audited). After a publish the browser
// runs the policy-evaluate Edge Function so the stored classes follow at once.
import type { Database } from "@/integrations/supabase/types";
import { db, invokeFunction, orThrow } from "@/lib/supabase-query";
import type { PageRequest, Page } from "@/features/inventory/api";
import type { PolicyClass, PolicyCondition, PolicyInput, PolicyRule, RuleMatch, TitleKind } from "@policy";

export type PolicyRuleRow = PolicyRule & {
  lineage_id: string;
  position: number;
  owner: string | null;
  business_purpose: string | null;
  mitigating_controls: string | null;
  risk_accepted_by: string | null;
  review_by: string | null;
  alert_on_new: boolean;
  updated_at: string;
};

export type PolicyDoc = {
  id: string;
  tenant_id: string;
  version: number;
  status: "draft" | "published" | "archived";
  default_class: PolicyClass;
  note: string | null;
  created_at: string;
  published_at: string | null;
  published_by: string | null;
  evaluated_at: string | null;
  rules: PolicyRuleRow[];
};

export type PolicyState = {
  published: PolicyDoc | null;
  draft: PolicyDoc | null;
  versions: { version: number; status: string; published_at: string | null; published_by: string | null }[];
  can_edit: boolean;
};

export type PreviewInput = PolicyInput & {
  title_id: string;
  version: string;
  computers: number;
  installations: number;
  current_class: PolicyClass | null;
  current_rule_id: string | null;
};

export type PolicyOverview = {
  classes: { class: PolicyClass; titles: number; installations: number }[];
  total_titles: number;
  total_installations: number;
  not_evaluated_titles: number;
  default_titles: number;
  unsanctioned_installations: number;
  unsanctioned_computers: number;
  exceptions: { tenant_id: string; lineage_id: string; name: string; owner: string | null; review_by: string | null; overdue: boolean }[];
  published: { version: number; published_at: string; evaluated_at: string | null; default_class: PolicyClass; published_by: string | null } | null;
};

// What the editor sends to policy_save_rule.
export type RuleDraft = {
  lineage_id?: string | null;
  position?: number | null;
  name: string;
  class: PolicyClass;
  match: RuleMatch;
  kinds: TitleKind[];
  enabled: boolean;
  owner: string;
  business_purpose: string;
  mitigating_controls: string;
  risk_accepted_by: string;
  review_by: string;
  alert_on_new: boolean;
  conditions: PolicyCondition[];
};

export type ClassChangeRow = Database["public"]["Views"]["v_policy_class_changes"]["Row"];

// The rules the evaluator runs: the draft when there is one, else the published policy. The lineage
// id is the rule id, so draft and published rules compare and link the same way.
export function effectivePolicy(state: PolicyState | null): PolicyDoc | null {
  return state?.draft ?? state?.published ?? null;
}

export function evaluatorRules(doc: PolicyDoc | null): PolicyRule[] {
  return (doc?.rules ?? []).map((r) => ({ ...r, id: r.lineage_id }));
}

// Rules whose content differs between the draft and the published version (by lineage), plus deleted ones.
export function draftChanges(state: PolicyState | null): { changed: Set<string>; added: Set<string>; removed: number; total: number } {
  const changed = new Set<string>();
  const added = new Set<string>();
  if (!state?.draft) return { changed, added, removed: 0, total: 0 };
  const published = new Map((state.published?.rules ?? []).map((r) => [r.lineage_id, r]));
  const key = (r: PolicyRuleRow) =>
    JSON.stringify([r.position, r.name, r.class, r.match, r.kinds, r.enabled, r.owner, r.business_purpose, r.mitigating_controls, r.risk_accepted_by, r.review_by, r.alert_on_new, r.conditions]);
  for (const r of state.draft.rules) {
    const before = published.get(r.lineage_id);
    if (!before) added.add(r.lineage_id);
    else if (key(before) !== key(r)) changed.add(r.lineage_id);
  }
  const draftIds = new Set(state.draft.rules.map((r) => r.lineage_id));
  const removed = [...published.keys()].filter((id) => !draftIds.has(id)).length;
  const defaultChanged = state.published && state.published.default_class !== state.draft.default_class ? 1 : 0;
  return { changed, added, removed, total: changed.size + added.size + removed + defaultChanged };
}

export async function fetchPolicy(tenantId: string): Promise<PolicyState | null> {
  return orThrow(await db().rpc("policy_get", { p_tenant_id: tenantId })) as unknown as PolicyState | null;
}

export async function fetchPreviewInputs(tenantId: string): Promise<PreviewInput[]> {
  return (orThrow(await db().rpc("policy_preview_inputs", { p_tenant_id: tenantId })) ?? []) as PreviewInput[];
}

export const PREVIEW_CAP = 20_000;

export async function fetchPolicyOverview(tenantId: string | null): Promise<PolicyOverview> {
  return orThrow(await db().rpc("policy_overview", tenantId ? { p_tenant_id: tenantId } : {})) as unknown as PolicyOverview;
}

export async function fetchRuleHistory(tenantId: string, lineageId: string) {
  return (orThrow(await db().rpc("policy_rule_history", { p_tenant_id: tenantId, p_lineage_id: lineageId })) ?? []) as unknown as {
    version: number;
    status: string;
    published_at: string | null;
    published_by: string | null;
    position: number;
    name: string;
    class: PolicyClass;
    enabled: boolean;
    updated_at: string;
  }[];
}

export async function saveRule(tenantId: string, rule: RuleDraft): Promise<string> {
  const conditions = rule.conditions.map((c) => ({
    field: c.field,
    operator: c.operator,
    value: c.value ?? null,
    value2: c.operator === "between" ? (c.value2 ?? null) : null,
    values: c.values?.length ? c.values : null,
    case_sensitive: Boolean(c.case_sensitive),
  }));
  return orThrow(await db().rpc("policy_save_rule", { p_tenant_id: tenantId, p_rule: { ...rule, conditions } })) as string;
}

export async function moveRule(tenantId: string, lineageId: string, position: number): Promise<number> {
  return orThrow(await db().rpc("policy_move_rule", { p_tenant_id: tenantId, p_lineage_id: lineageId, p_position: position })) as number;
}

export async function setRuleEnabled(tenantId: string, lineageId: string, enabled: boolean): Promise<void> {
  orThrow(await db().rpc("policy_set_rule_enabled", { p_tenant_id: tenantId, p_lineage_id: lineageId, p_enabled: enabled }));
}

export async function deleteRule(tenantId: string, lineageId: string): Promise<void> {
  orThrow(await db().rpc("policy_delete_rule", { p_tenant_id: tenantId, p_lineage_id: lineageId }));
}

export async function setDefaultClass(tenantId: string, cls: PolicyClass): Promise<void> {
  orThrow(await db().rpc("policy_set_default_class", { p_tenant_id: tenantId, p_class: cls }));
}

export async function discardDraft(tenantId: string): Promise<void> {
  orThrow(await db().rpc("policy_discard_draft", { p_tenant_id: tenantId }));
}

export type EvaluateSummary = { ok: boolean; evaluated: number; changed: number; complete: boolean; errors?: string[]; error?: string };

// Publishes the draft, then classifies every current (title, version) under it. When the evaluation
// stops early, the collector finishes it on its next tick.
export async function publishPolicy(tenantId: string): Promise<{ version: number; evaluation: EvaluateSummary | null; evaluationError: string | null }> {
  const published = orThrow(await db().rpc("policy_publish", { p_tenant_id: tenantId })) as unknown as { version: number };
  try {
    const evaluation = await invokeFunction<EvaluateSummary>("policy-evaluate", { tenant_id: tenantId });
    return { version: published.version, evaluation, evaluationError: null };
  } catch (e) {
    return { version: published.version, evaluation: null, evaluationError: e instanceof Error ? e.message : "Evaluation failed" };
  }
}

export type ClassChangeFilters = { tenantId: string | null; kind: TitleKind | ""; search: string; from: string | null; to: string | null };

export async function fetchClassChanges(filters: ClassChangeFilters, request: PageRequest): Promise<Page<ClassChangeRow>> {
  const from = request.pageIndex * request.pageSize;
  let q = db()
    .from("v_policy_class_changes")
    .select("*", { count: "exact" })
    .order("changed_at", { ascending: false })
    .range(from, from + request.pageSize - 1)
    .abortSignal(request.signal);
  if (filters.tenantId) q = q.eq("tenant_id", filters.tenantId);
  if (filters.kind) q = q.eq("kind", filters.kind);
  if (filters.from) q = q.gte("changed_at", filters.from);
  if (filters.to) q = q.lte("changed_at", filters.to);
  if (filters.search.trim()) {
    const s = `%${filters.search.replace(/[%_,()*\\]/g, " ").trim()}%`;
    q = q.or(`canonical_name.ilike.${s},external_id.ilike.${s}`);
  }
  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return { rows: data ?? [], rowCount: count ?? 0 };
}
