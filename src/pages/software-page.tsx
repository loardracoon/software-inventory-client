import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { EllipsisVertical, MessageSquareWarning, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CategoryTag, categoryFromRow } from "@/components/shared/category-tag";
import { toCategoryOrigin } from "@/components/shared/change-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { DateInput, Field, FilterChip, NativeSelect } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { ServerDataTable, type ServerColumnDef, type ServerPageRequest } from "@/components/shared/server-data-table";
import { fetchOpenRequestTitleIds, useCanContribute } from "@/features/dictionary/api";
import { ExportButton } from "@/features/dictionary/export-button";
import { ReclassifyDialog, type ReclassifyTarget } from "@/features/dictionary/reclassify-dialog";
import { fetchCategories, fetchNeedsAttention, searchTitles, type AttentionLevel, type SoftwareFilters, type TitleKind, type TitleRow } from "@/features/inventory/api";
import { ClassBadge } from "@/features/policy/class-badge";
import { CLASS_INFO, CLASS_ORDER, classFromParam } from "@/features/policy/classes";
import { SaveSearchButton } from "@/features/saved-searches/save-search-button";
import { VULN_FILTERS, vulnFromParam } from "@/features/vulns/api";
import { VulnSummary } from "@/features/vulns/vuln-badges";
import { useTenant } from "@/features/tenants/tenant-context";
import { endOfDayIso, formatDate, formatNumber } from "@/lib/format";
import { KIND_LABEL, label, PLATFORM_LABEL, SOURCE_LABEL } from "@/lib/labels";
import { useLoad } from "@/lib/use-load";

type SoftwareRow = TitleRow & { requested: boolean };

const KIND_TABS: { value: TitleKind | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "program", label: "Programs" },
  { value: "extension", label: "Browser extensions" },
  { value: "ide_extension", label: "IDE extensions" },
  { value: "package", label: "Packages" },
];

const ATTENTION_OPTIONS: { value: string; label: string; levels: AttentionLevel[] }[] = [
  { value: "", label: "Any", levels: [] },
  { value: "attention", label: "Review or Not allowed", levels: ["review", "not_allowed"] },
  { value: "not_allowed", label: "Not allowed", levels: ["not_allowed"] },
];

function columns(canContribute: boolean, requested: Set<string>, reclassify: (row: SoftwareRow) => void): ServerColumnDef<SoftwareRow>[] {
  return [
    {
      accessorKey: "canonical_name",
      header: "Title",
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <Link to={`/software/${row.original.title_id}`} className="font-semibold">
            {row.original.canonical_name}
          </Link>
          <span className="text-xs text-text-muted">{row.original.vendor ?? (row.original.kind === "extension" ? row.original.external_id : "")}</span>
          {row.original.spellings > 1 ? <span className="text-xs text-text-muted">{row.original.spellings} spellings of this product</span> : null}
        </div>
      ),
    },
    {
      id: "kind",
      header: "Kind · source",
      enableSorting: false,
      cell: ({ row }) => `${label(KIND_LABEL, row.original.kind)} · ${label(SOURCE_LABEL, row.original.source)}`,
    },
    {
      id: "category",
      header: "Category",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex flex-col items-start gap-1">
          <CategoryTag category={categoryFromRow(row.original)} origin={toCategoryOrigin(row.original.origin, row.original.method, row.original.confidence)} />
          {row.original.requested || requested.has(row.original.title_id) ? (
            <Badge color="info" soft>
              <MessageSquareWarning aria-hidden="true" />
              Reclassification requested
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      id: "policy",
      header: "Policy",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex flex-col items-start gap-1">
          <ClassBadge cls={row.original.policy_class} size="sm" />
          {row.original.policy_rule_lineage_id ? (
            <Link to={`/policies/rules/${row.original.policy_rule_lineage_id}`} className="text-xs">
              {row.original.policy_rule_name}
            </Link>
          ) : row.original.policy_class ? (
            <span className="text-xs text-text-muted">Default class</span>
          ) : null}
          {row.original.mixed_versions ? <span className="text-xs text-text-muted">Mixed versions</span> : null}
        </div>
      ),
    },
    {
      id: "vulns",
      header: "Vulnerabilities",
      cell: ({ row }) => (
        <VulnSummary
          vulns={row.original.vulns}
          kev={row.original.vulns_kev}
          critical={row.original.vulns_critical}
          high={row.original.vulns_high}
          possible={row.original.vulns_possible}
          maxCvss={row.original.max_cvss}
        />
      ),
    },
    { accessorKey: "computers", header: "Computers", cell: ({ getValue }) => formatNumber(getValue() as number) },
    { accessorKey: "versions", header: "Versions", cell: ({ getValue }) => formatNumber(getValue() as number) },
    { accessorKey: "latest_version", header: "Newest", enableSorting: false, cell: ({ getValue }) => (getValue() as string | null) ?? "—" },
    { accessorKey: "first_seen", header: "First seen", cell: ({ getValue }) => (getValue() ? formatDate(getValue() as string) : "—") },
    ...(canContribute
      ? [
          {
            id: "actions",
            header: () => <span className="sr-only">Actions</span>,
            enableSorting: false,
            cell: ({ row }) => {
              const done = row.original.requested || requested.has(row.original.title_id);
              return (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.original.canonical_name}`}>
                      <EllipsisVertical aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem disabled={done} onSelect={() => reclassify(row.original)}>
                      {done ? "Reclassification requested" : "Request reclassification"}
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to={`/software/${row.original.title_id}`}>Open title</Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            },
          } satisfies ServerColumnDef<SoftwareRow>,
        ]
      : []),
  ];
}

// Every filter lives in the URL, so a saved search (and the sidebar link to it) is just the query string.
export function SoftwarePage() {
  const { selectedTenantId } = useTenant();
  const canContribute = useCanContribute();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const category = params.get("category") ?? "";
  const kind = (params.get("kind") ?? "") as TitleKind | "";
  const attention = params.get("attention") ?? "";
  const platform = (params.get("platform") ?? "") as SoftwareFilters["platform"];
  const source = params.get("source") ?? "";
  const user = params.get("user") ?? "";
  const versionBelow = params.get("below") ?? "";
  const installedOn = params.get("on") ?? "";
  const policy = classFromParam(params.get("policy"));
  const vuln = vulnFromParam(params.get("vuln"));
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [reclassifying, setReclassifying] = useState<ReclassifyTarget | null>(null);

  const categories = useLoad("categories", fetchCategories);
  const sensitive = useLoad(`attention:${selectedTenantId ?? "all"}`, () => fetchNeedsAttention(selectedTenantId, 50));

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const chips = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of sensitive.data ?? []) seen.set(row.category_slug.split("/")[0], row.level1_name);
    return [...seen.entries()];
  }, [sensitive.data]);

  const categoryOptions = useMemo(() => {
    const rows = categories.data ?? [];
    const level1 = rows.filter((r) => r.level === 1);
    const options = [
      { value: "", label: "All categories" },
      ...level1.flatMap((p) => [
        { value: p.slug, label: p.name },
        ...rows.filter((c) => c.parent_slug === p.slug).map((c) => ({ value: c.slug, label: `   ${p.name} / ${c.name}` })),
      ]),
    ];
    // A saved search can hold several categories (comma-separated); show them as one option.
    if (category.includes(",")) {
      const names = category.split(",").map((slug) => rows.find((r) => r.slug === slug)?.name ?? slug);
      options.splice(1, 0, { value: category, label: names.join(" + ") });
    }
    return options;
  }, [categories.data, category]);

  const filters = useMemo<SoftwareFilters>(
    () => ({
      tenantId: selectedTenantId,
      query,
      kind,
      category,
      attention: ATTENTION_OPTIONS.find((o) => o.value === attention)?.levels ?? [],
      source,
      platform,
      user,
      versionBelow,
      asOf: installedOn ? endOfDayIso(installedOn) : null,
      policy: policy ? [policy] : [],
      vuln,
    }),
    [selectedTenantId, query, kind, category, attention, source, platform, user, versionBelow, installedOn, policy, vuln],
  );

  const fetchPage = useCallback(async (request: ServerPageRequest<SoftwareFilters>) => {
    const page = await searchTitles(request.filters, request);
    const open = await fetchOpenRequestTitleIds(page.rows.map((r) => r.title_id));
    return { rows: page.rows.map((r) => ({ ...r, requested: open.has(r.title_id) })), rowCount: page.rowCount };
  }, []);

  const tableColumns = useMemo(
    () =>
      columns(canContribute, requested, (row) =>
        setReclassifying({
          titleId: row.title_id,
          name: row.canonical_name,
          currentCategory: row.level2_name ? `${row.level1_name} / ${row.level2_name}` : null,
        }),
      ),
    [canContribute, requested],
  );

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Software"
        description="Programs, browser and IDE extensions and packages, grouped by title."
        actions={
          <>
            <SaveSearchButton params={params} />
            <ExportButton dataset="software" filters={filters} />
          </>
        }
      />
      <Tabs value={kind} onValueChange={(v) => setParam("kind", v)}>
        <TabsList aria-label="Kind">
          {KIND_TABS.map((t) => (
            <TabsTrigger key={t.value || "all"} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Search titles" htmlFor="software-search" className="sm:col-span-2">
          <Input
            id="software-search"
            type="search"
            placeholder="Name, vendor or extension ID"
            value={query}
            onChange={(e) => setParam("q", e.target.value)}
          />
        </Field>
        <Field label="Category" htmlFor="software-category">
          <NativeSelect id="software-category" value={category} onChange={(v) => setParam("category", v)} options={categoryOptions} />
        </Field>
        <Field label="Attention" htmlFor="software-attention">
          <NativeSelect id="software-attention" value={attention} onChange={(v) => setParam("attention", v)} options={ATTENTION_OPTIONS} />
        </Field>
        <Field label="Policy class" htmlFor="software-policy">
          <NativeSelect
            id="software-policy"
            value={policy ? CLASS_INFO[policy].machineId : ""}
            onChange={(v) => setParam("policy", v)}
            options={[{ value: "", label: "All classes" }, ...CLASS_ORDER.map((c) => ({ value: CLASS_INFO[c].machineId, label: CLASS_INFO[c].label }))]}
          />
        </Field>
        <Field label="Vulnerabilities" htmlFor="software-vuln">
          <NativeSelect id="software-vuln" value={vuln} onChange={(v) => setParam("vuln", v)} options={VULN_FILTERS} />
        </Field>
        <Field label="Platform" htmlFor="software-platform">
          <NativeSelect
            id="software-platform"
            value={platform}
            onChange={(v) => setParam("platform", v)}
            options={[{ value: "", label: "All platforms" }, ...Object.entries(PLATFORM_LABEL).map(([value, l]) => ({ value, label: l }))]}
          />
        </Field>
        <Field label="Source" htmlFor="software-source">
          <NativeSelect
            id="software-source"
            value={source}
            onChange={(v) => setParam("source", v)}
            options={[{ value: "", label: "All sources" }, ...Object.entries(SOURCE_LABEL).map(([value, l]) => ({ value, label: l }))]}
          />
        </Field>
        <Field label="User" htmlFor="software-user">
          <Input id="software-user" type="search" placeholder="Username" value={user} onChange={(e) => setParam("user", e.target.value)} />
        </Field>
        <Field label="Version below" htmlFor="software-version">
          <Input id="software-version" placeholder="e.g. 2.45" value={versionBelow} onChange={(e) => setParam("below", e.target.value)} />
        </Field>
        <Field label="Installed on" htmlFor="software-installed-on">
          <DateInput id="software-installed-on" value={installedOn} onChange={(v) => setParam("on", v)} />
        </Field>
      </div>
      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Categories that need attention">
          {chips.map(([slug, name]) => (
            <FilterChip key={slug} pressed={category === slug} onClick={() => setParam("category", category === slug ? "" : slug)}>
              {name}
            </FilterChip>
          ))}
        </div>
      ) : null}
      <ServerDataTable
        label="Software titles"
        columns={tableColumns}
        fetchPage={fetchPage}
        filters={filters}
        getRowId={(row) => row.title_id}
        initialSorting={[{ id: "computers", desc: true }]}
        empty={
          <EmptyState
            icon={Package}
            title={query ? `No results for “${query}”` : "No software titles"}
            description="Titles appear after the first collection. Try other filters."
          />
        }
      />
      <ReclassifyDialog
        target={reclassifying}
        onOpenChange={(open) => !open && setReclassifying(null)}
        onRequested={(titleId) => {
          setReclassifying(null);
          setRequested((prev) => new Set(prev).add(titleId));
        }}
      />
    </>
  );
}
