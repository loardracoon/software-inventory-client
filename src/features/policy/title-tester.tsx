import { useMemo, useState } from "react";
import { Link } from "react-router";
import { explain, traceText, type PolicyClass, type PolicyRule } from "@policy";
import { Input } from "@/components/ui/input";
import { Eyebrow } from "@/components/shared/eyebrow";
import { Field, NativeSelect } from "@/components/shared/filters";
import { KIND_LABEL, label } from "@/lib/labels";
import type { PreviewInput } from "./api";
import { ClassBadge } from "./class-badge";
import { titlesForTester } from "./preview";

// Pick a title (and a version), see the class it gets under the rules shown above (the draft when
// there is one) and why each earlier rule did not match.
export function TitleTester({ inputs, rules, defaultClass, isDraft, categoryName }: {
  inputs: PreviewInput[];
  rules: PolicyRule[];
  defaultClass: PolicyClass;
  isDraft: boolean;
  categoryName: (slug: string) => string;
}) {
  const titles = useMemo(() => titlesForTester(inputs), [inputs]);
  const [query, setQuery] = useState("");
  const [titleId, setTitleId] = useState("");
  const [version, setVersion] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? titles.filter((t) => t.name.toLowerCase().includes(q)) : titles).slice(0, 200);
  }, [titles, query]);
  const title = titles.find((t) => t.title_id === titleId) ?? matches[0] ?? null;
  const input = title ? (title.versions.find((v) => v.version === version) ?? title.versions[0]) : null;
  const result = input ? explain(rules, input, defaultClass) : null;
  const decided = result && result.result.ruleIndex >= 0 ? rules[result.result.ruleIndex] : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Eyebrow>Test a title</Eyebrow>
        <span className="text-[13px] text-text-muted">
          See which rule classifies a title{isDraft ? " under the draft" : ""}, and why each earlier rule did not.
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Find a title" htmlFor="tester-search">
          <Input id="tester-search" type="search" placeholder="Title name" value={query} onChange={(e) => setQuery(e.target.value)} />
        </Field>
        <Field label="Title" htmlFor="tester-title">
          <NativeSelect
            id="tester-title"
            value={title?.title_id ?? ""}
            onChange={(v) => {
              setTitleId(v);
              setVersion("");
            }}
            options={matches.length ? matches.map((t) => ({ value: t.title_id, label: `${t.name} · ${label(KIND_LABEL, t.kind)}` })) : [{ value: "", label: "No title matches" }]}
          />
        </Field>
        {title && title.versions.length > 1 ? (
          <Field label="Installed version" htmlFor="tester-version">
            <NativeSelect
              id="tester-version"
              value={input?.version ?? ""}
              onChange={setVersion}
              options={title.versions.map((v) => ({ value: v.version, label: `${v.version || "(no version)"} · ${v.computers} computer${v.computers === 1 ? "" : "s"}` }))}
            />
          </Field>
        ) : null}
      </div>
      {input && result ? (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-md bg-surface-subtle px-4 py-3" aria-live="polite">
            <ClassBadge cls={result.result.class} />
            <span className="text-sm text-text-strong">
              {decided ? (
                <>
                  Rule {result.result.ruleIndex + 1} ·{" "}
                  <Link to={`/policies/rules/${decided.id}`} className="font-semibold">
                    {decided.name}
                  </Link>{" "}
                  sets the class.
                </>
              ) : (
                "No rule matches: the default class applies."
              )}
            </span>
          </div>
          <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-x-4 gap-y-2 text-[13px]">
            {[
              ["Vendor", input.vendor || "—"],
              ["Version", input.version || "—"],
              ["Category", input.category_name ? `${input.category_name} / ${input.subcategory_name}` : "Unclassified"],
              ["ID", input.external_id || "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex min-w-0 flex-col">
                <dt className="text-text-muted">{k}</dt>
                <dd className="m-0 [overflow-wrap:anywhere] text-text-strong">{v}</dd>
              </div>
            ))}
          </dl>
          <ol className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]" aria-label="Rule by rule">
            {result.trace.map((t) => (
              <li key={t.ruleId} className="grid grid-cols-[28px_minmax(0,1fr)] gap-2">
                <span className="font-mono text-text-muted">{t.index + 1}</span>
                <span>
                  <span className="font-semibold text-text-strong">{rules[t.index].name}</span>
                  <span className={t.matched ? "text-text-brand" : "text-text-muted"}> · {traceText(t, categoryName)}</span>
                </span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="m-0 text-sm text-text-muted">No installed titles to test yet.</p>
      )}
    </div>
  );
}
