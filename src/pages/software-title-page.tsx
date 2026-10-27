import { useCallback, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { History, Package } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CategoryTag, categoryFromRow } from "@/components/shared/category-tag";
import { toCategoryOrigin } from "@/components/shared/change-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorLine } from "@/components/shared/error-line";
import { Eyebrow } from "@/components/shared/eyebrow";
import { PageHeader } from "@/components/shared/page-header";
import { ServerDataTable, type ServerColumnDef, type ServerPageRequest } from "@/components/shared/server-data-table";
import {
  fetchChanges,
  fetchInstallations,
  fetchTitle,
  fetchTitleVersions,
  type ChangeFilters,
  type InstallationFilters,
  type InstallationRow,
} from "@/features/inventory/api";
import { ExportButton } from "@/features/dictionary/export-button";
import { TitleClassificationActions, TitleRequestsCard } from "@/features/dictionary/title-classification";
import { CHANGE_COLUMNS_WITH_COMPUTER } from "@/features/inventory/change-columns";
import { useTenant } from "@/features/tenants/tenant-context";
import { formatDate, formatNumber } from "@/lib/format";
import { KIND_LABEL, label, PLATFORM_LABEL, SOURCE_LABEL } from "@/lib/labels";
import { useLoad } from "@/lib/use-load";

const COMPUTER_COLUMNS: ServerColumnDef<InstallationRow>[] = [
  {
    accessorKey: "hostname",
    header: "Computer",
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <Link to={`/computers/${row.original.computer_id}`}>{row.original.hostname}</Link>
        <span className="text-xs text-text-muted">{label(PLATFORM_LABEL, row.original.platform)}</span>
      </div>
    ),
  },
  {
    accessorKey: "username",
    header: "User",
    cell: ({ row }) => (row.original.user_masked ? <span className="text-text-muted">Hidden</span> : (row.original.username ?? "—")),
  },
  { accessorKey: "version", header: "Version" },
  { accessorKey: "valid_from", header: "In inventory since", cell: ({ getValue }) => formatDate(getValue() as string) },
  { accessorKey: "path", header: "Path", enableSorting: false, cell: ({ getValue }) => <span className="font-mono text-xs">{(getValue() as string | null) ?? "—"}</span> },
];

export function SoftwareTitlePage() {
  const { titleId = "" } = useParams();
  const { selectedTenantId } = useTenant();
  const [revision, setRevision] = useState(0);
  const title = useLoad(`title:${titleId}:${revision}`, () => fetchTitle(titleId));
  const versions = useLoad(`versions:${titleId}:${selectedTenantId ?? "all"}`, () => fetchTitleVersions(titleId, selectedTenantId));

  const installationFetch = useCallback((r: ServerPageRequest<InstallationFilters>) => fetchInstallations(r.filters, r), []);
  const changeFetch = useCallback((r: ServerPageRequest<ChangeFilters>) => fetchChanges(r.filters, r), []);
  const computerFilters = useMemo<InstallationFilters>(() => ({ tenantId: selectedTenantId, titleId, asOf: null }), [selectedTenantId, titleId]);
  const changeFilters = useMemo<ChangeFilters>(
    () => ({ tenantId: selectedTenantId, change: "", kind: "", category: "", from: null, to: null, search: "", titleId }),
    [selectedTenantId, titleId],
  );

  if (title.error) return <ErrorLine message={title.error} />;
  const t = title.data?.title;
  const c = title.data?.classification;
  if (!title.loading && !t) {
    return (
      <>
        <PageHeader eyebrow="Software title" title="Title not found" />
        <EmptyState icon={Package} title="This title does not exist" />
      </>
    );
  }

  const max = Math.max(1, ...(versions.data ?? []).map((v) => v.computers));
  const total = (versions.data ?? []).reduce((sum, v) => sum + v.computers, 0);

  return (
    <>
      <PageHeader
        eyebrow={t ? `${label(KIND_LABEL, t.kind)} · ${label(SOURCE_LABEL, t.source)}` : "Software title"}
        title={t?.canonical_name ?? "…"}
        description={t ? [t.vendor, t.external_id].filter(Boolean).join(" · ") || undefined : undefined}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_2fr]">
        <Card className="gap-4 px-6">
          <Eyebrow>Category</Eyebrow>
          {c ? <CategoryTag category={categoryFromRow(c)} origin={toCategoryOrigin(c.origin, c.method, c.confidence)} /> : <Skeleton className="h-12 w-full" />}
          {t ? (
            <TitleClassificationActions
              titleId={titleId}
              name={t.canonical_name}
              currentCategory={c?.level2_name ? `${c.level1_name} / ${c.level2_name}` : null}
              onChanged={() => setRevision((n) => n + 1)}
            />
          ) : null}
          <p className="m-0 text-sm text-text-muted">
            Installed on {formatNumber(total)} computer{total === 1 ? "" : "s"} · first seen {t ? formatDate(t.first_seen_at) : "—"}
          </p>
        </Card>
        <Card className="gap-4 px-6">
          <Eyebrow>Version distribution</Eyebrow>
          {versions.loading ? <Skeleton className="h-20 w-full" /> : null}
          {versions.data && versions.data.length === 0 ? <p className="m-0 text-sm text-text-muted">Not installed on any active computer.</p> : null}
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Computers per version">
            {(versions.data ?? []).map((v) => (
              <li key={v.version ?? "none"} className="grid grid-cols-[minmax(6rem,auto)_1fr_auto] items-center gap-3 text-sm">
                <span className="font-mono">{v.version ?? "—"}</span>
                <span className="h-2.5 rounded-full bg-surface-subtle">
                  <span className="block h-full rounded-full bg-action" style={{ width: `${(100 * v.computers) / max}%` }} />
                </span>
                <span className="text-text-muted">{formatNumber(v.computers)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <TitleRequestsCard titleId={titleId} refreshKey={revision} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-xl">Computers</h2>
        <ExportButton dataset="title_computers" filters={computerFilters} />
      </div>
      <ServerDataTable label="Computers with this title" columns={COMPUTER_COLUMNS} fetchPage={installationFetch} filters={computerFilters} getRowId={(r) => r.id ?? ""} initialSorting={[{ id: "hostname", desc: false }]} />
      <h2 className="m-0 text-xl">Change history</h2>
      <ServerDataTable
        label="Change history"
        columns={CHANGE_COLUMNS_WITH_COMPUTER}
        fetchPage={changeFetch}
        filters={changeFilters}
        getRowId={(r) => r.id ?? ""}
        initialSorting={[{ id: "detected_at", desc: true }]}
        empty={<EmptyState icon={History} title="No changes yet" />}
      />
    </>
  );
}
