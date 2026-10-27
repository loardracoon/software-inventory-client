import { useCallback } from "react";
import { Building2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { Eyebrow } from "@/components/shared/eyebrow";
import { ServerDataTable, type ServerColumnDef, type ServerPageRequest } from "@/components/shared/server-data-table";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime, formatHost } from "@/lib/format";

type TenantRow = {
  id: string;
  name: string;
  id_type: string;
  data_region_host: string | null;
  active_computers: number;
  retired_computers: number;
  last_synced_at: string | null;
};

const ID_TYPE_LABEL: Record<string, string> = { tenant: "Tenant", partner: "Partner", organization: "Organization" };

const COLUMNS: ServerColumnDef<TenantRow>[] = [
  { accessorKey: "name", header: "Tenant" },
  { accessorKey: "id_type", header: "Reached through", enableSorting: false, cell: ({ getValue }) => ID_TYPE_LABEL[getValue() as string] ?? getValue() },
  { accessorKey: "data_region_host", header: "Region", enableSorting: false, cell: ({ getValue }) => formatHost(getValue() as string | null) },
  { accessorKey: "active_computers", header: "Computers" },
  { accessorKey: "retired_computers", header: "Retired" },
  {
    accessorKey: "last_synced_at",
    header: "Last synced",
    cell: ({ getValue }) => {
      const value = getValue() as string | null;
      return value ? formatDateTime(value) : "Never";
    },
  },
];

const SELECT = "id, name, id_type, data_region_host, active_computers, retired_computers, last_synced_at";
const NO_FILTERS = {};
const INITIAL_SORTING = [{ id: "name", desc: false }];

// refreshKey changes after a sync so the list reloads.
export function TenantsCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const fetchPage = useCallback(
    async ({ pageIndex, pageSize, sorting, signal }: ServerPageRequest<typeof NO_FILTERS>) => {
      if (!supabase) throw new Error("Supabase is not configured.");
      const sort = sorting[0] ?? INITIAL_SORTING[0];
      const from = pageIndex * pageSize;
      const { data, count, error } = await supabase
        .from("v_tenant_overview")
        .select(SELECT, { count: "exact" })
        .order(sort.id as keyof TenantRow, { ascending: !sort.desc, nullsFirst: false })
        .range(from, from + pageSize - 1)
        .abortSignal(signal);
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as TenantRow[], rowCount: count ?? 0 };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey only forces a new request
    [refreshKey],
  );

  return (
    <Card className="gap-5 px-6">
      <div className="flex flex-col gap-2">
        <Eyebrow>Sophos Central</Eyebrow>
        <h2 className="m-0 text-xl">Tenants</h2>
      </div>
      <ServerDataTable
        label="Tenants"
        columns={COLUMNS}
        fetchPage={fetchPage}
        filters={NO_FILTERS}
        initialSorting={INITIAL_SORTING}
        getRowId={(row) => row.id}
        empty={
          <EmptyState
            icon={Building2}
            title="No tenants yet"
            description="Tenants appear after the first sync with Sophos Central. Analysts and viewers see only the tenants an admin assigns to them."
          />
        }
      />
    </Card>
  );
}
