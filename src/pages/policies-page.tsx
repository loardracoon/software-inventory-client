import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorLine } from "@/components/shared/error-line";
import { PageHeader } from "@/components/shared/page-header";
import { fetchCategories } from "@/features/inventory/api";
import {
  discardDraft,
  draftChanges,
  effectivePolicy,
  evaluatorRules,
  fetchPolicy,
  fetchPolicyOverview,
  fetchPreviewInputs,
  PREVIEW_CAP,
  publishPolicy,
} from "@/features/policy/api";
import { ImportPolicyButton } from "@/features/policy/import-policy-button";
import { classifyAll, matchCounts } from "@/features/policy/preview";
import { RulesTable } from "@/features/policy/rules-table";
import { ClassSummary, DraftBar, OverdueBanner } from "@/features/policy/summary";
import { TitleTester } from "@/features/policy/title-tester";
import { usePolicyTenant, useCategoryName } from "@/features/policy/use-policy-tenant";
import { formatDateTime } from "@/lib/format";
import { useLoad } from "@/lib/use-load";

export function PoliciesPage() {
  const { tenantId, needsSelection } = usePolicyTenant();
  const [version, setVersion] = useState(0);
  const key = `${tenantId ?? "none"}#${version}`;
  const state = useLoad(`policy:${key}`, () => (tenantId ? fetchPolicy(tenantId) : Promise.resolve(null)));
  const overview = useLoad(`policy-overview:${key}`, () => (tenantId ? fetchPolicyOverview(tenantId) : Promise.resolve(null)));
  const inputs = useLoad(`policy-inputs:${key}`, () => (tenantId ? fetchPreviewInputs(tenantId) : Promise.resolve([])));
  const categories = useLoad("categories", fetchCategories);
  const categoryName = useCategoryName(categories.data);
  const [busy, setBusy] = useState(false);
  const reload = () => setVersion((v) => v + 1);

  const doc = effectivePolicy(state.data);
  const rules = useMemo(() => evaluatorRules(doc), [doc]);
  const previewRows = inputs.data && inputs.data.length <= PREVIEW_CAP ? inputs.data : null;
  const counts = useMemo(() => (previewRows && doc ? matchCounts(classifyAll(previewRows, rules, doc.default_class)) : null), [previewRows, rules, doc]);
  const changes = draftChanges(state.data);
  const canEdit = state.data?.can_edit ?? false;
  const published = state.data?.published ?? null;

  if (needsSelection) {
    return (
      <>
        <PageHeader eyebrow="Application policy · CIS Controls v8.1 · Control 2" title="Policies" />
        <EmptyState icon={ShieldCheck} title="Select a tenant" description="Each tenant has its own policy. Select a tenant in the header to see and edit its rules." />
      </>
    );
  }

  async function publish() {
    if (!tenantId) return;
    setBusy(true);
    try {
      const r = await publishPolicy(tenantId);
      if (r.evaluationError || (r.evaluation && !r.evaluation.complete)) {
        toast.warning(`Policy version ${r.version} published`, {
          description: `The classification did not finish (${r.evaluationError ?? "time limit"}). The collector finishes it on its next run.`,
        });
      } else {
        toast.success(`Policy version ${r.version} published`, {
          description: `${r.evaluation?.evaluated ?? 0} installed versions classified; ${r.evaluation?.changed ?? 0} changed class.`,
        });
      }
    } catch (e) {
      toast.error("The policy was not published", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
      reload();
    }
  }

  async function discard() {
    if (!tenantId) return;
    setBusy(true);
    try {
      await discardDraft(tenantId);
      toast.success("Draft discarded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not discard the draft");
    } finally {
      setBusy(false);
      reload();
    }
  }

  function exportPolicy() {
    if (!doc) return;
    const body = {
      version: doc.version,
      status: doc.status,
      default_class: doc.default_class,
      exported_at: new Date().toISOString(),
      rules: doc.rules.map((r) => ({
        position: r.position,
        name: r.name,
        class: r.class,
        match: r.match,
        kinds: r.kinds,
        enabled: r.enabled,
        conditions: r.conditions,
        owner: r.owner,
        business_purpose: r.business_purpose,
        mitigating_controls: r.mitigating_controls,
        risk_accepted_by: r.risk_accepted_by,
        review_by: r.review_by,
        alert_on_new: r.alert_on_new,
      })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `application-policy-v${doc.version}${doc.status === "draft" ? "-draft" : ""}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const description = published
    ? `Every program, extension and package gets one class. Rules run from top to bottom and the first rule that matches sets the class. Policy version ${published.version}, published ${published.published_at ? formatDateTime(published.published_at) : ""}${published.published_by ? ` by ${published.published_by}` : ""}.`
    : "Every program, extension and package gets one class. Rules run from top to bottom and the first rule that matches sets the class. No policy is published yet.";

  return (
    <>
      <PageHeader
        eyebrow="Application policy · CIS Controls v8.1 · Control 2"
        title="Policies"
        description={description}
        actions={
          <>
            <Button variant="secondary" size="sm" disabled={!doc} onClick={exportPolicy}>
              Export policy
            </Button>
            {canEdit && tenantId ? <ImportPolicyButton tenantId={tenantId} hasDraft={Boolean(state.data?.draft)} onImported={reload} /> : null}
            {canEdit ? (
              <Button asChild size="sm">
                <Link to={`/policies/rules/new?position=${(doc?.rules.length ?? 0) + 1}`}>New rule</Link>
              </Button>
            ) : null}
          </>
        }
      />
      {state.error ? <ErrorLine message={state.error} /> : null}
      {inputs.error ? <ErrorLine message={inputs.error} /> : null}
      {state.data?.draft ? (
        <DraftBar version={state.data.draft.version} changes={changes.total} canEdit={canEdit} busy={busy} onDiscard={discard} onPublish={publish} />
      ) : null}
      {overview.loading && !overview.data ? <Skeleton className="h-24 w-full" /> : <ClassSummary overview={overview.data} />}
      <OverdueBanner overview={overview.data} />
      {inputs.data && inputs.data.length > PREVIEW_CAP ? (
        <p className="m-0 text-sm text-text-muted" role="note">
          This tenant has more than {PREVIEW_CAP.toLocaleString("en")} installed versions. Rule match counts and the title tester are not available; publish to see the results.
        </p>
      ) : null}
      <Card className="gap-0 overflow-hidden py-0">
        {state.loading && !state.data ? (
          <Skeleton className="m-6 h-48" />
        ) : tenantId ? (
          <RulesTable
            tenantId={tenantId}
            doc={doc}
            canEdit={canEdit}
            counts={counts?.byRule ?? null}
            byDefault={counts?.byDefault ?? null}
            changed={changes.changed}
            added={changes.added}
            categoryName={categoryName}
            onChanged={reload}
          />
        ) : null}
        {doc && doc.rules.length === 0 ? (
          <p className="m-0 border-t border-border-subtle px-6 py-5 text-sm text-text-muted">
            No rules yet: every title gets the default class. {canEdit ? "Add a rule with New rule." : ""}
          </p>
        ) : null}
        {!doc && !state.loading ? (
          <p className="m-0 border-t border-border-subtle px-6 py-5 text-sm text-text-muted">
            {canEdit ? "Start with New rule. Rules go to a draft; nothing changes until you publish." : "No policy is published for this tenant yet."}
          </p>
        ) : null}
      </Card>
      {previewRows ? (
        <Card className="px-6">
          <TitleTester inputs={previewRows} rules={rules} defaultClass={doc?.default_class ?? "unsanctioned_app"} isDraft={Boolean(state.data?.draft)} categoryName={categoryName} />
        </Card>
      ) : null}
    </>
  );
}
