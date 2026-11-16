// MCP policy and risk tools (Phase 11 M4, runtime-neutral, read only). The evaluator in ../policy.ts stays the
// only place that decides a class: the tester and the simulation run it on policy_preview_inputs, the same
// inputs and code the console's rule editor uses, so their answers match the console. Nothing here writes.

import {
  conditionText,
  evaluate,
  explain,
  FIELD_TYPE,
  OPERATORS_BY_TYPE,
  POLICY_CLASSES,
  TITLE_KINDS,
  traceText,
  validateRule,
  type PolicyClass,
  type PolicyCondition,
  type PolicyField,
  type PolicyInput,
  type PolicyOperator,
  type PolicyRule,
  type RuleMatch,
  type TitleKind,
} from "../policy.ts";
import { envelope, idArg, oneOf, oneTenant, orThrow, ToolError, type McpCaller, type McpData, type ToolOutput } from "./tools.ts";

const TOP = 20;
const PREVIEW_CAP = 20_000; // policy_preview_inputs returns at most this many (title, version) pairs
const CLASS_RANK: Record<PolicyClass, number> = { core_system: 0, sanctioned_app: 1, tolerated_app: 2, unsanctioned_app: 3 };

type RuleRow = PolicyRule & {
  lineage_id: string;
  position: number;
  owner: string | null;
  business_purpose: string | null;
  mitigating_controls: string | null;
  risk_accepted_by: string | null;
  review_by: string | null;
  alert_on_new: boolean;
};
type PolicyDoc = { version: number; status: string; default_class: PolicyClass; published_at: string | null; published_by: string | null; evaluated_at: string | null; rules: RuleRow[] };
type PolicyState = { published: PolicyDoc | null; draft: PolicyDoc | null; versions: Record<string, unknown>[]; can_edit: boolean };
export type PreviewInput = PolicyInput & { title_id: string; version: string; computers: number; installations: number; current_class: PolicyClass | null; current_rule_id: string | null };

async function policyState(data: McpData, tenantId: string): Promise<PolicyState> {
  const state = orThrow(await data.rpc<PolicyState>("policy_get", { p_tenant_id: tenantId }), "the policy");
  if (!state) throw new ToolError("No policy for this tenant");
  return state;
}

async function previewInputs(data: McpData, tenantId: string): Promise<PreviewInput[]> {
  return orThrow(await data.rpc<PreviewInput[]>("policy_preview_inputs", { p_tenant_id: tenantId }), "installed software") ?? [];
}

// The rules the evaluator runs; the lineage id is the rule id (as in the console).
function evaluatorRules(doc: PolicyDoc | null): PolicyRule[] {
  return (doc?.rules ?? []).map((r) => ({ ...r, id: r.lineage_id }));
}

// "draft" falls back to the published policy when there is no draft; `which` says which one was used.
function pickDoc(state: PolicyState, wanted: "published" | "draft"): { doc: PolicyDoc; which: "published" | "draft" } {
  const which = wanted === "draft" && state.draft ? "draft" : "published";
  const doc = which === "draft" ? state.draft : state.published;
  if (!doc) throw new ToolError(wanted === "draft" ? "This tenant has no policy yet" : "This tenant has no published policy yet");
  return { doc, which };
}

function ruleView(r: RuleRow) {
  return {
    rule_id: r.lineage_id,
    position: r.position,
    name: r.name,
    class: r.class,
    enabled: r.enabled,
    applies_to: r.kinds,
    match: r.match,
    conditions: r.conditions.map((c) => conditionText(c)),
    conditions_raw: r.conditions,
    ...(r.class === "tolerated_app"
      ? { exception: { owner: r.owner, business_purpose: r.business_purpose, mitigating_controls: r.mitigating_controls, risk_accepted_by: r.risk_accepted_by, review_by: r.review_by } }
      : {}),
    alert_on_new: r.alert_on_new,
  };
}

// get_policy -----------------------------------------------------------------------------------------

export const GET_POLICY_DESCRIPTION =
  "The application policy of one tenant (CIS Controls v8.1, Control 2): the published version and the draft " +
  "(when there is one), each with its default class and its rules top down (class, kinds, conditions in words, " +
  "and for tolerated rules the exception documentation). Rules run top down, disabled rules are skipped, the " +
  "first match wins, else the default class. Classes: core_system, sanctioned_app, tolerated_app, unsanctioned_app.";

export async function getPolicy(data: McpData, caller: McpCaller, args: Record<string, unknown>): Promise<ToolOutput> {
  const tenant = await oneTenant(data, args.tenant_id);
  const state = await policyState(data, tenant.id);
  const view = (d: PolicyDoc | null) =>
    d && {
      version: d.version,
      status: d.status,
      default_class: d.default_class,
      published_at: d.published_at,
      ...(caller.showUsernames ? { published_by: d.published_by } : {}),
      evaluated_at: d.evaluated_at,
      rules: d.rules.map(ruleView),
    };
  return {
    result: envelope(caller, {
      tenant,
      can_edit_draft: state.can_edit,
      published: view(state.published),
      draft: view(state.draft),
    }),
    rowCount: (state.published?.rules.length ?? 0) + (state.draft?.rules.length ?? 0),
    tenantId: tenant.id,
  };
}

// test_title_against_policy --------------------------------------------------------------------------

export const TEST_TITLE_DESCRIPTION =
  "Which class each installed version of one software title gets under the published policy (or the draft), " +
  "and why: for every rule up to the match, whether it matched or the first condition that failed with the " +
  "actual value. Same evaluator as the console's title tester.";

export async function testTitleAgainstPolicy(data: McpData, caller: McpCaller, args: Record<string, unknown>): Promise<ToolOutput> {
  const tenant = await oneTenant(data, args.tenant_id);
  const titleId = idArg(args.title_id, "title_id");
  const { doc, which } = pickDoc(await policyState(data, tenant.id), oneOf(args.policy, ["published", "draft"] as const, "policy") ?? "published");
  const rules = evaluatorRules(doc);
  const pairs = (await previewInputs(data, tenant.id)).filter((p) => p.title_id === titleId && (args.version === undefined || p.version === args.version));
  if (pairs.length === 0) throw new ToolError("This title (or version) is not installed in this tenant now");
  const names = new Map(rules.map((r) => [r.id, r.name]));
  const results = pairs.map((p) => {
    const { result, trace } = explain(rules, p, doc.default_class);
    return {
      version: p.version,
      computers: p.computers,
      class: result.class,
      decided_by: result.ruleId ? `rule ${result.ruleIndex + 1}: ${names.get(result.ruleId)}` : "default class",
      stored_class: p.current_class,
      inputs: { kind: p.kind, vendor: p.vendor, category: p.category_name, subcategory: p.subcategory_name, highest_cvss: p.max_cvss, kev: p.kev, highest_epss: p.max_epss, eol: p.eol },
      trace: trace.map((t) => `rule ${t.index + 1} (${names.get(t.ruleId)}): ${traceText(t)}`),
    };
  });
  return {
    result: envelope(caller, { tenant, policy: { which, version: doc.version, default_class: doc.default_class }, title: { title_id: titleId, name: pairs[0].name }, versions: results }, true),
    rowCount: results.length,
    tenantId: tenant.id,
  };
}

// simulate_rule --------------------------------------------------------------------------------------

const FIELDS = Object.keys(FIELD_TYPE) as PolicyField[];
const OPERATORS = [...new Set(Object.values(OPERATORS_BY_TYPE).flat())] as PolicyOperator[];

export type ProposedRule = { name: string; class: PolicyClass; match: RuleMatch; kinds: TitleKind[]; conditions: PolicyCondition[] };

// Checks a rule written by the assistant with the editor's own validation.
export function proposedRule(value: unknown): ProposedRule {
  if (!value || typeof value !== "object") throw new ToolError("rule is required");
  const v = value as Record<string, unknown>;
  const cls = oneOf(v.class, POLICY_CLASSES, "rule.class");
  if (!cls) throw new ToolError("rule.class is required");
  const kinds = Array.isArray(v.kinds) && v.kinds.length ? (v.kinds as unknown[]) : TITLE_KINDS;
  const conditions = (Array.isArray(v.conditions) ? v.conditions : []).map((c, i) => {
    const x = (c ?? {}) as Record<string, unknown>;
    const field = oneOf(x.field, FIELDS, `condition ${i + 1} field`);
    const operator = oneOf(x.operator, OPERATORS, `condition ${i + 1} operator`);
    if (!field || !operator) throw new ToolError(`Condition ${i + 1} needs a field and an operator`);
    const str = (s: unknown) => (s === undefined || s === null ? null : String(s));
    return {
      field,
      operator,
      value: str(x.value),
      value2: str(x.value2),
      values: Array.isArray(x.values) ? x.values.map(String) : null,
      case_sensitive: x.case_sensitive === true,
    } satisfies PolicyCondition;
  });
  const rule: ProposedRule = {
    name: typeof v.name === "string" ? v.name.trim().slice(0, 120) : "",
    class: cls,
    match: oneOf(v.match, ["all", "any"] as const, "rule.match") ?? "all",
    kinds: kinds.map((k) => oneOf(k, TITLE_KINDS, "rule.kinds")).filter((k): k is TitleKind => k !== null),
    conditions,
  };
  const errors = validateRule(rule);
  if (errors.length) throw new ToolError(`The rule is not valid: ${errors.join("; ")}`);
  return rule;
}

export type Simulation = {
  base: { which: "published" | "draft"; version: number; default_class: PolicyClass };
  position: number;
  pairs_evaluated: number;
  truncated: boolean;
  changed_pairs: number;
  changed_installations: number;
  transitions: { from: PolicyClass; to: PolicyClass; versions: number; installations: number }[];
  more_restrictive: number;
  less_restrictive: number;
  top_changed_titles: { title_id: string; name: string; kind: TitleKind; versions: string[]; from: PolicyClass; to: PolicyClass; computers: number }[];
  shadowed: boolean;
};

// Before = the base policy as is; after = the same rules with the proposed one at `position` (1 = top).
export function simulate(doc: PolicyDoc, which: "published" | "draft", rule: ProposedRule, position: number, inputs: PreviewInput[]): Simulation {
  const before = evaluatorRules(doc);
  const at = Math.min(Math.max(1, position), before.length + 1) - 1;
  const proposed: PolicyRule = { ...rule, id: "proposed", enabled: true };
  const after = [...before.slice(0, at), proposed, ...before.slice(at)];
  const transitions = new Map<string, { from: PolicyClass; to: PolicyClass; versions: number; installations: number }>();
  const titles = new Map<string, Simulation["top_changed_titles"][number]>();
  let changedPairs = 0;
  let changedInstallations = 0;
  let matchedProposed = 0;
  let more = 0;
  let less = 0;
  for (const p of inputs) {
    const a = evaluate(before, p, doc.default_class);
    const b = evaluate(after, p, doc.default_class);
    if (b.ruleId === "proposed") matchedProposed++;
    if (a.class === b.class) continue;
    changedPairs++;
    changedInstallations += p.installations;
    if (CLASS_RANK[b.class] > CLASS_RANK[a.class]) more++;
    else less++;
    const key = `${a.class}>${b.class}`;
    const t = transitions.get(key) ?? { from: a.class, to: b.class, versions: 0, installations: 0 };
    t.versions++;
    t.installations += p.installations;
    transitions.set(key, t);
    const tk = `${p.title_id}|${key}`;
    const title = titles.get(tk) ?? { title_id: p.title_id, name: p.name, kind: p.kind, versions: [], from: a.class, to: b.class, computers: 0 };
    title.versions.push(p.version);
    title.computers += p.computers;
    titles.set(tk, title);
  }
  return {
    base: { which, version: doc.version, default_class: doc.default_class },
    position: at + 1,
    pairs_evaluated: inputs.length,
    truncated: inputs.length >= PREVIEW_CAP,
    changed_pairs: changedPairs,
    changed_installations: changedInstallations,
    transitions: [...transitions.values()].sort((x, y) => y.installations - x.installations),
    more_restrictive: more,
    less_restrictive: less,
    top_changed_titles: [...titles.values()].sort((x, y) => y.computers - x.computers || x.name.localeCompare(y.name)).slice(0, TOP),
    // The rule matches nothing that reaches it: a rule above already decides those versions, or nothing matches.
    shadowed: matchedProposed === 0,
  };
}

export const SIMULATE_RULE_DESCRIPTION =
  "Simulate adding a rule to a tenant's policy without saving anything: which installed versions would change " +
  "class (from → to, versions, installations, the titles with the most computers) if the rule were placed at a " +
  "position (1 = top) of the published policy or the draft. Fields: vendor, name, category, subcategory, " +
  "version, external_id (text/category/version), cvss and epss (numbers), kev and eol (value \"true\"/\"false\"). " +
  "Category conditions take category slugs. Nothing is changed; a person publishes in the console.";

export async function simulateRule(data: McpData, caller: McpCaller, args: Record<string, unknown>): Promise<ToolOutput> {
  const tenant = await oneTenant(data, args.tenant_id);
  const rule = proposedRule(args.rule);
  const position = args.position === undefined ? 1 : Number(args.position);
  if (!Number.isInteger(position) || position < 1) throw new ToolError("position must be 1 or more (1 = top)");
  const { doc, which } = pickDoc(await policyState(data, tenant.id), oneOf(args.base, ["published", "draft"] as const, "base") ?? "draft");
  const inputs = await previewInputs(data, tenant.id);
  const sim = simulate(doc, which, rule, position, inputs);
  return {
    result: envelope(caller, { tenant, rule: { ...rule, conditions_text: rule.conditions.map((c) => conditionText(c)) }, simulation: sim, saved: false }, true),
    rowCount: sim.changed_pairs,
    tenantId: tenant.id,
  };
}

// Risks ----------------------------------------------------------------------------------------------

export type RiskKind =
  | "kev_installed"
  | "critical_vuln"
  | "eol_installed"
  | "unsanctioned_installed"
  | "exception_overdue"
  | "exception_incomplete"
  | "unclassified_attention";
export const RISK_KINDS: RiskKind[] = ["kev_installed", "critical_vuln", "eol_installed", "unsanctioned_installed", "exception_overdue", "exception_incomplete", "unclassified_attention"];
type Severity = "critical" | "high" | "medium" | "low";
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// Thresholds: certain matches only (the preview inputs carry certain matches only, like the policy fields).
export const RISK_THRESHOLDS = { cvss: 9, epss: 0.5 };

export type Risk = {
  kind: RiskKind;
  severity: Severity;
  subject: { title_id?: string; name: string; kind?: string; versions?: string[]; rule_id?: string; category_slug?: string };
  computers: number | null;
  evidence: Record<string, unknown>;
  next_step: string;
};

type TitleAgg = { title_id: string; name: string; kind: TitleKind; versions: string[]; computers: number; classes: Set<PolicyClass>; cvss: number; epss: number };

function byTitle(pairs: PreviewInput[]): TitleAgg[] {
  const out = new Map<string, TitleAgg>();
  for (const p of pairs) {
    const t = out.get(p.title_id) ?? { title_id: p.title_id, name: p.name, kind: p.kind, versions: [], computers: 0, classes: new Set<PolicyClass>(), cvss: 0, epss: 0 };
    t.versions.push(p.version);
    t.computers += p.computers;
    if (p.current_class) t.classes.add(p.current_class);
    t.cvss = Math.max(t.cvss, Number(p.max_cvss ?? 0));
    t.epss = Math.max(t.epss, Number(p.max_epss ?? 0));
    out.set(p.title_id, t);
  }
  return [...out.values()];
}

// Pure: every risk of a tenant from its installed pairs, its policy and its attention titles.
// Classes come from the evaluator on the published policy, not from the stored results, so a policy that was
// not evaluated yet (or a stale evaluation) cannot hide a risk; without a published policy, the stored class.
function withPublishedClasses(pairs: PreviewInput[], state: PolicyState): PreviewInput[] {
  if (!state.published) return pairs;
  const rules = evaluatorRules(state.published);
  return pairs.map((p) => {
    const e = evaluate(rules, p, state.published!.default_class);
    return { ...p, current_class: e.class, current_rule_id: e.ruleId };
  });
}

export function deriveRisks(input: { pairs: PreviewInput[]; state: PolicyState; attention: { title_id: string; canonical_name: string; kind: string; attention_level: string; category_slug: string; level2_name: string; computers: number }[]; today: string }): Risk[] {
  input = { ...input, pairs: withPublishedClasses(input.pairs, input.state) };
  const risks: Risk[] = [];
  const subject = (t: TitleAgg) => ({ title_id: t.title_id, name: t.name, kind: t.kind, versions: t.versions.slice(0, 10) });
  const notUnsanctioned = (t: TitleAgg) => !(t.classes.size === 1 && t.classes.has("unsanctioned_app"));
  for (const t of byTitle(input.pairs.filter((p) => p.kev === true))) {
    risks.push({
      kind: "kev_installed",
      severity: notUnsanctioned(t) ? "critical" : "high",
      subject: subject(t),
      computers: t.computers,
      evidence: { kev: true, highest_cvss: t.cvss || null, policy_classes: [...t.classes] },
      next_step: notUnsanctioned(t) ? "Update or remove it; a policy rule (kev is true → unsanctioned) makes it visible everywhere" : "Already unsanctioned: remove it or update to a fixed version",
    });
  }
  const kevTitles = new Set(risks.map((r) => r.subject.title_id));
  for (const t of byTitle(input.pairs.filter((p) => p.kev !== true && (Number(p.max_cvss ?? 0) >= RISK_THRESHOLDS.cvss || Number(p.max_epss ?? 0) >= RISK_THRESHOLDS.epss)))) {
    if (kevTitles.has(t.title_id)) continue;
    risks.push({
      kind: "critical_vuln",
      severity: "high",
      subject: subject(t),
      computers: t.computers,
      evidence: { highest_cvss: t.cvss || null, highest_epss: t.epss || null },
      next_step: "Update to a fixed version (see get_software_title); consider a rule on cvss or epss",
    });
  }
  for (const t of byTitle(input.pairs.filter((p) => p.eol === true))) {
    risks.push({
      kind: "eol_installed",
      severity: "high",
      subject: subject(t),
      computers: t.computers,
      evidence: { end_of_life: true, policy_classes: [...t.classes] },
      next_step: "Update to a supported release or remove it; a rule (eol is true → unsanctioned) covers every end-of-life version",
    });
  }
  const unsanctioned = byTitle(input.pairs.filter((p) => p.current_class === "unsanctioned_app")).sort((a, b) => b.computers - a.computers);
  for (const t of unsanctioned.slice(0, TOP)) {
    risks.push({
      kind: "unsanctioned_installed",
      severity: "high",
      subject: subject(t),
      computers: t.computers,
      evidence: { decided_by_default_class: input.pairs.some((p) => p.title_id === t.title_id && p.current_class === "unsanctioned_app" && p.current_rule_id === null) },
      next_step: "Remove it (CIS 2.3), or approve it with a sanctioned rule, or document an exception with a tolerated rule",
    });
  }
  for (const r of input.state.published?.rules ?? []) {
    if (r.class !== "tolerated_app" || !r.enabled) continue;
    if (!r.review_by || r.review_by < input.today) {
      risks.push({
        kind: "exception_overdue",
        severity: "medium",
        subject: { rule_id: r.lineage_id, name: r.name },
        computers: null,
        evidence: { review_by: r.review_by, owner: r.owner },
        next_step: "The owner reviews the exception (CIS 2.3: monthly) and sets a new review date in the console, or the rule is removed",
      });
    }
  }
  for (const r of input.state.draft?.rules ?? []) {
    if (r.class !== "tolerated_app") continue;
    const missing = (["owner", "business_purpose", "mitigating_controls", "risk_accepted_by", "review_by"] as const).filter((f) => !r[f]);
    if (missing.length) {
      risks.push({
        kind: "exception_incomplete",
        severity: "medium",
        subject: { rule_id: r.lineage_id, name: r.name },
        computers: null,
        evidence: { missing },
        next_step: "A person completes the exception in the draft before publishing (the publish refuses it as is)",
      });
    }
  }
  for (const a of input.attention) {
    risks.push({
      kind: "unclassified_attention",
      severity: a.attention_level === "not_allowed" ? "medium" : "low",
      subject: { title_id: a.title_id, name: a.canonical_name, kind: a.kind, category_slug: a.category_slug },
      computers: a.computers,
      evidence: { attention_level: a.attention_level, category: a.level2_name, decided_by: "default class (no explicit rule)" },
      next_step: "Decide it with an explicit rule (for example by subcategory) instead of the default class",
    });
  }
  return risks.sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] || (y.computers ?? 0) - (x.computers ?? 0) || x.subject.name.localeCompare(y.subject.name));
}

export const LIST_RISKS_DESCRIPTION =
  "Risks derived from one tenant's inventory and policy, most severe first: known-exploited CVEs installed " +
  "(critical when not already unsanctioned), CVSS ≥ 9 or EPSS ≥ 0.5, end-of-life versions, the unsanctioned " +
  "titles with the most computers, tolerated exceptions past or without a review date, tolerated rules in the " +
  "draft missing their documentation, and attention titles decided only by the default class. Certain CVE " +
  "matches only. Each risk has evidence and a next step; suggest_rule_for_risk proposes a rule for it.";

type AttentionRow = { title_id: string; canonical_name: string; kind: string; attention_level: string; category_slug: string; level2_name: string; computers: number; policy_rule_name: string | null };

async function riskInputs(data: McpData, tenantId: string) {
  const [pairs, state] = [await previewInputs(data, tenantId), await policyState(data, tenantId)];
  const attention = (orThrow(
    await data.rpc<AttentionRow[]>("search_titles", { p_tenant_id: tenantId, p_attention: ["review", "not_allowed"], p_sort: "computers", p_desc: true, p_limit: 50, p_offset: 0 }),
    "attention titles",
  ) ?? []).filter((t) => !t.policy_rule_name);
  return { pairs, state, attention };
}

export async function listRisks(data: McpData, caller: McpCaller, args: Record<string, unknown>): Promise<ToolOutput> {
  const tenant = await oneTenant(data, args.tenant_id);
  const kinds = args.kinds === undefined ? null : new Set((Array.isArray(args.kinds) ? args.kinds : [args.kinds]).map((k) => oneOf(k, RISK_KINDS, "kinds")));
  const inputs = await riskInputs(data, tenant.id);
  const all = deriveRisks({ ...inputs, today: new Date().toISOString().slice(0, 10) }).filter((r) => !kinds || kinds.has(r.kind));
  const counts: Record<string, number> = {};
  for (const r of all) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  const shown = all.slice(0, 50);
  return {
    result: envelope(caller, { tenant, thresholds: RISK_THRESHOLDS, total: all.length, by_kind: counts, truncated_inputs: inputs.pairs.length >= PREVIEW_CAP, risks: shown }, true),
    rowCount: shown.length,
    tenantId: tenant.id,
  };
}

// suggest_rule_for_risk ------------------------------------------------------------------------------

type Suggestion = { rule: ProposedRule | null; position: number; rationale: string; a_person_must: string[] };

const EXCEPTION_FIELDS = ["owner", "business purpose", "mitigating controls", "who accepts the risk (risk_accepted_by)", "a review date (at most a month ahead, CIS 2.3)"];

// Pure: a rule that answers one risk, or why a rule is not the answer.
export function suggestRule(risk: Risk, choice: "remove" | "tolerate" | "sanction"): Suggestion {
  const titleRule = (cls: PolicyClass, verb: string): ProposedRule => ({
    name: `${verb}: ${risk.subject.name}`.slice(0, 120),
    class: cls,
    match: "all",
    kinds: risk.subject.kind && (TITLE_KINDS as string[]).includes(risk.subject.kind) ? [risk.subject.kind as TitleKind] : [...TITLE_KINDS],
    conditions: [{ field: "name", operator: "equals", value: risk.subject.name }],
  });
  switch (risk.kind) {
    case "kev_installed":
      return {
        rule: { name: "Known exploited vulnerabilities (CISA KEV)", class: "unsanctioned_app", match: "all", kinds: [...TITLE_KINDS], conditions: [{ field: "kev", operator: "equals", value: "true" }] },
        position: 1,
        rationale: "Every installed version with a known-exploited CVE becomes unsanctioned at once, whatever rule allowed it before (CIS 2.2, 7).",
        a_person_must: ["publish the draft in the console after checking the simulation"],
      };
    case "critical_vuln":
      return {
        rule: { name: `Critical vulnerabilities (CVSS ≥ ${RISK_THRESHOLDS.cvss})`, class: "unsanctioned_app", match: "all", kinds: [...TITLE_KINDS], conditions: [{ field: "cvss", operator: "gte", value: String(RISK_THRESHOLDS.cvss) }] },
        position: 1,
        rationale: "Installed versions with a critical CVE become unsanctioned until they are updated.",
        a_person_must: ["publish the draft in the console after checking the simulation"],
      };
    case "eol_installed":
      return {
        rule: { name: "End of life (no vendor support)", class: "unsanctioned_app", match: "all", kinds: [...TITLE_KINDS], conditions: [{ field: "eol", operator: "equals", value: "true" }] },
        position: 1,
        rationale: "Unsupported software without an exception is unauthorized (CIS 2.2).",
        a_person_must: ["publish the draft in the console after checking the simulation"],
      };
    case "unsanctioned_installed":
    case "unclassified_attention":
      if (choice === "sanction")
        return { rule: titleRule("sanctioned_app", "Approved"), position: 1, rationale: "Authorizes the title with a business purpose (CIS 2.1).", a_person_must: ["confirm the business purpose", "publish the draft in the console"] };
      if (choice === "tolerate")
        return {
          rule: titleRule("tolerated_app", "Exception"),
          position: 1,
          rationale: "Keeps the title under a documented exception (CIS 2.3). The draft can hold it incomplete; the publish refuses it until a person fills the exception.",
          a_person_must: [...EXCEPTION_FIELDS.map((f) => `fill ${f}`), "publish the draft in the console"],
        };
      return {
        rule: titleRule("unsanctioned_app", "Not allowed"),
        position: 1,
        rationale: "States the decision explicitly instead of relying on the default class, so it survives a change of the default and can alert on new installs.",
        a_person_must: ["remove the title from the computers (CIS 2.3)", "publish the draft in the console"],
      };
    case "exception_overdue":
    case "exception_incomplete":
      return {
        rule: null,
        position: 0,
        rationale: "This is a review of an existing exception, not a new rule.",
        a_person_must: risk.kind === "exception_overdue" ? ["the owner reviews the exception and sets a new review date, or the rule is removed"] : (risk.evidence.missing as string[]).map((f) => `fill ${f}`),
      };
  }
}

export const SUGGEST_RULE_DESCRIPTION =
  "Propose a policy rule for one risk from list_risks (give its kind and, for title risks, its title_id; for " +
  "exception risks its rule_id) and simulate it on the draft: the rule, why, what a person must still do " +
  "(exception documentation, publishing) and which versions would change class. Nothing is saved. For title " +
  "risks choose remove (unsanctioned, default), tolerate (documented exception) or sanction (approve).";

export async function suggestRuleForRisk(data: McpData, caller: McpCaller, args: Record<string, unknown>): Promise<ToolOutput> {
  const tenant = await oneTenant(data, args.tenant_id);
  const kind = oneOf(args.kind, RISK_KINDS, "kind");
  if (!kind) throw new ToolError(`kind is required: ${RISK_KINDS.join(", ")}`);
  const choice = oneOf(args.choice, ["remove", "tolerate", "sanction"] as const, "choice") ?? "remove";
  const titleId = args.title_id ? idArg(args.title_id, "title_id") : null;
  const ruleId = args.rule_id ? idArg(args.rule_id, "rule_id") : null;
  const inputs = await riskInputs(data, tenant.id);
  const risks = deriveRisks({ ...inputs, today: new Date().toISOString().slice(0, 10) }).filter((r) => r.kind === kind);
  const risk =
    risks.find((r) => (titleId ? r.subject.title_id === titleId : ruleId ? r.subject.rule_id === ruleId : true)) ??
    null;
  if (!risk) throw new ToolError("No such risk now: run list_risks for the current ones");
  const suggestion = suggestRule(risk, choice);
  const base = suggestion.rule ? pickDoc(inputs.state, "draft") : null;
  const simulation = suggestion.rule && base ? simulate(base.doc, base.which, suggestion.rule, suggestion.position, inputs.pairs) : null;
  return {
    result: envelope(
      caller,
      {
        tenant,
        risk,
        suggestion: suggestion.rule
          ? { rule: { ...suggestion.rule, conditions_text: suggestion.rule.conditions.map((c) => conditionText(c)) }, position: suggestion.position, rationale: suggestion.rationale, a_person_must: suggestion.a_person_must }
          : { rule: null, rationale: suggestion.rationale, a_person_must: suggestion.a_person_must },
        simulation,
        saved: false,
      },
      true,
    ),
    rowCount: simulation?.changed_pairs ?? 0,
    tenantId: tenant.id,
  };
}
