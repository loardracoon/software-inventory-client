import { useCallback, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorLine } from "@/components/shared/error-line";
import { Eyebrow } from "@/components/shared/eyebrow";
import { Field, NativeSelect } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { ServerDataTable, type ServerColumnDef, type ServerPageRequest } from "@/components/shared/server-data-table";
import { asScanStatus, StatusBadge } from "@/components/shared/status-badge";
import { useAuth } from "@/features/auth/auth-context";
import { HubDelayedBanner } from "@/features/dictionary/hub-delayed-banner";
import { BudgetCard } from "@/features/inventory/budget-card";
import {
  fetchBudget,
  fetchCycleOverview,
  fetchRecentRuns,
  fetchRetryQueue,
  fetchScanSettings,
  saveScanSettings,
  type RetryRow,
  type RunRow,
  type ScanSettings,
} from "@/features/inventory/api";
import { CycleCard } from "@/features/inventory/cycle-card";
import { useTenant } from "@/features/tenants/tenant-context";
import { formatDateTime, formatDuration, formatNumber } from "@/lib/format";
import { label, PLATFORM_LABEL } from "@/lib/labels";
import { useLoad } from "@/lib/use-load";

const RETRY_COLUMNS: ServerColumnDef<RetryRow>[] = [
  {
    accessorKey: "hostname",
    header: "Computer",
    enableSorting: false,
    cell: ({ row }) => <Link to={`/computers/${row.original.computer_id}`}>{row.original.hostname}</Link>,
  },
  { accessorKey: "platform", header: "Platform", enableSorting: false, cell: ({ getValue }) => label(PLATFORM_LABEL, getValue() as string) },
  { accessorKey: "query_name", header: "Query", enableSorting: false, cell: ({ getValue }) => <span className="font-mono text-[13px]">{getValue() as string}</span> },
  { accessorKey: "attempts", header: "Attempts", enableSorting: false },
  {
    accessorKey: "status",
    header: "Status",
    enableSorting: false,
    cell: ({ row }) => (
      <div className="flex flex-col items-start gap-1">
        <StatusBadge status={asScanStatus(row.original.status)} />
        {row.original.last_error ? (
          <span className="max-w-72 truncate text-xs text-text-muted" title={row.original.last_error}>
            {row.original.last_error}
          </span>
        ) : null}
      </div>
    ),
  },
  { accessorKey: "last_seen_at", header: "Last seen in Central", enableSorting: false, cell: ({ getValue }) => (getValue() ? formatDateTime(getValue() as string) : "—") },
  { accessorKey: "next_attempt_at", header: "Next attempt", enableSorting: false, cell: ({ getValue }) => (getValue() ? formatDateTime(getValue() as string) : "—") },
];

const RUN_COLUMNS: ServerColumnDef<RunRow>[] = [
  { accessorKey: "started_at", header: "Started", enableSorting: false, cell: ({ getValue }) => formatDateTime(getValue() as string) },
  {
    accessorKey: "query_name",
    header: "Query",
    enableSorting: false,
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-[13px]">
          {row.original.query_name ?? row.original.domain}.v{row.original.query_version}
        </span>
        <span className="text-xs text-text-muted">
          {label(PLATFORM_LABEL, row.original.platform)} · {row.original.provider === "live_discover_rest" ? "Live Discover REST" : "Live Endpoint Search"}
          {row.original.priority ? " · priority" : ""}
        </span>
      </div>
    ),
  },
  { accessorKey: "endpoints", header: "Computers", enableSorting: false, cell: ({ getValue }) => formatNumber(getValue() as number) },
  { accessorKey: "collected", header: "Collected", enableSorting: false, cell: ({ getValue }) => formatNumber(getValue() as number) },
  { accessorKey: "no_response", header: "No response", enableSorting: false, cell: ({ getValue }) => formatNumber(getValue() as number) },
  { accessorKey: "duration_seconds", header: "Duration", enableSorting: false, cell: ({ getValue }) => formatDuration(getValue() as number) },
  {
    accessorKey: "status",
    header: "Outcome",
    enableSorting: false,
    cell: ({ row }) => {
      const r = row.original;
      if (r.status === "running") return <StatusBadge status="dispatched" label="Running" />;
      if (r.status === "failed") return <StatusBadge status="error" label="Failed" />;
      if ((r.errors ?? 0) > 0) return <StatusBadge status="error" label={`${r.errors} query error${r.errors === 1 ? "" : "s"}`} />;
      if ((r.no_response ?? 0) > 0) return <StatusBadge status="retry_scheduled" label="Partly answered" />;
      return <StatusBadge status="collected" label="Finished" />;
    },
  },
];

export function ScansPage() {
  const { selectedTenantId, tenants } = useTenant();
  const cycles = useLoad(`cycles:${selectedTenantId ?? "all"}`, () => fetchCycleOverview(selectedTenantId));
  const budget = useLoad(`budget:${selectedTenantId ?? "all"}`, () => fetchBudget(selectedTenantId));
  const retryFetch = useCallback((r: ServerPageRequest<{ tenantId: string | null }>) => fetchRetryQueue(r.filters.tenantId, r), []);
  const runFetch = useCallback((r: ServerPageRequest<{ tenantId: string | null }>) => fetchRecentRuns(r.filters.tenantId, r), []);
  const filters = useMemo(() => ({ tenantId: selectedTenantId }), [selectedTenantId]);
  const settingsTenant = selectedTenantId ?? (tenants.length === 1 ? tenants[0].id : null);

  return (
    <>
      <PageHeader
        eyebrow="Collection"
        title="Scans"
        description="Weekly cycle progress, the daily retry queue and recent Live Discover runs."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              cycles.reload();
              budget.reload();
            }}
          >
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
        }
      />
      <HubDelayedBanner />
      {cycles.error ? <ErrorLine message={cycles.error} /> : null}
      <CycleCard loading={cycles.loading} cycles={cycles.data ?? []} />
      <BudgetCard loading={budget.loading} rows={budget.data ?? []} />

      <Tabs defaultValue="retry">
        <TabsList aria-label="Collection details">
          <TabsTrigger value="retry">Retry queue</TabsTrigger>
          <TabsTrigger value="runs">Recent runs</TabsTrigger>
        </TabsList>
        <TabsContent value="retry">
          <ServerDataTable
            label="Retry queue"
            columns={RETRY_COLUMNS}
            fetchPage={retryFetch}
            filters={filters}
            getRowId={(r) => r.id ?? ""}
            empty={<EmptyState icon={RefreshCw} title="Nothing waiting for a retry" description="Computers that do not answer are retried once a day until the cycle closes." />}
          />
        </TabsContent>
        <TabsContent value="runs">
          <ServerDataTable label="Recent runs" columns={RUN_COLUMNS} fetchPage={runFetch} filters={filters} getRowId={(r) => r.id ?? ""} />
        </TabsContent>
      </Tabs>

      {settingsTenant ? (
        <ScheduleCard tenantId={settingsTenant} tenantName={tenants.find((t) => t.id === settingsTenant)?.name ?? ""} />
      ) : (
        <Card className="gap-2 px-6">
          <Eyebrow>Schedule</Eyebrow>
          <p className="m-0 text-sm text-text-muted">Select a tenant in the top bar to see or change its schedule.</p>
        </Card>
      )}
    </>
  );
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function ScheduleCard({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const settings = useLoad(`settings:${tenantId}`, () => fetchScanSettings(tenantId));

  return (
    <Card className="gap-5 px-6">
      <div className="flex flex-col gap-2">
        <Eyebrow>Schedule{isAdmin ? " · admins only" : ""}</Eyebrow>
        <h2 className="m-0 text-xl">Scan settings for {tenantName}</h2>
      </div>
      {settings.loading ? <Skeleton className="h-40 w-full" /> : null}
      {settings.error ? <ErrorLine message={settings.error} /> : null}
      {settings.data ? <ScheduleForm key={settings.data.updated_at} settings={settings.data} readOnly={!isAdmin} onSaved={settings.reload} /> : null}
    </Card>
  );
}

function ScheduleForm({ settings, readOnly, onSaved }: { settings: ScanSettings; readOnly: boolean; onSaved: () => void }) {
  const [values, setValues] = useState(settings);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof ScanSettings>(key: K, value: ScanSettings[K]) => setValues((v) => ({ ...v, [key]: value }));
  const num = (key: keyof ScanSettings) => (e: React.ChangeEvent<HTMLInputElement>) => set(key, Number(e.target.value) as never);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await saveScanSettings(settings.tenant_id, values);
      toast.success("Scan settings saved");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <fieldset disabled={readOnly || saving} className="m-0 grid grid-cols-1 gap-4 border-0 p-0 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Weekly scan day" htmlFor="s-weekday">
          <NativeSelect
            id="s-weekday"
            value={String(values.cycle_weekday)}
            onChange={(v) => set("cycle_weekday", Number(v))}
            options={WEEKDAYS.map((d, i) => ({ value: String(i + 1), label: d }))}
          />
        </Field>
        <Field label="Weekly scan time" htmlFor="s-time">
          <Input id="s-time" type="time" value={values.cycle_time.slice(0, 5)} onChange={(e) => set("cycle_time", e.target.value)} required />
        </Field>
        <Field label="Daily retry time" htmlFor="s-retry">
          <Input id="s-retry" type="time" value={values.retry_time.slice(0, 5)} onChange={(e) => set("retry_time", e.target.value)} required />
        </Field>
        <Field label="Time zone" htmlFor="s-tz">
          <Input id="s-tz" value={values.timezone} onChange={(e) => set("timezone", e.target.value)} required />
        </Field>
        <Field label="Computers per run" htmlFor="s-batch">
          <Input id="s-batch" type="number" min={1} max={500} value={values.batch_size} onChange={num("batch_size")} required />
        </Field>
        <Field label="Cancel run after (minutes)" htmlFor="s-grace">
          <Input id="s-grace" type="number" min={1} max={60} value={values.run_grace_minutes} onChange={num("run_grace_minutes")} required />
        </Field>
        <Field label="Daily reserve (%)" htmlFor="s-reserve">
          <Input id="s-reserve" type="number" min={0} max={90} value={values.reserve_pct} onChange={num("reserve_pct")} required />
        </Field>
        <Field label="Daily run limit" htmlFor="s-daily">
          <Input id="s-daily" type="number" min={1} max={1000} value={values.daily_run_limit} onChange={num("daily_run_limit")} required />
        </Field>
        <Field label="Active runs at once" htmlFor="s-active">
          <Input id="s-active" type="number" min={1} max={4} value={values.max_active_runs} onChange={num("max_active_runs")} required />
        </Field>
        <Field label="Runs per minute" htmlFor="s-minute">
          <Input id="s-minute" type="number" min={1} max={10} value={values.runs_per_minute} onChange={num("runs_per_minute")} required />
        </Field>
        <Field label="Query provider" htmlFor="s-provider" className="sm:col-span-2">
          <NativeSelect
            id="s-provider"
            value={values.provider}
            onChange={(v) => set("provider", v as ScanSettings["provider"])}
            options={[
              { value: "live_endpoint_search", label: "Live Endpoint Search (GraphQL)" },
              { value: "live_discover_rest", label: "Live Discover REST (legacy)" },
            ]}
          />
        </Field>
      </fieldset>
      <p className="m-0 text-xs text-text-muted">
        Last changed {formatDateTime(settings.updated_at)}. Times use the tenant time zone. Live Endpoint Search allows 1,000 runs a day per tenant; the REST API 500.
      </p>
      {!readOnly ? (
        <Button type="submit" size="sm" className="self-start" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Save schedule
        </Button>
      ) : (
        <p className="m-0 text-sm text-text-muted">Only admins can change the schedule.</p>
      )}
    </form>
  );
}
