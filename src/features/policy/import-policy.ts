// Policies › Import policy: reads a file made by Export policy and checks it with the editor's rules before
// anything is sent. The database (policy_import) checks again and replaces only the draft.
import { POLICY_CLASSES, TITLE_KINDS, validateRule, type PolicyClass, type PolicyCondition, type RuleMatch, type TitleKind } from "@policy";
import { db, orThrow } from "@/lib/supabase-query";

export type ImportedRule = {
  name: string;
  class: PolicyClass;
  match: RuleMatch;
  kinds: TitleKind[];
  enabled: boolean;
  conditions: PolicyCondition[];
  owner?: string | null;
  business_purpose?: string | null;
  mitigating_controls?: string | null;
  risk_accepted_by?: string | null;
  review_by?: string | null;
  alert_on_new?: boolean;
};

export type ImportedPolicy = { version: number | null; default_class: PolicyClass | null; rules: ImportedRule[] };
export type ParseResult = { ok: true; policy: ImportedPolicy } | { ok: false; errors: string[] };

export const MAX_IMPORT_RULES = 500;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown) => (typeof v === "string" ? v : null);

export function parsePolicyFile(content: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return { ok: false, errors: ["The file is not JSON"] };
  }
  if (!isObject(data) || !Array.isArray(data.rules)) return { ok: false, errors: ["The file is not an exported policy (no rules list)"] };
  if (data.rules.length > MAX_IMPORT_RULES) return { ok: false, errors: [`A policy can have at most ${MAX_IMPORT_RULES} rules`] };
  const errors: string[] = [];
  const defaultClass = data.default_class ?? null;
  if (defaultClass !== null && !POLICY_CLASSES.includes(defaultClass as PolicyClass)) errors.push(`Unknown default class "${String(defaultClass)}"`);

  // In the file's order: position, then place in the list (as policy_import does).
  const ordered = data.rules
    .map((r, i) => ({ r, i, pos: isObject(r) && Number.isInteger(r.position) ? (r.position as number) : i + 1 }))
    .sort((a, b) => a.pos - b.pos || a.i - b.i);
  const rules: ImportedRule[] = [];
  ordered.forEach(({ r }, n) => {
    const where = `Rule ${n + 1}`;
    if (!isObject(r)) {
      errors.push(`${where}: not a rule`);
      return;
    }
    const rule: ImportedRule = {
      name: text(r.name) ?? "",
      class: r.class as PolicyClass,
      match: r.match === "any" ? "any" : "all",
      kinds: Array.isArray(r.kinds) ? (r.kinds as TitleKind[]) : [],
      enabled: r.enabled !== false,
      conditions: Array.isArray(r.conditions) ? (r.conditions as PolicyCondition[]) : [],
      owner: text(r.owner),
      business_purpose: text(r.business_purpose),
      mitigating_controls: text(r.mitigating_controls),
      risk_accepted_by: text(r.risk_accepted_by),
      review_by: text(r.review_by),
      alert_on_new: r.alert_on_new === true,
    };
    const label = rule.name ? `${where} "${rule.name}"` : where;
    if (!POLICY_CLASSES.includes(rule.class)) errors.push(`${label}: unknown class "${String(r.class)}"`);
    const badKinds = rule.kinds.filter((k) => !TITLE_KINDS.includes(k));
    if (badKinds.length) errors.push(`${label}: unknown kind ${badKinds.join(", ")}`);
    for (const e of validateRule(rule)) errors.push(`${label}: ${e}`);
    rules.push(rule);
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, policy: { version: typeof data.version === "number" ? data.version : null, default_class: defaultClass as PolicyClass | null, rules } };
}

// Replaces the draft's rules and default class; returns how many rules the draft has now.
export async function importPolicy(tenantId: string, policy: ImportedPolicy): Promise<number> {
  return orThrow(await db().rpc("policy_import", { p_tenant_id: tenantId, p_policy: policy as never })) as number;
}
