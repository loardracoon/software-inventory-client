// Client-side evaluation of the draft (or published) rules against the tenant's current
// (title, version) pairs: rule match counts, the default row, and the rule editor's live preview.
import { evaluate, type Evaluation, type PolicyClass, type PolicyRule } from "@policy";
import type { PreviewInput } from "./api";

export type Counts = { titles: number; computers: number };
export type Classified = { input: PreviewInput; result: Evaluation };

export function classifyAll(inputs: PreviewInput[], rules: PolicyRule[], defaultClass: PolicyClass): Classified[] {
  return inputs.map((input) => ({ input, result: evaluate(rules, input, defaultClass) }));
}

function count(rows: Classified[]): Counts {
  return { titles: new Set(rows.map((r) => r.input.title_id)).size, computers: rows.reduce((n, r) => n + r.input.computers, 0) };
}

// Titles and computers each rule decides (by rule id), and those left to the default class.
export function matchCounts(classified: Classified[]): { byRule: Map<string, Counts>; byDefault: Counts } {
  const groups = new Map<string, Classified[]>();
  const fallback: Classified[] = [];
  for (const row of classified) {
    if (row.result.ruleId === null) fallback.push(row);
    else groups.set(row.result.ruleId, [...(groups.get(row.result.ruleId) ?? []), row]);
  }
  return { byRule: new Map([...groups].map(([id, rows]) => [id, count(rows)])), byDefault: count(fallback) };
}

export type RulePreview = {
  matched: Counts;
  // Pairs this rule decides.
  decides: Classified[];
  // Pairs this rule would match, but an earlier rule decides first.
  shadowed: { row: Classified; byIndex: number }[];
  // Pairs whose stored class would change if the draft were published.
  changes: { row: Classified; from: PolicyClass | null }[];
};

// The rule editor's live preview: the edited rule at its position among the other draft rules.
export function previewRule(inputs: PreviewInput[], others: PolicyRule[], rule: PolicyRule, position: number, defaultClass: PolicyClass): RulePreview {
  const index = Math.min(Math.max(position - 1, 0), others.length);
  const rules = [...others.slice(0, index), rule, ...others.slice(index)];
  const alone = { ...rule, enabled: true };
  const decides: Classified[] = [];
  const shadowed: RulePreview["shadowed"] = [];
  const changes: RulePreview["changes"] = [];
  for (const input of inputs) {
    const result = evaluate(rules, input, defaultClass);
    const row = { input, result };
    if (result.ruleIndex === index) decides.push(row);
    else if (result.ruleIndex >= 0 && result.ruleIndex < index && evaluate([alone], input, defaultClass).ruleIndex === 0) shadowed.push({ row, byIndex: result.ruleIndex });
    if (input.current_class !== result.class) changes.push({ row, from: input.current_class });
  }
  return { matched: count(decides), decides, shadowed, changes };
}

// Title tester: titles with their installed versions, most installed first.
export function titlesForTester(inputs: PreviewInput[]): { title_id: string; name: string; kind: string; versions: PreviewInput[] }[] {
  const map = new Map<string, { title_id: string; name: string; kind: string; versions: PreviewInput[]; computers: number }>();
  for (const input of inputs) {
    const t = map.get(input.title_id) ?? { title_id: input.title_id, name: input.name, kind: input.kind, versions: [], computers: 0 };
    t.versions.push(input);
    t.computers += input.computers;
    map.set(input.title_id, t);
  }
  return [...map.values()].sort((a, b) => b.computers - a.computers || a.name.localeCompare(b.name));
}
