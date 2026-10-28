import { useParams, useSearchParams } from "react-router";
import { ShieldCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorLine } from "@/components/shared/error-line";
import { fetchCategories } from "@/features/inventory/api";
import { effectivePolicy, fetchPolicy, fetchPreviewInputs, fetchRuleHistory, PREVIEW_CAP, type RuleDraft } from "@/features/policy/api";
import { newRuleDraft, RuleEditor } from "@/features/policy/rule-editor";
import { usePolicyTenant } from "@/features/policy/use-policy-tenant";
import { useLoad } from "@/lib/use-load";

// /policies/rules/new?position=N and /policies/rules/:lineageId (a rule keeps its lineage id across versions).
export function PolicyRulePage() {
  const { lineageId } = useParams();
  const [params] = useSearchParams();
  const { tenantId, needsSelection } = usePolicyTenant();
  const isNew = !lineageId;
  const key = tenantId ?? "none";
  const state = useLoad(`policy:${key}`, () => (tenantId ? fetchPolicy(tenantId) : Promise.resolve(null)));
  const inputs = useLoad(`policy-inputs:${key}`, () => (tenantId ? fetchPreviewInputs(tenantId) : Promise.resolve([])));
  const categories = useLoad("categories", fetchCategories);
  const history = useLoad(`policy-history:${key}:${lineageId ?? "new"}`, () => (tenantId && lineageId ? fetchRuleHistory(tenantId, lineageId) : Promise.resolve([])));

  if (needsSelection) {
    return <EmptyState icon={ShieldCheck} title="Select a tenant" description="Each tenant has its own policy. Select a tenant in the header first." />;
  }
  if (state.error) return <ErrorLine message={state.error} />;
  if (!tenantId || state.loading || categories.loading) return <Skeleton className="h-96 w-full" />;

  const doc = effectivePolicy(state.data);
  const count = doc?.rules.length ?? 0;
  let initial: RuleDraft;
  if (isNew) {
    const requested = Number(params.get("position"));
    initial = newRuleDraft(Number.isInteger(requested) && requested >= 1 ? Math.min(requested, count + 1) : count + 1);
  } else {
    const rule = doc?.rules.find((r) => r.lineage_id === lineageId);
    if (!rule) {
      return <EmptyState icon={ShieldCheck} title="Rule not found" description="The rule is not in the draft or the published policy. It may have been deleted." />;
    }
    initial = {
      lineage_id: rule.lineage_id,
      position: rule.position,
      name: rule.name,
      class: rule.class,
      match: rule.match,
      kinds: rule.kinds,
      enabled: rule.enabled,
      owner: rule.owner ?? "",
      business_purpose: rule.business_purpose ?? "",
      mitigating_controls: rule.mitigating_controls ?? "",
      risk_accepted_by: rule.risk_accepted_by ?? "",
      review_by: rule.review_by ?? "",
      alert_on_new: rule.alert_on_new,
      conditions: rule.conditions.map((c) => ({ ...c, case_sensitive: Boolean(c.case_sensitive) })),
    };
  }

  return (
    <RuleEditor
      key={`${lineageId ?? "new"}:${doc?.id ?? "none"}`}
      tenantId={tenantId}
      initial={initial}
      doc={doc}
      inputs={inputs.data && inputs.data.length <= PREVIEW_CAP ? inputs.data : null}
      categories={categories.data ?? []}
      canEdit={state.data?.can_edit ?? false}
      history={history.data ?? []}
    />
  );
}
