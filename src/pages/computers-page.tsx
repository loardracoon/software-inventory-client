import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CircleDashed, Monitor, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AttentionIcons, type AttentionCategory, type VulnCounts } from "@/components/shared/attention-icons";
import { EmptyState } from "@/components/shared/empty-state";
import { Hint } from "@/components/shared/hint";
import { Field, FilterChip, NativeSelect } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { ExportButton } from "@/features/dictionary/export-button";
import { ServerDataTable, type ServerColumnDef, type ServerPageRequest } from "@/components/shared/server-data-table";
import { asScanStatus, StatusBadge } from "@/components/shared/status-badge";
import { CRITICALITY_OPTIONS, ImportContextButton, useCanEditContext } from "@/features/inventory/computer-context";
import { fetchComputers, fetchNeedsAttention, type ComputerFilters, type ComputerRow } from "@/features/inventory/api";
import { useTenant } from "@/features/tenants/tenant-context";
import { SUPPORT_FILTERS, SupportBadge } from "@/components/shared/support-status";
import { formatDateTime, formatNumber } from "@/lib/format";
import { label, PLATFORM_LABEL } from "@/lib/labels";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";

// Online in Sophos Central: green Wifi or grey WifiOff (the icon shape differs too, not only the colour);
// last seen and the time of the check in the tooltip.
function OnlineStatus({ row }: { row: ComputerRow }) {
  const label = row.online === true ? "Online" : row.online === false ? "Offline" : "Status unknown";
  const Icon = row.online === true ? Wifi : row.online === false ? WifiOff : CircleDashed;
  return (
    <Hint
      content={
        <span className="flex flex-col gap-1">
          <span className="font-semibold text-text-strong">{label} in Sophos Central</span>
          <span>Last seen {row.last_seen_at ? formatDateTime(row.last_seen_at) : "never"}</span>
          {row.online_checked_at ? <span className="text-text-muted">Checked {formatDateTime(row.online_checked_at)}</span> : null}
        </span>
      }
    >
      <button
        type="button"
        aria-label={label}
        className="inline-flex size-7 cursor-help items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <Icon aria-hidden="true" className={cn("size-4", row.online === true ? "text-status-safe" : "text-text-muted")} />
      </button>
    </Hint>
  );
}

const ageInDays = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

// Audit evidence: never inventoried, stale (age in whole days) or current; source and date in the tooltip.
function CoverageStatus({ row }: { row: ComputerRow }) {
  const days = row.inventoried_at ? ageInDays(row.inventoried_at) : 0;
  const text = row.coverage_status === "never" ? "Never inventoried" : row.coverage_status === "stale" ? `Stale (${days} d)` : "Current";
  return (
    <div className="flex flex-col gap-0.5">
      <span className={cn("font-semibold", row.coverage_status === "current" ? "text-text-strong" : "text-text-critical")}>{text}</span>
      <span className="text-xs text-text-muted">
        {row.inventoried_at ? `${formatDateTime(row.inventoried_at)} · ${row.inventory_source === "data_lake" ? "Data Lake" : "Live Endpoint Search"}` : "No inventory yet"}
      </span>
    </div>
  );
}

const COLUMNS: ServerColumnDef<ComputerRow>[] = [
  { accessorKey: "online", header: "Status", cell: ({ row }) => <OnlineStatus row={row.original} /> },
  {
    accessorKey: "hostname",
    header: "Computer",
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <Link to={`/computers/${row.original.id}`} className="font-semibold">
          {row.original.hostname}
        </Link>
        <span className="text-xs text-text-muted">
          {label(PLATFORM_LABEL, row.original.platform)}
          {row.original.os_name ? ` · ${row.original.os_name}` : ""}
        </span>
      </div>
    ),
  },
  {
    accessorKey: "associated_user",
    header: "User",
    cell: ({ row }) => (row.original.user_masked ? <span className="text-text-muted">Hidden</span> : (row.original.associated_user ?? "—")),
  },
  {
    accessorKey: "last_collected_at",
    header: "Last collected",
    cell: ({ row }) => (row.original.last_collected_at ? formatDateTime(row.original.last_collected_at) : <span className="text-text-muted">Never</span>),
  },
  { accessorKey: "owner", header: "Owner", cell: ({ row }) => row.original.owner ?? <span className="text-text-muted">—</span> },
  { accessorKey: "criticality", header: "Criticality", cell: ({ row }) => row.original.criticality ?? <span className="text-text-muted">—</span> },
  {
    accessorKey: "scope_tags",
    header: "Scope",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.scope_tags?.length ? (
        <div className="flex flex-wrap gap-1">
          {row.original.scope_tags.map((tag) => (
            <Badge key={tag} color="blue" soft>
              {tag}
            </Badge>
          ))}
        </div>
      ) : (
        <span className="text-text-muted">—</span>
      ),
  },
  { accessorKey: "coverage_status", header: "Coverage", cell: ({ row }) => <CoverageStatus row={row.original} /> },
  {
    accessorKey: "last_patch_at",
    header: "Last patch",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.last_patch_at ? (
        <span className="flex items-center gap-2">
          {row.original.last_patch_at}
          {row.original.patch_status === "stale" ? <Badge color="high" soft>Stale</Badge> : null}
        </span>
      ) : (
        <span className="text-text-muted">—</span>
      ),
  },
  { accessorKey: "os_eol_status", header: "OS support", enableSorting: false, cell: ({ row }) => <SupportBadge status={row.original.os_eol_status} from={row.original.os_eol_from} /> },
  {
    accessorKey: "cycle_status",
    header: "Cycle status",
    cell: ({ row }) => (
      <div className="flex flex-col items-start gap-1">
        <StatusBadge status={asScanStatus(row.original.cycle_status)} label={row.original.cycle_status === "error" ? "Query error" : undefined} />
        {row.original.next_attempt_at && row.original.cycle_status === "retry_scheduled" ? (
          <span className="text-xs text-text-muted">Next {formatDateTime(row.original.next_attempt_at)}</span>
        ) : null}
        {row.original.last_error && row.original.cycle_status === "error" ? (
          <span className="max-w-64 truncate text-xs text-text-muted" title={row.original.last_error}>
            {row.original.last_error}
          </span>
        ) : null}
      </div>
    ),
  },
  { accessorKey: "programs", header: "Programs", cell: ({ getValue }) => formatNumber(getValue() as number) },
  { accessorKey: "extensions", header: "Extensions", cell: ({ getValue }) => formatNumber(getValue() as number) },
  { accessorKey: "packages", header: "Packages", cell: ({ getValue }) => formatNumber(getValue() as number) },
  {
    accessorKey: "attention",
    header: "Attention",
    enableSorting: false,
    cell: ({ row }) => (
      <AttentionIcons
        scope="computer"
        categories={(row.original.attention as unknown as AttentionCategory[]) ?? []}
        vulns={row.original.vulns as unknown as VulnCounts | null}
      />
    ),
  },
];

const TABS: { value: ComputerFilters["status"]; label: string }[] = [
  { value: "all", label: "All" },
  { value: "collected", label: "Collected" },
  { value: "retry_scheduled", label: "Retry scheduled" },
  { value: "error", label: "Query errors" },
];

export function ComputersPage() {
  const { selectedTenantId } = useTenant();
  const [status, setStatus] = useState<ComputerFilters["status"]>("all");
  const [platform, setPlatform] = useState<ComputerFilters["platform"]>("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [criticality, setCriticality] = useState<ComputerFilters["criticality"]>("");
  const [scope, setScope] = useState("");
  const [owner, setOwner] = useState("");
  const [version, setVersion] = useState(0);
  const canEdit = useCanEditContext();
  const [params] = useSearchParams();
  const [coverage, setCoverage] = useState<ComputerFilters["coverage"]>(() => {
    const c = params.get("coverage");
    return c === "never" || c === "stale" || c === "current" ? c : "";
  });
  const [support, setSupport] = useState<ComputerFilters["support"]>(() => {
    const v = params.get("support");
    return v === "eol" || v === "ending_soon" || v === "supported" ? v : "";
  });
  const [patch, setPatch] = useState<ComputerFilters["patch"]>(() => {
    const v = params.get("patch");
    return v === "current" || v === "stale" || v === "unknown" ? v : "";
  });
  const attention = useLoad(`attention:${selectedTenantId ?? "all"}`, () => fetchNeedsAttention(selectedTenantId, 50));

  const level1 = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of attention.data ?? []) seen.set(row.category_slug.split("/")[0], row.level1_name);
    return [...seen.entries()];
  }, [attention.data]);

  const filters = useMemo<ComputerFilters>(
    () => ({ tenantId: selectedTenantId, status, platform, coverage, support, patch, category, search, criticality, scope, owner }),
    [selectedTenantId, status, platform, coverage, support, patch, category, search, criticality, scope, owner],
  );
  // A new function reloads the table after an import.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchPage = useCallback((request: ServerPageRequest<ComputerFilters>) => fetchComputers(request.filters, request), [version]);

  return (
    <>
      <PageHeader eyebrow="Inventory" title="Computers" description="Who is collected, on retry or in error." actions={
          <>
            {canEdit ? <ImportContextButton tenantId={selectedTenantId} onDone={() => setVersion((v) => v + 1)} /> : null}
            <ExportButton dataset="computers" filters={filters} />
          </>
        } />
      <Tabs value={status} onValueChange={(v) => setStatus(v as ComputerFilters["status"])}>
        <TabsList aria-label="Cycle status">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Search" htmlFor="computer-search" className="flex-[1_1_260px]">
          <Input id="computer-search" type="search" placeholder="Hostname, user or OS" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        <Field label="Platform" htmlFor="computer-platform" className="w-44">
          <NativeSelect
            id="computer-platform"
            value={platform}
            onChange={(v) => setPlatform(v as ComputerFilters["platform"])}
            options={[{ value: "", label: "All platforms" }, ...Object.entries(PLATFORM_LABEL).map(([value, l]) => ({ value, label: l }))]}
          />
        </Field>
        <Field label="Owner" htmlFor="computer-owner" className="w-44">
          <Input id="computer-owner" type="search" value={owner} onChange={(e) => setOwner(e.target.value)} />
        </Field>
        <Field label="Criticality" htmlFor="computer-criticality" className="w-40">
          <NativeSelect
            id="computer-criticality"
            value={criticality}
            onChange={(v) => setCriticality(v as ComputerFilters["criticality"])}
            options={[{ value: "", label: "All criticality" }, ...CRITICALITY_OPTIONS.slice(1)]}
          />
        </Field>
        <Field label="Scope tag" htmlFor="computer-scope" className="w-40">
          <Input id="computer-scope" type="search" value={scope} onChange={(e) => setScope(e.target.value)} />
        </Field>
        <Field label="Coverage" htmlFor="computer-coverage" className="w-48">
          <NativeSelect
            id="computer-coverage"
            value={coverage}
            onChange={(v) => setCoverage(v as ComputerFilters["coverage"])}
            options={[
              { value: "", label: "All coverage" },
              { value: "never", label: "Never inventoried" },
              { value: "stale", label: "Stale" },
              { value: "current", label: "Current" },
            ]}
          />
        </Field>
        <Field label="OS support" htmlFor="computer-support" className="w-48">
          <NativeSelect id="computer-support" value={support} onChange={(v) => setSupport(v as ComputerFilters["support"])} options={SUPPORT_FILTERS.map((f) => ({ value: f.value, label: f.value === "" ? "All" : f.label }))} />
        </Field>
        <Field label="Patches" htmlFor="computer-patch" className="w-48">
          <NativeSelect
            id="computer-patch"
            value={patch}
            onChange={(v) => setPatch(v as ComputerFilters["patch"])}
            options={[
              { value: "", label: "All" },
              { value: "current", label: "Recently patched" },
              { value: "stale", label: "No recent patch" },
              { value: "unknown", label: "No patch data" },
            ]}
          />
        </Field>
      </div>
      {level1.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Has a category that needs attention">
          <span className="text-[13px] font-semibold text-text-strong">Has</span>
          {level1.map(([slug, name]) => (
            <FilterChip key={slug} pressed={category === slug} onClick={() => setCategory(category === slug ? "" : slug)}>
              {name}
            </FilterChip>
          ))}
        </div>
      ) : null}
      <ServerDataTable
        label="Computers"
        columns={COLUMNS}
        fetchPage={fetchPage}
        filters={filters}
        getRowId={(row) => row.id ?? ""}
        initialSorting={[{ id: "hostname", desc: false }]}
        empty={<EmptyState icon={Monitor} title="No computers match" description="Computers appear after the first sync with Sophos Central." />}
      />
    </>
  );
}
