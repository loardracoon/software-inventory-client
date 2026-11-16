// MCP draft tools (Phase 11 M5, runtime-neutral). They change the policy draft and nothing else, through the
// same RPCs as the console (policy_save_rule, policy_move_rule, policy_set_rule_enabled), so the same admin
// checks and audit apply. The database adds the assistant limits (migration *_mcp_draft_writes.sql): only a
// policy_draft token writes, no publish, discard, delete or default class, and risk_accepted_by is never filled.
// Each tool returns the class changes the draft gets from the edit, computed by the evaluator in ../policy.ts.

import { conditionText, type PolicyRule } from "../policy.ts";
import {
  compareRules,
  evaluatorRules,
  type Impact,
  pickDoc,
  type PolicyDoc,
  policyState,
  previewInputs,
  proposedRule,
  type RuleRow,
} from "./policy-tools.ts";
import { boolArg, envelope, idArg, oneTenant, textArg, ToolError, type McpCaller, type McpData, type ToolOutput } from "./tools.ts";

export const CONSOLE_POLICY_PATH = "/policies";
const MAX_REVIEW_DAYS = 31; // CIS 2.3: review exceptions monthly

const PUBLISH_NOTE = "Saved to the draft only. Nothing changes for any computer until a person reviews the draft and publishes it in the console (Policies).";

function requireDraftScope(caller: McpCaller): void {
  if (caller.scope !== "policy_draft") {
    throw new ToolError("This token can only read. An admin can create a token with the policy_draft scope in Settings › AI assistants.");
  }
}

// Database refusals become messages the assistant can act on.
function writeError(error: { code?: string; message: string }): never {
  if (error.code === "42501") throw new ToolError(error.message.startsWith("Only admins") ? "Only admins of this tenant can change its policy draft." : error.message);
  if (error.code === "P0002") throw new ToolError("That rule is not in the draft. Read the rules again with get_policy.");
  if (error.code === "22023" || error.code === "22P02") throw new ToolError(`The rule was refused: ${error.message}`);
  throw new ToolError(`Could not change the draft: ${error.message}`);
}

async function write<T>(data: McpData, name: string, args: Record<string, unknown>): Promise<T> {
  if (!data.write) throw new ToolError("Draft changes are not available on this server");
  const { data: out, error } = await data.write<T>(name, args);
  if (error) writeError(error);
  return out as T;
}

// The draft when there is one; else the published policy, which policy_ensure_draft copies into a new draft.
async function draftBase(data: McpData, tenantId: string): Promise<{ doc: PolicyDoc | null; which: "published" | "draft" | "empty" }> {
  const state = await policyState(data, tenantId);
  if (!state.draft && !state.published) return { doc: null, which: "empty" };
  return pickDoc(state, "draft");
}

function findRule(doc: PolicyDoc | null, ruleId: string): RuleRow {
  const rule = doc?.rules.find((r) => r.lineage_id === ruleId);
  if (!rule) throw new ToolError("Rule not found in the draft (or the published policy). Read the rules with get_policy.");
  return rule;
}

export function reviewDate(value: unknown, today: string): string | null {
  const text = textArg(value, 10);
  if (text === null || text === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw new ToolError("review_by must be a date (YYYY-MM-DD)");
  const days = (Date.parse(`${text}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  if (days < 0) throw new ToolError("review_by is in the past");
  if (days > MAX_REVIEW_DAYS) throw new ToolError(`review_by must be within ${MAX_REVIEW_DAYS} days (CIS 2.3: review exceptions monthly)`);
  return text;
}

// The rule's scope: what it matches and what it decides. An acceptance given by a person covers this scope only.
function scopeKey(r: Pick<PolicyRule, "class" | "match" | "kinds" | "conditions">): string {
  const conditions = r.conditions.map((c) => [c.field, c.operator, c.value ?? null, c.value2 ?? null, c.values ?? null, c.case_sensitive === true]);
  return JSON.stringify([r.class, r.match, [...r.kinds].sort(), conditions]);
}

function impactView(impact: Impact) {
  const { focus_matches, ...rest } = impact;
  return { ...rest, versions_decided_by_this_rule: focus_matches };
}

function rulesWith(doc: PolicyDoc | null, replace: (rules: PolicyRule[]) => PolicyRule[]): { before: PolicyRule[]; after: PolicyRule[] } {
  const before = evaluatorRules(doc);
  return { before, after: replace(before.map((r) => ({ ...r }))) };
}

function place(rules: PolicyRule[], id: string, position: number): PolicyRule[] {
  const rule = rules.find((r) => r.id === id);
  if (!rule) return rules;
  const rest = rules.filter((r) => r.id !== id);
  const at = Math.min(Math.max(1, position), rest.length + 1) - 1;
  return [...rest.slice(0, at), rule, ...rest.slice(at)];
}

// draft_save_rule ------------------------------------------------------------------------------------

export const DRAFT_SAVE_RULE_DESCRIPTION =
  "Add a rule to the tenant's policy draft, or change one (rule_id from get_policy). Creates the draft from the " +
  "published policy when there is none. Same rule shape as simulate_rule; run simulate_rule first and show the " +
  "person the result. For tolerated rules, give the exception documentation (owner, business purpose, mitigating " +
  "controls, review date within a month); who accepts the risk is always left for a person. Changing what a " +
  "tolerated rule matches clears an earlier acceptance. Never publishes: a person reviews and publishes the draft " +
  "in the console. Needs a token with the policy_draft scope and an admin of the tenant.";

export async function draftSaveRule(data: McpData, caller: McpCaller, args: Record<string, unknown>, today = new Date().toISOString().slice(0, 10)): Promise<ToolOutput> {
  requireDraftScope(caller);
  const tenant = await oneTenant(data, args.tenant_id);
  const rule = proposedRule(args.rule);
  const ruleId = args.rule_id === undefined || args.rule_id === null ? null : idArg(args.rule_id, "rule_id");
  const position = args.position === undefined || args.position === null ? null : Number(args.position);
  if (position !== null && (!Number.isInteger(position) || position < 1)) throw new ToolError("position must be 1 or more (1 = top)");

  const { doc, which } = await draftBase(data, tenant.id);
  const existing = ruleId ? findRule(doc, ruleId) : null;
  const ex = (args.exception ?? {}) as Record<string, unknown>;
  const keep = <K extends keyof RuleRow>(key: K) => (existing ? existing[key] : null);
  const doc_ = (key: "owner" | "business_purpose" | "mitigating_controls") => (ex[key] === undefined ? keep(key) : textArg(ex[key], 1000));
  const reviewBy = ex.review_by === undefined ? keep("review_by") : reviewDate(ex.review_by, today);

  // risk_accepted_by: kept only while the rule still matches and decides the same thing; never set here.
  const sameScope = existing !== null && scopeKey(existing) === scopeKey(rule);
  const acceptance = sameScope ? existing.risk_accepted_by : null;
  const enabled = boolArg(args.enabled) ?? existing?.enabled ?? true;
  const alertOnNew = boolArg(args.alert_on_new) ?? existing?.alert_on_new ?? false;

  const payload = {
    lineage_id: ruleId,
    position,
    name: rule.name,
    class: rule.class,
    match: rule.match,
    kinds: rule.kinds,
    enabled,
    conditions: rule.conditions,
    owner: doc_("owner"),
    business_purpose: doc_("business_purpose"),
    mitigating_controls: doc_("mitigating_controls"),
    risk_accepted_by: acceptance,
    review_by: reviewBy,
    alert_on_new: alertOnNew,
  };

  // The class changes this edit makes to the draft, from the same inputs the console's editor uses.
  const focus = ruleId ?? "new";
  const { before, after } = rulesWith(doc, (rules) => {
    const next: PolicyRule = { id: focus, name: rule.name, class: rule.class, match: rule.match, kinds: rule.kinds, conditions: rule.conditions, enabled };
    const list = existing ? rules.map((r) => (r.id === focus ? next : r)) : [...rules, next];
    return position !== null || !existing ? place(list, focus, position ?? list.length) : list;
  });
  const inputs = await previewInputs(data, tenant.id);
  const impact = compareRules(before, after, doc?.default_class ?? "unsanctioned_app", focus, inputs);

  const savedId = await write<string>(data, "policy_save_rule", { p_tenant_id: tenant.id, p_rule: payload });

  const missing: string[] = [];
  if (rule.class === "tolerated_app") {
    if (!payload.owner) missing.push("owner");
    if (!payload.business_purpose) missing.push("business purpose");
    if (!payload.mitigating_controls) missing.push("mitigating controls");
    if (!payload.review_by) missing.push("review date");
    if (!payload.risk_accepted_by) missing.push("who accepts the risk (risk_accepted_by)");
  }
  return {
    result: envelope(caller, {
      tenant,
      saved: true,
      action: existing ? "changed" : "added",
      rule_id: savedId,
      rule: { name: rule.name, class: rule.class, enabled, match: rule.match, kinds: rule.kinds, conditions_text: rule.conditions.map((c) => conditionText(c)) },
      draft: { created_now: which !== "draft", based_on: which === "draft" ? `draft version ${doc?.version}` : which === "published" ? `published version ${doc?.version}` : "empty policy" },
      ...(existing && existing.risk_accepted_by && !sameScope ? { acceptance_cleared: "The rule now matches or decides something else, so the earlier risk acceptance was cleared. A person must accept the risk again." } : {}),
      ...(missing.length ? { a_person_must_fill: missing } : {}),
      draft_impact: impactView(impact),
      next_step: PUBLISH_NOTE,
      console_path: `${CONSOLE_POLICY_PATH}/rules/${savedId}`,
    }, true),
    rowCount: 1,
    tenantId: tenant.id,
  };
}

// draft_move_rule ------------------------------------------------------------------------------------

export const DRAFT_MOVE_RULE_DESCRIPTION =
  "Move a rule of the tenant's policy draft to another position (1 = top; the first matching rule wins). Creates " +
  "the draft from the published policy when there is none. Returns the class changes the move makes. Never " +
  "publishes. Needs a token with the policy_draft scope and an admin of the tenant.";

export async function draftMoveRule(data: McpData, caller: McpCaller, args: Record<string, unknown>): Promise<ToolOutput> {
  requireDraftScope(caller);
  const tenant = await oneTenant(data, args.tenant_id);
  const ruleId = idArg(args.rule_id, "rule_id");
  const position = Number(args.position);
  if (!Number.isInteger(position) || position < 1) throw new ToolError("position must be 1 or more (1 = top)");
  const { doc } = await draftBase(data, tenant.id);
  const existing = findRule(doc, ruleId);
  const { before, after } = rulesWith(doc, (rules) => place(rules, ruleId, position));
  const impact = compareRules(before, after, doc?.default_class ?? "unsanctioned_app", ruleId, await previewInputs(data, tenant.id));
  const now = await write<number>(data, "policy_move_rule", { p_tenant_id: tenant.id, p_lineage_id: ruleId, p_position: position });
  return {
    result: envelope(caller, {
      tenant,
      saved: true,
      rule_id: ruleId,
      name: existing.name,
      from_position: existing.position,
      to_position: now,
      draft_impact: impactView(impact),
      next_step: PUBLISH_NOTE,
    }, true),
    rowCount: 1,
    tenantId: tenant.id,
  };
}

// draft_set_rule_enabled -----------------------------------------------------------------------------

export const DRAFT_SET_RULE_ENABLED_DESCRIPTION =
  "Turn a rule of the tenant's policy draft on or off (disabled rules are skipped). Use it instead of deleting a " +
  "rule; deleting is left to a person in the console. Returns the class changes. Never publishes. Needs a token " +
  "with the policy_draft scope and an admin of the tenant.";

export async function draftSetRuleEnabled(data: McpData, caller: McpCaller, args: Record<string, unknown>): Promise<ToolOutput> {
  requireDraftScope(caller);
  const tenant = await oneTenant(data, args.tenant_id);
  const ruleId = idArg(args.rule_id, "rule_id");
  const enabled = boolArg(args.enabled);
  if (enabled === null) throw new ToolError("enabled must be true or false");
  const { doc } = await draftBase(data, tenant.id);
  const existing = findRule(doc, ruleId);
  const { before, after } = rulesWith(doc, (rules) => rules.map((r) => (r.id === ruleId ? { ...r, enabled } : r)));
  const impact = compareRules(before, after, doc?.default_class ?? "unsanctioned_app", ruleId, await previewInputs(data, tenant.id));
  await write<null>(data, "policy_set_rule_enabled", { p_tenant_id: tenant.id, p_lineage_id: ruleId, p_enabled: enabled });
  return {
    result: envelope(caller, {
      tenant,
      saved: true,
      rule_id: ruleId,
      name: existing.name,
      enabled,
      was_enabled: existing.enabled,
      draft_impact: impactView(impact),
      next_step: PUBLISH_NOTE,
    }, true),
    rowCount: 1,
    tenantId: tenant.id,
  };
}

