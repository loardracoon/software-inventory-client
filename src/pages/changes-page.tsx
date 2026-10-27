import { useCallback, useMemo, useState } from "react";
import { History } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { DateInput, Field, NativeSelect } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { ExportButton } from "@/features/dictionary/export-button";
import { ServerDataTable, type ServerPageRequest } from "@/components/shared/server-data-table";
import { fetchChanges, fetchLevel1Categories, type ChangeFilters } from "@/features/inventory/api";
import { CHANGE_COLUMNS_WITH_COMPUTER } from "@/features/inventory/change-columns";
import { useTenant } from "@/features/tenants/tenant-context";
import { endOfDayIso } from "@/lib/format";
import { KIND_LABEL } from "@/lib/labels";
import { useLoad } from "@/lib/use-load";

const TABS: { value: ChangeFilters["change"]; label: string }[] = [
  { value: "", label: "All" },
  { value: "added", label: "Added" },
  { value: "updated", label: "Updated" },
  { value: "removed", label: "Removed" },
];

// Start of a date in the tenant time zone = end of the previous day.
function startOfDayIso(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return endOfDayIso(d.toISOString().slice(0, 10));
}

export function ChangesPage() {
  const { selectedTenantId } = useTenant();
  const [change, setChange] = useState<ChangeFilters["change"]>("");
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

  return (
    <>
      <PageHeader
        eyebrow="History"
        title="Changes"
        description="What was added, removed or updated, where and when. The first collection of each computer is a baseline and adds no events."
        actions={<ExportButton dataset="changes" filters={filters} />}
      />
      <Tabs value={change} onValueChange={(v) => setChange(v as ChangeFilters["change"])}>
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
        <Field label="Category" htmlFor="changes-category">
          <NativeSelect
            id="changes-category"
            value={category}
            onChange={setCategory}
            options={[{ value: "", label: "All categories" }, ...(categories.data ?? []).map((c) => ({ value: c.slug, label: c.name }))]}
          />
        </Field>
        <Field label="From" htmlFor="changes-from">
          <DateInput id="changes-from" value={from} onChange={setFrom} />
        </Field>
        <Field label="To" htmlFor="changes-to">
          <DateInput id="changes-to" value={to} onChange={setTo} />
        </Field>
      </div>
      <ServerDataTable
        label="Changes"
        columns={CHANGE_COLUMNS_WITH_COMPUTER}
        fetchPage={fetchPage}
        filters={filters}
        getRowId={(row) => row.id ?? ""}
        initialSorting={[{ id: "detected_at", desc: true }]}
        empty={<EmptyState icon={History} title="No changes match" description="Changes are recorded from the second collection of each computer and query on." />}
      />
    </>
  );
}
