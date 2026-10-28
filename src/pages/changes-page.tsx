import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router";
import { History } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { DateInput, Field, NativeSelect } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { ExportButton } from "@/features/dictionary/export-button";
import { ServerDataTable, type ServerColumnDef, type ServerPageRequest } from "@/components/shared/server-data-table";
import { fetchChanges, fetchLevel1Categories, type ChangeFilters } from "@/features/inventory/api";
import { CHANGE_COLUMNS_WITH_COMPUTER } from "@/features/inventory/change-columns";
import { fetchClassChanges, type ClassChangeFilters, type ClassChangeRow } from "@/features/policy/api";
import { ClassBadge } from "@/features/policy/class-badge";
import { useTenant } from "@/features/tenants/tenant-context";
import { endOfDayIso, formatDateTime } from "@/lib/format";
import { KIND_LABEL, label } from "@/lib/labels";
import { useLoad } from "@/lib/use-load";

type Tab = ChangeFilters["change"] | "class";

const TABS: { value: Tab; label: string }[] = [
  { value: "", label: "All" },
  { value: "added", label: "Added" },
  { value: "updated", label: "Updated" },
  { value: "removed", label: "Removed" },
  { value: "class", label: "Class changed" },
];

// Policy class changes are per (title, version) in a tenant, not per computer (Phase 9).
const CLASS_CHANGE_COLUMNS: ServerColumnDef<ClassChangeRow>[] = [
  { accessorKey: "changed_at", header: "Changed", enableSorting: false, cell: ({ getValue }) => (getValue() ? formatDateTime(getValue() as string) : "—") },
  {
    accessorKey: "canonical_name",
    header: "Title",
    enableSorting: false,
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <Link to={`/software/${row.original.title_id}`}>{row.original.canonical_name}</Link>
        <span className="text-xs text-text-muted">{label(KIND_LABEL, row.original.kind)}</span>
      </div>
    ),
  },
  { accessorKey: "version", header: "Version", enableSorting: false, cell: ({ getValue }) => (getValue() as string | null) || "—" },
  {
    id: "class",
    header: "Class",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="flex flex-wrap items-center gap-1.5">
        <ClassBadge cls={row.original.from_class} size="sm" />
        <span aria-label="changed to">→</span>
        <ClassBadge cls={row.original.to_class} size="sm" />
      </span>
    ),
  },
  {
    id: "rule",
    header: "Rule",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.rule_lineage_id ? (
        <Link to={`/policies/rules/${row.original.rule_lineage_id}`}>{row.original.rule_name}</Link>
      ) : (
        <span className="text-text-muted">Default class</span>
      ),
  },
  { accessorKey: "policy_version", header: "Policy version", enableSorting: false },
];

// Start of a date in the tenant time zone = end of the previous day.
function startOfDayIso(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return endOfDayIso(d.toISOString().slice(0, 10));
}

export function ChangesPage() {
  const { selectedTenantId } = useTenant();
  const [tab, setTab] = useState<Tab>("");
  const change: ChangeFilters["change"] = tab === "class" ? "" : tab;
  const [kind, setKind] = useState<ChangeFilters["kind"]>("");
  const [category, setCategory] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const categories = useLoad("level1", fetchLevel1Categories);

  const filters = useMemo<ChangeFilters>(
    () => ({
      tenantId: selectedTenantId,
      change,
      kind,
      category,
      from: from ? startOfDayIso(from) : null,
      to: to ? endOfDayIso(to) : null,
      search,
    }),
    [selectedTenantId, change, kind, category, from, to, search],
  );
  const fetchPage = useCallback((request: ServerPageRequest<ChangeFilters>) => fetchChanges(request.filters, request), []);
  const classFilters = useMemo<ClassChangeFilters>(
    () => ({ tenantId: selectedTenantId, kind, search, from: from ? startOfDayIso(from) : null, to: to ? endOfDayIso(to) : null }),
    [selectedTenantId, kind, search, from, to],
  );
  const fetchClassPage = useCallback((request: ServerPageRequest<ClassChangeFilters>) => fetchClassChanges(request.filters, request), []);

  return (
    <>
      <PageHeader
        eyebrow="History"
        title="Changes"
        description="What was added, removed or updated, where and when. The first collection of each computer is a baseline and adds no events."
        actions={tab === "class" ? undefined : <ExportButton dataset="changes" filters={filters} />}
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList aria-label="Change type">
          {TABS.map((t) => (
            <TabsTrigger key={t.value || "all"} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Search" htmlFor="changes-search" className="sm:col-span-2 lg:col-span-1">
          <Input id="changes-search" type="search" placeholder="Title, computer or ID" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        <Field label="Kind" htmlFor="changes-kind">
          <NativeSelect
            id="changes-kind"
            value={kind}
            onChange={(v) => setKind(v as ChangeFilters["kind"])}
            options={[{ value: "", label: "All kinds" }, ...Object.entries(KIND_LABEL).map(([value, l]) => ({ value, label: l }))]}
          />
        </Field>
        {tab !== "class" ? (
          <Field label="Category" htmlFor="changes-category">
            <NativeSelect
              id="changes-category"
              value={category}
              onChange={setCategory}
              options={[{ value: "", label: "All categories" }, ...(categories.data ?? []).map((c) => ({ value: c.slug, label: c.name }))]}
            />
          </Field>
        ) : null}
        <Field label="From" htmlFor="changes-from">
          <DateInput id="changes-from" value={from} onChange={setFrom} />
        </Field>
        <Field label="To" htmlFor="changes-to">
          <DateInput id="changes-to" value={to} onChange={setTo} />
        </Field>
      </div>
      {tab === "class" ? (
        <ServerDataTable
          label="Policy class changes"
          columns={CLASS_CHANGE_COLUMNS}
          fetchPage={fetchClassPage}
          filters={classFilters}
          getRowId={(row) => String(row.id ?? "")}
          empty={<EmptyState icon={History} title="No class changes" description="A class change is recorded when a published policy or a dictionary change gives an installed version another class." />}
        />
      ) : (
      <ServerDataTable
        label="Changes"
        columns={CHANGE_COLUMNS_WITH_COMPUTER}
        fetchPage={fetchPage}
        filters={filters}
        getRowId={(row) => row.id ?? ""}
        initialSorting={[{ id: "detected_at", desc: true }]}
        empty={<EmptyState icon={History} title="No changes match" description="Changes are recorded from the second collection of each computer and query on." />}
      />
      )}
    </>
  );
}
