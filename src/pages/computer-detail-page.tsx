import { useCallback, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { History, Loader2, Monitor, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CategoryTag, categoryFromRow } from "@/components/shared/category-tag";
import { toCategoryOrigin } from "@/components/shared/change-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorLine } from "@/components/shared/error-line";
import { DateInput, Field } from "@/components/shared/filters";
import { Eyebrow } from "@/components/shared/eyebrow";
import { PageHeader } from "@/components/shared/page-header";
import { ServerDataTable, type ServerColumnDef, type ServerPageRequest } from "@/components/shared/server-data-table";
import { asScanStatus, StatusBadge } from "@/components/shared/status-badge";
import { useAuth } from "@/features/auth/auth-context";
import { useCanContribute } from "@/features/dictionary/api";
import { ReclassifyDialog, type ReclassifyTarget } from "@/features/dictionary/reclassify-dialog";
import {
  fetchChanges,
  fetchComputer,
  fetchComputerTasks,
  fetchHardware,
  fetchInstallations,
  scanNow,
  type ChangeFilters,
  type InstallationFilters,
  type InstallationRow,
} from "@/features/inventory/api";
import { endOfDayIso, formatDate, formatDateTime } from "@/lib/format";
import { label, PLATFORM_LABEL, SOURCE_LABEL } from "@/lib/labels";
import { useLoad } from "@/lib/use-load";
import { CHANGE_COLUMNS } from "@/features/inventory/change-columns";

// Memory in binary units (16 GB = 16 GiB, as the OS shows it); disks in decimal units, as vendors sell them.
const bytes = (value: unknown, binary = false) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const giga = binary ? 1024 ** 3 : 1e9;
  const tera = giga * (binary ? 1024 : 1000);
  return n >= tera ? `${(n / tera).toFixed(1)} TB` : `${Math.round(n / giga)} GB`;
};

const categoryCell: ServerColumnDef<InstallationRow> = {
  accessorKey: "level2_name",
  header: "Category",
  cell: ({ row }) => (
    <CategoryTag category={categoryFromRow(row.original)} origin={toCategoryOrigin(row.original.origin, row.original.method, row.original.confidence)} />
  ),
};

function signals(row: InstallationRow) {
  const attrs = (row.attrs ?? {}) as Record<string, unknown>;
  const out: string[] = [];
  if (typeof attrs.update_url === "string" && attrs.update_url.startsWith("http://")) out.push("Update over HTTP");
  if (Array.isArray(attrs.stale_folders) && attrs.stale_folders.length) out.push("Old versions on disk");
  return out;
}

const EXTENSION_COLUMNS: ServerColumnDef<InstallationRow>[] = [
  {
    accessorKey: "canonical_name",
    header: "Extension",
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <Link to={`/software/${row.original.title_id}`}>{row.original.canonical_name}</Link>
        <span className="font-mono text-xs text-text-muted">{row.original.external_id}</span>
      </div>
    ),
  },
  {
    accessorKey: "source",
    header: "Browser · profile",
    cell: ({ row }) => {
      const profile = (row.original.attrs as Record<string, unknown> | null)?.profile;
      return `${label(SOURCE_LABEL, row.original.source)}${typeof profile === "string" && profile ? ` · ${profile}` : ""}`;
    },
  },
  {
    accessorKey: "username",
    header: "User",
    cell: ({ row }) => (row.original.user_masked ? <span className="text-text-muted">Hidden</span> : (row.original.username ?? "—")),
  },
  { accessorKey: "version", header: "Version" },
  categoryCell,
  {
    id: "signals",
    header: "Signals",
    enableSorting: false,
    cell: ({ row }) => {
      const list = signals(row.original);
      return list.length ? (
        <div className="flex flex-wrap gap-1">
          {list.map((s) => (
            <Badge key={s} color="medium" soft>
              {s}
            </Badge>
          ))}
        </div>
      ) : (
        <span className="text-text-muted">—</span>
      );
    },
  },
];

const PROGRAM_COLUMNS: ServerColumnDef<InstallationRow>[] = [
  {
    accessorKey: "canonical_name",
    header: "Program",
    cell: ({ row }) => <Link to={`/software/${row.original.title_id}`}>{row.original.canonical_name}</Link>,
  },
  { accessorKey: "vendor", header: "Publisher", enableSorting: false, cell: ({ getValue }) => (getValue() as string | null) ?? "—" },
  { accessorKey: "version", header: "Version" },
  categoryCell,
  {
    accessorKey: "valid_from",
    header: "In inventory since",
    cell: ({ getValue }) => formatDate(getValue() as string),
  },
];

const PACKAGE_COLUMNS: ServerColumnDef<InstallationRow>[] = [
  {
    accessorKey: "canonical_name",
    header: "Package",
    cell: ({ row }) => <Link to={`/software/${row.original.title_id}`}>{row.original.canonical_name}</Link>,
  },
  { accessorKey: "source", header: "Manager", cell: ({ getValue }) => label(SOURCE_LABEL, getValue() as string) },
  { accessorKey: "version", header: "Version" },
  { accessorKey: "path", header: "Path", enableSorting: false, cell: ({ getValue }) => <span className="font-mono text-xs">{(getValue() as string | null) ?? "—"}</span> },
  categoryCell,
];

export function ComputerDetailPage() {
  const { id = "" } = useParams();
  const { profile } = useAuth();
  const [asOfDate, setAsOfDate] = useState("");
  const [scanning, setScanning] = useState(false);
  const asOf = asOfDate ? endOfDayIso(asOfDate) : null;

  const computer = useLoad(`computer:${id}`, () => fetchComputer(id));
  const tasks = useLoad(`tasks:${id}`, () => fetchComputerTasks(id));
  const hardware = useLoad(`hardware:${id}:${asOf}`, () => fetchHardware(id, asOf));

  const installationFetch = useCallback(
    (request: ServerPageRequest<InstallationFilters>) => fetchInstallations(request.filters, request),
    [],
  );
  const changeFetch = useCallback((request: ServerPageRequest<ChangeFilters>) => fetchChanges(request.filters, request), []);
  const canContribute = useCanContribute();
  const [reclassifying, setReclassifying] = useState<ReclassifyTarget | null>(null);
  const extensionColumns = useMemo<ServerColumnDef<InstallationRow>[]>(
    () =>
      canContribute
        ? [
            ...EXTENSION_COLUMNS,
            {
              id: "actions",
              header: () => <span className="sr-only">Actions</span>,
              enableSorting: false,
              cell: ({ row }) => (
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={`Request reclassification of ${row.original.canonical_name}`}
                  onClick={() =>
                    setReclassifying({
                      titleId: row.original.title_id ?? "",
                      name: row.original.canonical_name ?? "",
                      currentCategory: row.original.level2_name ? `${row.original.level1_name} / ${row.original.level2_name}` : null,
                    })
                  }
                >
                  Reclassify
                </Button>
              ),
            },
          ]
        : EXTENSION_COLUMNS,
    [canContribute],
  );
  const extensionFilters = useMemo<InstallationFilters>(() => ({ computerId: id, domains: ["extensions", "ide_extensions"], asOf }), [id, asOf]);
  const programFilters = useMemo<InstallationFilters>(() => ({ computerId: id, domains: ["programs"], asOf }), [id, asOf]);
  const packageFilters = useMemo<InstallationFilters>(() => ({ computerId: id, domains: ["packages"], asOf }), [id, asOf]);
  const historyFilters = useMemo<ChangeFilters>(
    () => ({ tenantId: null, change: "", kind: "", category: "", from: null, to: null, search: "", computerId: id }),
    [id],
  );

  const c = computer.data;
  if (computer.error) return <ErrorLine message={computer.error} />;
  if (!computer.loading && !c) {
    return (
      <>
        <PageHeader eyebrow="Computer" title="Computer not found" />
        <EmptyState icon={Monitor} title="This computer does not exist or is not in your tenants" />
      </>
    );
  }

  async function onScanNow() {
    setScanning(true);
    try {
      const n = await scanNow(id);
      toast.success(`Scan requested: ${n} quer${n === 1 ? "y" : "ies"} will run with priority`);
      tasks.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not request the scan");
    } finally {
      setScanning(false);
    }
  }

  const system = hardware.data?.find((h) => h.domain === "hardware")?.attrs as Record<string, string | null> | undefined;
  const disks = (hardware.data ?? []).filter((h) => h.domain === "disks");

  return (
    <>
      <PageHeader
        eyebrow={c ? label(PLATFORM_LABEL, c.platform) : "Computer"}
        title={c?.hostname ?? "…"}
        description={
          c ? (
            <>
              {[c.os_name, c.os_version].filter(Boolean).join(" ")} · User {c.user_masked ? "hidden" : (c.associated_user ?? "—")} · Last seen{" "}
              {c.last_seen_at ? formatDateTime(c.last_seen_at) : "—"} · Last collected {c.last_collected_at ? formatDateTime(c.last_collected_at) : "never"}
            </>
          ) : null
        }
        actions={
          profile?.role === "admin" && c ? (
            <Button size="sm" onClick={() => void onScanNow()} disabled={scanning}>
              {scanning ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
              Scan now
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-end gap-4">
        <Field label="Inventory as of" htmlFor="as-of" className="w-48">
          <DateInput id="as-of" value={asOfDate} onChange={setAsOfDate} />
        </Field>
        {asOfDate ? (
          <Button variant="ghost" size="sm" onClick={() => setAsOfDate("")}>
            Back to today
          </Button>
        ) : null}
        {asOfDate ? <p className="m-0 pb-2 text-sm text-text-muted">Showing what was installed at the end of {formatDate(asOf!)}.</p> : null}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="gap-4 px-6">
          <Eyebrow>Hardware</Eyebrow>
          {hardware.loading ? <Skeleton className="h-24 w-full" /> : null}
          {!hardware.loading && !system ? <p className="m-0 text-sm text-text-muted">No hardware collected for this date.</p> : null}
          {system ? (
            <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
              <dt className="text-text-muted">Model</dt>
              <dd className="m-0">{[system.hardware_vendor, system.hardware_model].filter(Boolean).join(" ") || "—"}</dd>
              <dt className="text-text-muted">Serial</dt>
              <dd className="m-0 font-mono">{system.hardware_serial ?? "—"}</dd>
              <dt className="text-text-muted">CPU</dt>
              <dd className="m-0">
                {system.cpu_brand ?? "—"}
                {system.cpu_logical_cores ? ` · ${system.cpu_physical_cores ?? "?"} cores / ${system.cpu_logical_cores} threads` : ""}
              </dd>
              <dt className="text-text-muted">Memory</dt>
              <dd className="m-0">{bytes(system.physical_memory, true)}</dd>
              <dt className="text-text-muted">OS</dt>
              <dd className="m-0">{[system.os_name, system.os_version, system.arch].filter(Boolean).join(" · ") || "—"}</dd>
              <dt className="text-text-muted">BIOS</dt>
              <dd className="m-0">{[system.bios_vendor, system.bios_version, system.bios_date].filter(Boolean).join(" · ") || "—"}</dd>
              {disks.map((d) => {
                const a = d.attrs as Record<string, string | null>;
                return (
                  <div key={d.item_key} className="contents">
                    <dt className="text-text-muted">Disk {d.item_key}</dt>
                    <dd className="m-0">
                      {[a.type, a.file_system].filter(Boolean).join(" · ")} · {bytes(a.size)} · {bytes(a.free_space)} free
                    </dd>
                  </div>
                );
              })}
            </dl>
          ) : null}
        </Card>
        <Card className="gap-4 px-6">
          <Eyebrow>Collected this cycle</Eyebrow>
          {tasks.loading ? <Skeleton className="h-24 w-full" /> : null}
          {tasks.data && tasks.data.length === 0 ? <p className="m-0 text-sm text-text-muted">No task in the open cycle.</p> : null}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {(tasks.data ?? []).map((t) => (
              <li key={t.query_name} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-mono text-[13px]">{t.query_name}</span>
                <span className="flex flex-col items-end gap-0.5">
                  <StatusBadge status={asScanStatus(t.status)} label={t.status === "error" ? "Query error" : undefined} />
                  {t.status === "retry_scheduled" && t.next_attempt_at ? (
                    <span className="text-xs text-text-muted">Next {formatDateTime(t.next_attempt_at)}</span>
                  ) : null}
                  {(t.status === "error" || t.status === "skipped") && t.last_error ? (
                    <span className="max-w-72 truncate text-xs text-text-muted" title={t.last_error}>
                      {t.last_error}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Tabs defaultValue="extensions">
        <TabsList aria-label="Inventory">
          <TabsTrigger value="extensions">Extensions</TabsTrigger>
          <TabsTrigger value="programs">Programs</TabsTrigger>
          <TabsTrigger value="packages">Packages</TabsTrigger>
          <TabsTrigger value="history">
            <History className="size-4" aria-hidden="true" />
            History
          </TabsTrigger>
        </TabsList>
        <TabsContent value="extensions">
          <ServerDataTable label="Extensions" columns={extensionColumns} fetchPage={installationFetch} filters={extensionFilters} getRowId={(r) => r.id ?? ""} />
          <ReclassifyDialog target={reclassifying} onOpenChange={(open) => !open && setReclassifying(null)} onRequested={() => setReclassifying(null)} />
        </TabsContent>
        <TabsContent value="programs">
          <ServerDataTable label="Programs" columns={PROGRAM_COLUMNS} fetchPage={installationFetch} filters={programFilters} getRowId={(r) => r.id ?? ""} />
        </TabsContent>
        <TabsContent value="packages">
          <ServerDataTable label="Packages" columns={PACKAGE_COLUMNS} fetchPage={installationFetch} filters={packageFilters} getRowId={(r) => r.id ?? ""} />
        </TabsContent>
        <TabsContent value="history">
          <ServerDataTable
            label="History"
            columns={CHANGE_COLUMNS}
            fetchPage={changeFetch}
            filters={historyFilters}
            getRowId={(r) => r.id ?? ""}
            initialSorting={[{ id: "detected_at", desc: true }]}
            empty={<EmptyState icon={History} title="No changes yet" description="Changes are recorded from the second collection of each query on." />}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
