// Application policy evaluator (Phase 9, CIS Controls v8.1 Control 2). One module for the browser
// (rule editor preview, title tester) and the policy-evaluate Edge Function, so they cannot disagree.
// Runtime-neutral: no Deno, DOM or npm imports. Semantics follow design/reference/policy-evaluator.js,
// except that the app evaluates each installed version instead of the title's newest version.

export type PolicyClass = "core_system" | "sanctioned_app" | "tolerated_app" | "unsanctioned_app";
export type PolicyField = "vendor" | "name" | "category" | "subcategory" | "version" | "external_id" | "cvss" | "kev" | "epss";
export type PolicyOperator =
  "equals" | "not_equals" | "contains" | "not_contains" | "starts_with" | "ends_with" | "regex" | "in" | "not_in" | "gt" | "gte" | "lt" | "lte" | "between";
export type RuleMatch = "all" | "any";
export type TitleKind = "program" | "extension" | "ide_extension" | "package";

export type PolicyCondition = {
  field: PolicyField;
  operator: PolicyOperator;
  value?: string | null;
  value2?: string | null;
  values?: string[] | null;
  case_sensitive?: boolean | null;
};

export type PolicyRule = {
  id: string;
  name: string;
  class: PolicyClass;
  match: RuleMatch;
  kinds: TitleKind[];
  enabled: boolean;
  conditions: PolicyCondition[];
};

// The classification inputs of one installed (title, version). Categories carry the slug (what the
// editor stores) and the name (what text operators read).
export type PolicyInput = {
  kind: TitleKind;
  name: string;
  vendor?: string | null;
  external_id?: string | null;
  version?: string | null;
  category_slug?: string | null;
  category_name?: string | null;
  subcategory_slug?: string | null;
  subcategory_name?: string | null;
  // Known vulnerabilities of this installed version (Phase 10b, certain matches only): highest CVSS
  // score (0 = none), any CVE in the CISA KEV catalog, highest EPSS probability (0 to 1).
  max_cvss?: number | null;
  kev?: boolean | null;
  max_epss?: number | null;
};

export type Evaluation = {
  class: PolicyClass;
  ruleIndex: number;
  ruleId: string | null;
};

export type RuleTrace =
  | { ruleId: string; index: number; matched: true }
  | {
      ruleId: string;
      index: number;
      matched: false;
      reason: "disabled" | "kind" | "no_condition" | "no_match";
    }
  | {
      ruleId: string;
      index: number;
      matched: false;
      reason: "condition";
      condition: PolicyCondition;
      actual: string;
    };

export const POLICY_CLASSES: PolicyClass[] = ["core_system", "sanctioned_app", "tolerated_app", "unsanctioned_app"];
export const TITLE_KINDS: TitleKind[] = ["program", "extension", "ide_extension", "package"];
export const REGEX_MAX_LENGTH = 200;

export type FieldType = "text" | "category" | "version" | "number" | "boolean";
export const FIELD_TYPE: Record<PolicyField, FieldType> = {
  vendor: "text",
  name: "text",
  external_id: "text",
  category: "category",
  subcategory: "category",
  version: "version",
  cvss: "number",
  kev: "boolean",
  epss: "number",
};

// Allowed values of the number fields.
export const NUMBER_RANGE: Partial<Record<PolicyField, [number, number]>> = { cvss: [0, 10], epss: [0, 1] };

export const OPERATORS_BY_TYPE: Record<FieldType, PolicyOperator[]> = {
  text: ["equals", "not_equals", "contains", "not_contains", "starts_with", "ends_with", "regex", "in", "not_in"],
  category: ["equals", "not_equals", "in", "not_in"],
  version: ["equals", "not_equals", "gt", "gte", "lt", "lte", "between", "regex"],
  number: ["gte", "gt", "lte", "lt", "equals", "not_equals", "between"],
  boolean: ["equals", "not_equals"],
};

export const FIELD_LABEL: Record<PolicyField, string> = {
  vendor: "Vendor / publisher",
  name: "App name",
  category: "Category",
  subcategory: "Subcategory",
  version: "Version",
  external_id: "Extension or package ID",
  cvss: "Highest CVSS score",
  kev: "Known exploited (CISA KEV)",
  epss: "Highest EPSS probability",
};

export const OPERATOR_LABEL: Record<PolicyOperator, string> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  not_contains: "does not contain",
  starts_with: "starts with",
  ends_with: "ends with",
  regex: "matches regex",
  in: "is one of",
  not_in: "is not one of",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  between: "between",
};

// Most restrictive first: a title with several installed versions shows the worst class.
export const CLASS_SEVERITY: Record<PolicyClass, number> = {
  core_system: 0,
  sanctioned_app: 1,
  tolerated_app: 2,
  unsanctioned_app: 3,
};

// Versions compare number by number on . - + _ and space (10.2 > 9.14; 21.011.20039 < 24). Non-numeric
// parts compare as text; missing parts count as 0.
export function compareVersions(a: string, b: string): number {
  const x = a.trim().split(/[.\-+_ ]/);
  const y = b.trim().split(/[.\-+_ ]/);
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const p = x[i] ?? "0";
    const q = y[i] ?? "0";
    if (/^\d+$/.test(p) && /^\d+$/.test(q)) {
      const d = Number.parseInt(p, 10) - Number.parseInt(q, 10);
      if (d) return d < 0 ? -1 : 1;
    } else if (p !== q) {
      return p < q ? -1 : 1;
    }
  }
  return 0;
}

// Text lists: values[] when set (categories), else the comma-separated value.
export function conditionList(c: PolicyCondition): string[] {
  if (c.values && c.values.length) return c.values;
  return String(c.value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const regexCache = new Map<string, RegExp | null>();
function compiled(pattern: string, caseSensitive: boolean): RegExp | null {
  const key = `${caseSensitive ? "s" : "i"}:${pattern}`;
  if (!regexCache.has(key)) {
    let re: RegExp | null = null;
    try {
      re = new RegExp(pattern, caseSensitive ? "" : "i");
    } catch {
      re = null;
    }
    if (regexCache.size > 500) regexCache.clear();
    regexCache.set(key, re);
  }
  return regexCache.get(key) ?? null;
}

// The value a field reads; for categories the name (text operators) and the slug (exact operators).
export function fieldValue(input: PolicyInput, field: PolicyField): string {
  switch (field) {
    case "vendor":
      return input.vendor ?? "";
    case "name":
      return input.name ?? "";
    case "category":
      return input.category_name ?? "";
    case "subcategory":
      return input.subcategory_name ?? "";
    case "version":
      return input.version ?? "";
    case "external_id":
      return input.external_id ?? "";
    case "cvss":
      return String(input.max_cvss ?? 0);
    case "kev":
      return input.kev ? "true" : "false";
    case "epss":
      return String(input.max_epss ?? 0);
  }
}

// "true" / "yes" / "1" are true; anything else is false.
export const booleanValue = (v: string | null | undefined): boolean => ["true", "yes", "1"].includes((v ?? "").trim().toLowerCase());

const numberValue = (v: string | null | undefined): number => (v == null || v.trim() === "" ? Number.NaN : Number(v));

function fieldSlug(input: PolicyInput, field: PolicyField): string {
  if (field === "category") return input.category_slug ?? "";
  if (field === "subcategory") return input.subcategory_slug ?? "";
  return "";
}

export function testCondition(c: PolicyCondition, input: PolicyInput): boolean {
  const raw = fieldValue(input, c.field);
  const cs = Boolean(c.case_sensitive);
  if (c.operator === "regex") {
    const re = compiled(c.value ?? "", cs);
    return re ? re.test(raw) : false;
  }

  const type = FIELD_TYPE[c.field];
  if (type === "boolean") {
    const same = booleanValue(raw) === booleanValue(c.value);
    return c.operator === "equals" ? same : c.operator === "not_equals" ? !same : false;
  }
  if (type === "number") {
    const x = Number(raw);
    const v = numberValue(c.value);
    if (Number.isNaN(v)) return false;
    switch (c.operator) {
      case "equals":
        return x === v;
      case "not_equals":
        return x !== v;
      case "gt":
        return x > v;
      case "gte":
        return x >= v;
      case "lt":
        return x < v;
      case "lte":
        return x <= v;
      case "between": {
        const w = numberValue(c.value2);
        return !Number.isNaN(w) && x >= v && x <= w;
      }
      default:
        return false;
    }
  }
  if (type === "version") {
    if (!raw) return false;
    const cmp = compareVersions(raw, c.value || "0");
    switch (c.operator) {
      case "equals":
        return cmp === 0;
      case "not_equals":
        return cmp !== 0;
      case "gt":
        return cmp > 0;
      case "gte":
        return cmp >= 0;
      case "lt":
        return cmp < 0;
      case "lte":
        return cmp <= 0;
      case "between":
        return cmp >= 0 && compareVersions(raw, c.value2 || c.value || "0") <= 0;
      default:
        return false;
    }
  }

  const norm = (s: string) => (cs ? s : s.toLowerCase());
  const a = norm(raw);
  const v = norm(c.value ?? "");
  if (type === "category") {
    // Categories match by slug (stored by the editor) or by name (readable rules, imports).
    const slug = norm(fieldSlug(input, c.field));
    const hit = (x: string) => x !== "" && (x === a || x === slug);
    switch (c.operator) {
      case "equals":
        return hit(v);
      case "not_equals":
        return !hit(v);
      case "in":
        return conditionList(c).map(norm).some(hit);
      case "not_in":
        return !conditionList(c).map(norm).some(hit);
      default:
        return false;
    }
  }

  switch (c.operator) {
    case "equals":
      return a === v;
    case "not_equals":
      return a !== v;
    case "contains":
      return v !== "" && a.includes(v);
    case "not_contains":
      return v === "" || !a.includes(v);
    case "starts_with":
      return v !== "" && a.startsWith(v);
    case "ends_with":
      return v !== "" && a.endsWith(v);
    case "in":
      return conditionList(c).map(norm).includes(a);
    case "not_in":
      return !conditionList(c).map(norm).includes(a);
    default:
      return false;
  }
}

function traceRule(rule: PolicyRule, index: number, input: PolicyInput): RuleTrace {
  if (!rule.enabled) return { ruleId: rule.id, index, matched: false, reason: "disabled" };
  if (!rule.kinds.includes(input.kind)) return { ruleId: rule.id, index, matched: false, reason: "kind" };
  if (rule.conditions.length === 0) return { ruleId: rule.id, index, matched: false, reason: "no_condition" };
  if (rule.match === "any") {
    if (rule.conditions.some((c) => testCondition(c, input))) return { ruleId: rule.id, index, matched: true };
    return { ruleId: rule.id, index, matched: false, reason: "no_match" };
  }
  const failed = rule.conditions.find((c) => !testCondition(c, input));
  if (!failed) return { ruleId: rule.id, index, matched: true };
  return {
    ruleId: rule.id,
    index,
    matched: false,
    reason: "condition",
    condition: failed,
    actual: fieldValue(input, failed.field),
  };
}

// Rules run top down; disabled rules are skipped; the first match sets the class; else the default.
export function evaluate(rules: PolicyRule[], input: PolicyInput, defaultClass: PolicyClass): Evaluation {
  for (let i = 0; i < rules.length; i++) {
    if (traceRule(rules[i], i, input).matched) return { class: rules[i].class, ruleIndex: i, ruleId: rules[i].id };
  }
  return { class: defaultClass, ruleIndex: -1, ruleId: null };
}

// For the title tester: every rule up to and including the match, with why the earlier ones failed.
export function explain(rules: PolicyRule[], input: PolicyInput, defaultClass: PolicyClass): { result: Evaluation; trace: RuleTrace[] } {
  const trace: RuleTrace[] = [];
  for (let i = 0; i < rules.length; i++) {
    const t = traceRule(rules[i], i, input);
    trace.push(t);
    if (t.matched)
      return {
        result: { class: rules[i].class, ruleIndex: i, ruleId: rules[i].id },
        trace,
      };
  }
  return {
    result: { class: defaultClass, ruleIndex: -1, ruleId: null },
    trace,
  };
}

export function conditionText(c: PolicyCondition, categoryName: (slug: string) => string = (s) => s): string {
  const field = FIELD_LABEL[c.field];
  const show = (v: string) => (FIELD_TYPE[c.field] === "category" ? categoryName(v) : v);
  if (c.operator === "in" || c.operator === "not_in") return `${field} ${OPERATOR_LABEL[c.operator]} ${conditionList(c).map(show).join(", ")}`;
  if (c.operator === "between") return `${field} between ${c.value || "?"} and ${c.value2 || "?"}`;
  if (FIELD_TYPE[c.field] === "boolean") return `${field} ${OPERATOR_LABEL[c.operator]} ${booleanValue(c.value) ? "yes" : "no"}`;
  return `${field} ${OPERATOR_LABEL[c.operator]} ${c.value ? show(c.value) : "?"}${c.case_sensitive && FIELD_TYPE[c.field] === "text" ? " (case-sensitive)" : ""}`;
}

export function traceText(t: RuleTrace, categoryName?: (slug: string) => string): string {
  if (t.matched) return "Matches";
  if (t.reason !== "condition") {
    return { disabled: "Rule is disabled", kind: "Does not apply to this kind", no_condition: "Rule has no conditions", no_match: "No condition matches" }[t.reason];
  }
  return `${conditionText(t.condition, categoryName)} is false (${t.actual || "empty"})`;
}

// Save-time validation of one condition; null when valid. The database checks the same rules.
export function validateCondition(c: PolicyCondition): string | null {
  const type = FIELD_TYPE[c.field];
  if (!type) return "Unknown field";
  if (!OPERATORS_BY_TYPE[type].includes(c.operator)) return `"${OPERATOR_LABEL[c.operator] ?? c.operator}" does not apply to ${FIELD_LABEL[c.field]}`;
  if (c.operator === "regex") {
    const pattern = c.value ?? "";
    if (!pattern) return "Enter a regular expression";
    if (pattern.length > REGEX_MAX_LENGTH) return `The regular expression is longer than ${REGEX_MAX_LENGTH} characters`;
    try {
      new RegExp(pattern);
    } catch {
      return "Invalid regular expression";
    }
    return null;
  }
  if (type === "boolean") return ["true", "false"].includes((c.value ?? "").trim().toLowerCase()) ? null : "Select yes or no";
  if (type === "number") {
    const [lo, hi] = NUMBER_RANGE[c.field] ?? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
    const values = c.operator === "between" ? [c.value, c.value2] : [c.value];
    for (const v of values) {
      const n = numberValue(v);
      if (Number.isNaN(n)) return c.operator === "between" ? "Enter both numbers" : "Enter a number";
      if (n < lo || n > hi) return `Enter a number from ${lo} to ${hi}`;
    }
    if (c.operator === "between" && numberValue(c.value) > numberValue(c.value2)) return "Put the lower number first";
    return null;
  }
  if (c.operator === "in" || c.operator === "not_in") return conditionList(c).length ? null : "Enter at least one value";
  if (c.operator === "between") {
    if (!c.value || !c.value2) return "Enter both versions";
    if (compareVersions(c.value, c.value2) > 0) return "Put the lower version first";
    return null;
  }
  if (!(c.value ?? "").trim()) return "Enter a value";
  return null;
}

export function validateRule(rule: Pick<PolicyRule, "name" | "kinds" | "conditions">): string[] {
  const errors: string[] = [];
  if (!rule.name.trim()) errors.push("Enter a rule name");
  if (rule.kinds.length === 0) errors.push("Select at least one kind");
  if (rule.conditions.length === 0) errors.push("Add at least one condition");
  rule.conditions.forEach((c, i) => {
    const e = validateCondition(c);
    if (e) errors.push(`Condition ${i + 1}: ${e}`);
  });
  return errors;
}
