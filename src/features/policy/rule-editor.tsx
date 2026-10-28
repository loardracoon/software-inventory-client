import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { X } from "lucide-react";
import {
  FIELD_LABEL,
  FIELD_TYPE,
  OPERATORS_BY_TYPE,
  TITLE_KINDS,
  validateCondition,
  validateRule,
  type PolicyClass,
  type PolicyCondition,
  type PolicyField,
  type PolicyOperator,
  type PolicyRule,
  type TitleKind,
} from "@policy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Eyebrow } from "@/components/shared/eyebrow";
import { Field, NativeSelect } from "@/components/shared/filters";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deleteRule, saveRule, type PolicyDoc, type PreviewInput, type RuleDraft } from "./api";
import { ClassBadge, ClassDot, ClassHint } from "./class-badge";
import { CLASS_INFO, CLASS_ORDER, KIND_SHORT } from "./classes";
import { previewRule } from "./preview";

type Category = { slug: string; name: string; parent_slug: string | null; level: number | null };

const OPERATOR_TEXT: Record<"text" | "category" | "version", Partial<Record<PolicyOperator, string>>> = {
  text: {
    equals: "is (exact match)",
    not_equals: "is not",
    contains: "contains",
    not_contains: "does not contain",
    starts_with: "starts with",
    ends_with: "ends with",
    regex: "matches regex",
    in: "is one of",
    not_in: "is not one of",
  },
  category: { equals: "is", not_equals: "is not", in: "is one of", not_in: "is not one of" },
  version: { equals: "=", not_equals: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤", between: "between", regex: "matches regex" },
};

const CONTROL =
  "h-10 w-full min-w-0 rounded-sm border-[1.5px] border-input bg-surface-raised px-3 text-[15px] text-text-body focus-visible:border-action focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none";

// A review date more than 31 days away (CIS 2.3 asks for a monthly review).
function beyondMonth(date: string): boolean {
  return date > new Date(Date.now() + 31 * 86_400_000).toISOString().slice(0, 10);
}

function toRule(form: RuleDraft, id: string | null | undefined): PolicyRule {
  return { id: id ?? "draft", name: form.name || "This rule", class: form.class, match: form.match, kinds: form.kinds, enabled: form.enabled, conditions: form.conditions };
}

export const NEW_CONDITION: PolicyCondition = { field: "vendor", operator: "contains", value: "", case_sensitive: false };

export function newRuleDraft(position: number): RuleDraft {
  return {
    lineage_id: null,
    position,
    name: "",
    class: "sanctioned_app",
    match: "all",
    kinds: [...TITLE_KINDS],
    enabled: true,
    owner: "",
    business_purpose: "",
    mitigating_controls: "",
    risk_accepted_by: "",
    review_by: "",
    alert_on_new: false,
    conditions: [{ ...NEW_CONDITION }],
  };
}

function ConditionRow({ c, n, categories, onChange, onRemove, canRemove, disabled }: {
  c: PolicyCondition;
  n: number;
  categories: Category[];
  onChange: (c: PolicyCondition) => void;
  onRemove: () => void;
  canRemove: boolean;
  disabled: boolean;
}) {
  const type = FIELD_TYPE[c.field];
  const error = validateCondition(c);
  const id = `cond-${n}`;
  const options = c.field === "category" ? categories.filter((k) => k.level === 1) : categories.filter((k) => k.level === 2);
  const parentName = (slug: string | null) => categories.find((k) => k.slug === slug)?.name ?? "";
  const catLabel = (k: Category) => (k.level === 2 ? `${parentName(k.parent_slug)} / ${k.name}` : k.name);
  const nameOf = (slug: string) => {
    const k = categories.find((x) => x.slug === slug);
    return k ? catLabel(k) : slug;
  };
  const list = c.values ?? [];

  function setField(field: PolicyField) {
    const ops = OPERATORS_BY_TYPE[FIELD_TYPE[field]];
    onChange({ field, operator: ops.includes(c.operator) ? c.operator : ops[0], value: "", value2: null, values: null, case_sensitive: false });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-surface-page p-3">
      <div className="flex flex-wrap items-end gap-2.5">
        <div className="flex min-w-[190px] flex-[1_1_190px] flex-col gap-1">
          <label htmlFor={`${id}-field`} className="sr-only">
            Field of condition {n}
          </label>
          <select id={`${id}-field`} className={CONTROL} value={c.field} disabled={disabled} onChange={(e) => setField(e.target.value as PolicyField)}>
            {(Object.keys(FIELD_LABEL) as PolicyField[]).map((f) => (
              <option key={f} value={f}>
                {FIELD_LABEL[f]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-[130px] flex-[0_1_170px] flex-col gap-1">
          <label htmlFor={`${id}-op`} className="sr-only">
            Operator of condition {n}
          </label>
          <select
            id={`${id}-op`}
            className={CONTROL}
            value={c.operator}
            disabled={disabled}
            onChange={(e) => onChange({ ...c, operator: e.target.value as PolicyOperator, value2: null })}
          >
            {OPERATORS_BY_TYPE[type].map((op) => (
              <option key={op} value={op}>
                {OPERATOR_TEXT[type][op]}
              </option>
            ))}
          </select>
        </div>

        {type === "category" && (c.operator === "equals" || c.operator === "not_equals") ? (
          <div className="flex min-w-[200px] flex-[2_1_240px] flex-col gap-1">
            <label htmlFor={`${id}-value`} className="sr-only">
              {c.field === "category" ? "Category" : "Subcategory"} of condition {n}
            </label>
            <select id={`${id}-value`} className={CONTROL} value={c.value ?? ""} disabled={disabled} onChange={(e) => onChange({ ...c, value: e.target.value })}>
              <option value="">Select…</option>
              {options.map((k) => (
                <option key={k.slug} value={k.slug}>
                  {catLabel(k)}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {type === "category" && (c.operator === "in" || c.operator === "not_in") ? (
          <div className="flex min-w-[200px] flex-[2_1_240px] flex-col gap-1">
            <label htmlFor={`${id}-value`} className="sr-only">
              Add a value to condition {n}
            </label>
            <select
              id={`${id}-value`}
              className={CONTROL}
              value=""
              disabled={disabled}
              onChange={(e) => e.target.value && onChange({ ...c, value: null, values: [...list.filter((v) => v !== e.target.value), e.target.value] })}
            >
              <option value="">Add…</option>
              {options
                .filter((k) => !list.includes(k.slug))
                .map((k) => (
                  <option key={k.slug} value={k.slug}>
                    {catLabel(k)}
                  </option>
                ))}
            </select>
          </div>
        ) : null}

        {type !== "category" ? (
          <div className="flex min-w-[180px] flex-[2_1_220px] items-end gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor={`${id}-value`} className="sr-only">
                Value of condition {n}
              </label>
              <input
                id={`${id}-value`}
                className={cn(CONTROL, (c.operator === "regex" || type === "version") && "font-mono text-[13px]", error && (c.value ?? "") !== "" && "border-text-critical")}
                value={c.value ?? ""}
                disabled={disabled}
                spellCheck={false}
                placeholder={
                  c.operator === "in" || c.operator === "not_in" ? "Comma-separated values" : c.operator === "regex" ? "^(AnyDesk|TeamViewer)$" : type === "version" ? "e.g. 24.0" : "Value"
                }
                onChange={(e) => onChange({ ...c, value: e.target.value })}
              />
            </div>
            {c.operator === "between" ? (
              <>
                <span className="pb-2.5 text-sm text-text-muted">and</span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <label htmlFor={`${id}-value2`} className="sr-only">
                    Upper version of condition {n}
                  </label>
                  <input
                    id={`${id}-value2`}
                    className={cn(CONTROL, "font-mono text-[13px]")}
                    value={c.value2 ?? ""}
                    disabled={disabled}
                    spellCheck={false}
                    onChange={(e) => onChange({ ...c, value2: e.target.value })}
                  />
                </div>
              </>
            ) : null}
            {type === "text" ? (
              <button
                type="button"
                aria-pressed={Boolean(c.case_sensitive)}
                aria-label="Match case"
                title="Match case"
                disabled={disabled}
                onClick={() => onChange({ ...c, case_sensitive: !c.case_sensitive })}
                className={cn(
                  "h-10 w-10 shrink-0 rounded-sm border-[1.5px] text-[13px] font-semibold",
                  c.case_sensitive ? "border-action bg-action text-on-action" : "border-border-control bg-surface-raised text-text-muted",
                )}
              >
                Aa
              </button>
            ) : null}
          </div>
        ) : null}

        {canRemove ? (
          <Button variant="ghost" size="icon-sm" type="button" disabled={disabled} aria-label={`Remove condition ${n}`} onClick={onRemove}>
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {type === "category" && (c.operator === "in" || c.operator === "not_in") && list.length ? (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={`Values of condition ${n}`}>
          {list.map((slug) => (
            <li key={slug} className="inline-flex items-center gap-0.5 rounded-full bg-surface-subtle py-0.5 pr-0.5 pl-2.5 text-[13px] text-text-strong">
              {nameOf(slug)}
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${nameOf(slug)}`}
                className="inline-flex size-7 items-center justify-center rounded-full text-text-muted hover:bg-border-subtle hover:text-text-strong"
                onClick={() => onChange({ ...c, values: list.filter((v) => v !== slug) })}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error && ((c.value ?? "") !== "" || list.length > 0 || c.operator === "in" || c.operator === "not_in") ? (
        <p className="m-0 text-[13px] text-text-critical" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function DocField({ id, label, hint, value, onChange, disabled, multiline, type = "text" }: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  multiline?: boolean;
  type?: string;
}) {
  return (
    <Field label={label} htmlFor={id}>
      {multiline ? (
        <textarea
          id={id}
          rows={3}
          maxLength={1000}
          disabled={disabled}
          className="w-full rounded-sm border-[1.5px] border-input bg-surface-raised px-3.5 py-2.5 text-sm text-text-body focus-visible:border-action focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input id={id} type={type} maxLength={200} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint ? <span className="text-xs text-text-muted">{hint}</span> : null}
    </Field>
  );
}

type History = { version: number; status: string; published_at: string | null; published_by: string | null; position: number; name: string; class: PolicyClass; enabled: boolean }[];

export function RuleEditor({ tenantId, initial, doc, inputs, categories, canEdit, history }: {
  tenantId: string;
  initial: RuleDraft;
  doc: PolicyDoc | null;
  inputs: PreviewInput[] | null;
  categories: Category[];
  canEdit: boolean;
  history: History;
}) {
  const navigate = useNavigate();
  const [form, setForm] = useState<RuleDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const isNew = !initial.lineage_id;
  const ruleCount = (doc?.rules.length ?? 0) + (isNew ? 1 : 0);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const disabled = !canEdit || saving;
  const set = <K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) => setForm((f) => ({ ...f, [key]: value }));

  const others = useMemo(() => (doc?.rules ?? []).filter((r) => r.lineage_id !== initial.lineage_id).map((r) => ({ ...r, id: r.lineage_id })), [doc, initial.lineage_id]);
  const candidate = toRule(form, initial.lineage_id);
  const defaultClass = doc?.default_class ?? "unsanctioned_app";
  const preview = useMemo(() => {
    const rule = toRule(form, initial.lineage_id);
    if (!inputs || validateRule(rule).length) return null;
    return previewRule(inputs, others, rule, form.position ?? ruleCount, defaultClass);
  }, [inputs, others, form, initial.lineage_id, ruleCount, defaultClass]);
  const reviewTooFar = form.class === "tolerated_app" && form.review_by !== "" && beyondMonth(form.review_by);

  async function save() {
    const problems = validateRule(candidate);
    setErrors(problems);
    if (problems.length) return;
    setSaving(true);
    try {
      await saveRule(tenantId, form);
      toast.success(isNew ? "Rule added to the draft" : "Rule saved in the draft", { description: "Publish the policy to reclassify the titles." });
      navigate("/policies");
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "The rule was not saved"]);
      setSaving(false);
    }
  }

  async function remove() {
    if (!initial.lineage_id) return;
    setSaving(true);
    try {
      await deleteRule(tenantId, initial.lineage_id);
      toast.success("Rule deleted from the draft");
      navigate("/policies");
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "The rule was not deleted"]);
      setSaving(false);
    }
  }

  const ruleNumber = (index: number) => {
    const at = (form.position ?? ruleCount) - 1;
    return index < at ? index + 1 : index + 2;
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-[1_1_520px] flex-col gap-3">
          <nav aria-label="Breadcrumb" className="text-sm text-text-muted">
            <Link to="/policies">Policies</Link> <span aria-hidden="true">/</span> {isNew ? "New rule" : `Rule ${form.position ?? ""}`}
          </nav>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="m-0 text-[28px] sm:text-4xl">{form.name || (isNew ? "New rule" : "Rule")}</h1>
            {dirty ? <Badge color="medium">Unsaved changes</Badge> : null}
          </div>
          <p className="m-0 text-sm text-text-muted">
            {canEdit ? "Saving writes to the draft. Titles are reclassified when you publish the policy." : "Only admins of this tenant can change the policy."}
          </p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-3">
            {!isNew ? (
              <Button variant="ghost" size="sm" disabled={saving} onClick={remove}>
                Delete rule
              </Button>
            ) : null}
            <Button asChild variant="secondary" size="sm">
              <Link to="/policies">Cancel</Link>
            </Button>
            <Button size="sm" disabled={saving} onClick={save}>
              Save rule
            </Button>
          </div>
        ) : null}
      </div>

      {errors.length ? (
        <div role="alert" className="rounded-md border-[1.5px] border-status-critical bg-surface-raised px-4 py-3 text-sm text-text-critical">
          <ul className="m-0 pl-5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start gap-6">
        <fieldset disabled={disabled} className="m-0 flex min-w-0 flex-[3_1_560px] flex-col gap-6 border-0 p-0">
          <Card className="gap-4 px-6">
            <Eyebrow>Rule</Eyebrow>
            <div className="flex flex-wrap items-end gap-4">
              <Field label="Name" htmlFor="rule-name" className="flex-[1_1_280px]">
                <Input id="rule-name" maxLength={120} value={form.name} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <Field label="Position" htmlFor="rule-position" className="w-32">
                <NativeSelect
                  id="rule-position"
                  value={String(form.position ?? ruleCount)}
                  onChange={(v) => set("position", Number(v))}
                  options={Array.from({ length: ruleCount }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
                />
              </Field>
              <div className="flex items-center gap-2 pb-2">
                <Switch id="rule-enabled" checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
                <label htmlFor="rule-enabled" className="text-sm font-semibold text-text-strong">
                  Enabled
                </label>
              </div>
            </div>
          </Card>

          <Card className="gap-4 px-6">
            <div className="flex flex-col gap-1">
              <Eyebrow>Class</Eyebrow>
              <span className="text-[13px] text-text-muted">What a title that matches this rule becomes. Hover or focus a class for its CIS meaning.</span>
            </div>
            <div role="radiogroup" aria-label="Class" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              {CLASS_ORDER.map((cls) => (
                <ClassHint key={cls} cls={cls} link>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={form.class === cls}
                    onClick={() => set("class", cls)}
                    className={cn(
                      "flex items-center gap-2 rounded-md border-[1.5px] bg-surface-page px-3.5 py-3 text-left text-sm font-semibold text-text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
                      form.class === cls ? "border-2 border-action shadow-sm" : "border-border-subtle hover:border-border-control",
                    )}
                  >
                    <ClassDot cls={cls} />
                    {CLASS_INFO[cls].label}
                  </button>
                </ClassHint>
              ))}
            </div>
          </Card>

          <Card className="gap-4 px-6">
            <div className="flex flex-col gap-1">
              <Eyebrow>Conditions</Eyebrow>
              <span className="text-[13px] text-text-muted">
                {form.match === "all" ? "A title matches when every condition is true." : "A title matches when at least one condition is true."} Version conditions
                read each installed version.
              </span>
            </div>
            <div role="group" aria-label="Match" className="flex w-fit gap-1 rounded-full bg-surface-subtle p-1">
              {(["all", "any"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={form.match === m}
                  onClick={() => set("match", m)}
                  className={cn("min-h-9 rounded-full px-3.5 text-[13px] font-semibold", form.match === m ? "bg-action text-on-action" : "text-text-body")}
                >
                  {m === "all" ? "All conditions (AND)" : "Any condition (OR)"}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              {form.conditions.map((c, i) => (
                <div key={i} className="flex flex-col gap-2">
                  {i > 0 ? <span className="font-display text-[10px] font-semibold tracking-[0.1em] text-text-muted">{form.match === "any" ? "OR" : "AND"}</span> : null}
                  <ConditionRow
                    c={c}
                    n={i + 1}
                    categories={categories}
                    disabled={disabled}
                    canRemove={form.conditions.length > 1}
                    onChange={(next) => set("conditions", form.conditions.map((x, j) => (j === i ? next : x)))}
                    onRemove={() => set("conditions", form.conditions.filter((_, j) => j !== i))}
                  />
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit border-dashed"
              onClick={() => set("conditions", [...form.conditions, { ...NEW_CONDITION }])}
              disabled={disabled || form.conditions.length >= 20}
            >
              Add condition
            </Button>
          </Card>

          <Card className="gap-4 px-6">
            <Eyebrow>Applies to</Eyebrow>
            <div className="flex flex-wrap gap-x-6 gap-y-3" role="group" aria-label="Applies to">
              {TITLE_KINDS.map((k: TitleKind) => (
                <label key={k} className="inline-flex items-center gap-2 text-sm text-text-strong">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--action)]"
                    checked={form.kinds.includes(k)}
                    onChange={(e) => set("kinds", e.target.checked ? TITLE_KINDS.filter((x) => x === k || form.kinds.includes(x)) : form.kinds.filter((x) => x !== k))}
                  />
                  {KIND_SHORT[k]}
                </label>
              ))}
            </div>
            {form.kinds.length === 0 ? (
              <p className="m-0 text-[13px] text-text-critical" role="alert">
                Select at least one kind.
              </p>
            ) : null}
          </Card>

          <Card className="gap-4 px-6">
            <div className="flex flex-col gap-1">
              <Eyebrow>Documentation</Eyebrow>
              <span className="text-[13px] text-text-muted">
                {form.class === "tolerated_app"
                  ? "A documented exception (CIS 2.3): every field is required to publish."
                  : form.class === "unsanctioned_app"
                    ? "Why the software is not allowed and how to remove it."
                    : "Who owns the authorization and the business purpose (CIS 2.1)."}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <DocField id="doc-owner" label="Owner" value={form.owner} onChange={(v) => set("owner", v)} disabled={disabled} />
              {form.class === "tolerated_app" ? (
                <DocField id="doc-risk" label="Risk accepted by" value={form.risk_accepted_by} onChange={(v) => set("risk_accepted_by", v)} disabled={disabled} />
              ) : null}
              <div className="sm:col-span-2">
                <DocField
                  id="doc-purpose"
                  label={form.class === "unsanctioned_app" ? "Reason" : "Business purpose"}
                  value={form.business_purpose}
                  onChange={(v) => set("business_purpose", v)}
                  disabled={disabled}
                  multiline
                />
              </div>
              {form.class === "tolerated_app" || form.class === "unsanctioned_app" ? (
                <div className="sm:col-span-2">
                  <DocField
                    id="doc-controls"
                    label={form.class === "tolerated_app" ? "Mitigating controls" : "Remediation"}
                    value={form.mitigating_controls}
                    onChange={(v) => set("mitigating_controls", v)}
                    disabled={disabled}
                    multiline
                  />
                </div>
              ) : null}
              {form.class === "tolerated_app" ? (
                <div className="flex flex-col gap-1.5">
                  <DocField id="doc-review" label="Review by" type="date" hint="Monthly, or sooner (CIS 2.3)" value={form.review_by} onChange={(v) => set("review_by", v)} disabled={disabled} />
                  {reviewTooFar ? (
                    <p className="m-0 text-[13px] text-status-high" role="status">
                      This date is more than 31 days away. CIS 2.3 asks for a monthly review.
                    </p>
                  ) : null}
                </div>
              ) : null}
              {form.class === "unsanctioned_app" ? (
                <label className="inline-flex items-center gap-2 text-sm text-text-strong sm:col-span-2">
                  <input type="checkbox" className="size-4 accent-[var(--action)]" checked={form.alert_on_new} onChange={(e) => set("alert_on_new", e.target.checked)} />
                  Alert when a new installation is detected
                </label>
              ) : null}
            </div>
          </Card>
        </fieldset>

        <aside className="flex min-w-0 flex-[2_1_320px] flex-col gap-6" aria-label="Live preview">
          <Card className="gap-4 px-6">
            <Eyebrow>Live preview</Eyebrow>
            {!inputs ? (
              <p className="m-0 text-sm text-text-muted">The preview is not available for this tenant. Publish to see the results.</p>
            ) : !preview ? (
              <p className="m-0 text-sm text-text-muted">Complete the conditions to see which titles match.</p>
            ) : (
              <>
                <p className="m-0 text-sm text-text-strong" aria-live="polite">
                  At position {form.position ?? ruleCount}, this rule sets the class of <b>{formatNumber(preview.matched.titles)}</b> title
                  {preview.matched.titles === 1 ? "" : "s"} on {formatNumber(preview.matched.computers)} computer{preview.matched.computers === 1 ? "" : "s"}.
                </p>
                {preview.decides.length ? (
                  <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
                    {preview.decides.slice(0, 8).map(({ input }) => (
                      <li key={`${input.title_id}|${input.version}`} className="flex flex-wrap items-center gap-2">
                        <ClassBadge cls={form.class} size="sm" hint={false} />
                        <span className="text-text-strong">{input.name}</span>
                        <span className="text-text-muted">{input.version || "(no version)"}</span>
                      </li>
                    ))}
                    {preview.decides.length > 8 ? <li className="text-text-muted">and {preview.decides.length - 8} more installed versions</li> : null}
                  </ul>
                ) : null}
                {preview.shadowed.length ? (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-semibold text-text-strong">Already classified by an earlier rule</span>
                    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] text-text-muted">
                      {preview.shadowed.slice(0, 6).map(({ row, byIndex }) => (
                        <li key={`${row.input.title_id}|${row.input.version}`}>
                          {row.input.name} {row.input.version} stays {CLASS_INFO[row.result.class].label}: rule {ruleNumber(byIndex)} matches first
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="flex flex-col gap-1.5 border-t border-border-subtle pt-3">
                  <span className="text-[13px] font-semibold text-text-strong">
                    If the draft is published with this rule, {formatNumber(preview.changes.length)} installed version{preview.changes.length === 1 ? "" : "s"} change class
                  </span>
                  <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] text-text-muted">
                    {preview.changes.slice(0, 10).map(({ row, from }) => (
                      <li key={`${row.input.title_id}|${row.input.version}`}>
                        {row.input.name} {row.input.version}: {from ? CLASS_INFO[from].label : "not evaluated"} → {CLASS_INFO[row.result.class].label}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </Card>
          {history.length ? (
            <Card className="gap-3 px-6">
              <Eyebrow>History</Eyebrow>
              <ol className="m-0 flex list-none flex-col gap-2.5 p-0 text-[13px]">
                {history.map((h) => (
                  <li key={h.version} className="grid grid-cols-[40px_minmax(0,1fr)] gap-2">
                    <span className="font-mono text-text-muted">v{h.version}</span>
                    <span className="flex flex-col">
                      <span className="font-semibold text-text-strong">
                        {h.status === "draft" ? "Draft" : h.status === "published" ? "Published" : "Archived"} · rule {h.position} · {CLASS_INFO[h.class].label}
                        {h.enabled ? "" : " · disabled"}
                      </span>
                      <span className="text-text-muted">
                        {h.published_at ? `${formatDateTime(h.published_at)}${h.published_by ? ` by ${h.published_by}` : ""}` : "Not published"}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}
          {!isNew && initial.review_by && initial.class === "tolerated_app" ? (
            <p className="m-0 text-xs text-text-muted">Current review date: {formatDate(`${initial.review_by}T12:00:00Z`)}</p>
          ) : null}
        </aside>
      </div>
    </>
  );
}
