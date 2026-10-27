import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, CircleAlert, CircleCheck, CircleDashed, CircleHelp, Loader2, Radar, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Eyebrow } from "@/components/shared/eyebrow";
import { useAuth } from "@/features/auth/auth-context";
import { useTenant } from "@/features/tenants/tenant-context";
import { formatDateTime } from "@/lib/format";
import { fetchLatestProbes, fetchQueryStatus, runProbe, type Platform, type ProbeRow, type QueryStatusRow } from "./queries";

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "windows", label: "Windows" },
  { id: "macos", label: "macOS" },
  { id: "linux", label: "Linux" },
];

const POLL_EVERY_MS = 15_000;
const POLL_FOR_MS = 15 * 60_000;

type Loaded = { queries: QueryStatusRow[]; probes: ProbeRow[] };

// Settings › Queries: the versioned osquery catalog (read-only; it changes only by migration) and the
// capability probe that tells which queries each tenant's agents can run.
export function QueriesCard() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const { selectedTenantId } = useTenant();
  const [loaded, setLoaded] = useState<{ key: string; data: Loaded | null; error: string | null } | null>(null);
  const [version, setVersion] = useState(0);
  const [probing, setProbing] = useState(false);
  const pollUntil = useRef(0);
  const requestKey = `${selectedTenantId ?? "all"}:${version}`;

  useEffect(() => {
    let active = true;
    Promise.all([fetchQueryStatus(selectedTenantId), fetchLatestProbes(selectedTenantId)])
      .then(([queries, probes]) => active && setLoaded({ key: requestKey, data: { queries, probes }, error: null }))
      .catch((error: Error) => active && setLoaded({ key: requestKey, data: null, error: error.message }));
    return () => {
      active = false;
    };
  }, [selectedTenantId, requestKey]);

  const data = loaded?.data ?? null;
  const running = (data?.probes ?? []).some((p) => p.status === "running");

  const call = useCallback(async (action: "start" | "poll", quiet = false) => {
    setProbing(true);
    try {
      const result = await runProbe(action);
      const noneOnline = result.noneOnline ?? [];
      if (result.error) toast.error(result.error);
      else if (!quiet && !(action === "start" && result.started === 0 && noneOnline.length > 0)) {
        toast.success(
          action === "start"
            ? `Probe started on ${result.started} platform${result.started === 1 ? "" : "s"}`
            : `${result.succeeded} finished · ${result.running} still running`,
        );
      }
      if (noneOnline.length > 0) toast.info(`No computer online, probe not started: ${noneOnline.join(", ")}. Try again when one is on.`);
      if (result.fellBackToRest) toast.info("Live Endpoint Search URL is not set: the probe used the Live Discover REST API.");
      for (const message of result.errors) toast.error(message);
      if (action === "start") pollUntil.current = Date.now() + POLL_FOR_MS;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not run the probe");
    } finally {
      setProbing(false);
      setVersion((v) => v + 1);
    }
  }, []);

  // While probes run, advance them every 15 s for up to 15 minutes after "Probe again".
  useEffect(() => {
    if (!isAdmin || !running || probing || Date.now() > pollUntil.current) return;
    const timer = setTimeout(() => void call("poll", true), POLL_EVERY_MS);
    return () => clearTimeout(timer);
  }, [isAdmin, running, probing, call, version]);

  const rows = groupByQuery(data?.queries ?? []);

  return (
    <Card className="gap-5 px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Eyebrow>osquery</Eyebrow>
          <h2 className="m-0 text-xl">Queries</h2>
        </div>
        {isAdmin ? (
          <div className="flex flex-wrap gap-3">
            {running ? (
              <Button variant="secondary" size="sm" onClick={() => void call("poll")} disabled={probing}>
                Check now
              </Button>
            ) : null}
            <Button size="sm" onClick={() => void call("start")} disabled={probing}>
              {probing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Radar aria-hidden="true" />}
              Probe again
            </Button>
          </div>
        ) : null}
      </div>
      <p className="m-0 text-sm text-text-muted">
        The inventory queries in use, one per domain and platform. The probe lists the osquery tables on the most recently
        seen computer of each platform that is online now (offline computers are never probed); a query whose tables are
        missing is skipped there.
      </p>

      {loaded?.error ? (
        <p role="alert" className="m-0 text-sm text-text-critical">
          {loaded.error}
        </p>
      ) : null}
      {!data && !loaded?.error ? <Skeleton className="h-40 w-full" /> : null}

      {data ? <ProbeList probes={data.probes} /> : null}

      {data ? (
        <div className="overflow-hidden rounded-lg border border-border-subtle">
          <Table aria-label="Query catalog">
            <TableHeader>
              <TableRow>
                <TableHead>Query</TableHead>
                <TableHead>Version</TableHead>
                {PLATFORMS.map((p) => (
                  <TableHead key={p.id}>{p.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.name}:${row.version}`}>
                  <TableCell className="font-mono text-[13px]">{row.name}</TableCell>
                  <TableCell>v{row.version}</TableCell>
                  {PLATFORMS.map((p) => (
                    <TableCell key={p.id} className="align-top">
                      <QueryStatusCell row={row.byPlatform.get(p.id)} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </Card>
  );
}

function groupByQuery(queries: QueryStatusRow[]) {
  const rows = new Map<string, { name: string; version: number; byPlatform: Map<Platform, QueryStatusRow> }>();
  for (const q of queries) {
    const key = `${q.name}:${q.version}`;
    const row = rows.get(key) ?? { name: q.name, version: q.version, byPlatform: new Map() };
    row.byPlatform.set(q.platform, q);
    rows.set(key, row);
  }
  return [...rows.values()];
}

// Word + icon for every state, never colour alone.
export function QueryStatusCell({ row }: { row: QueryStatusRow | undefined }) {
  if (!row) return <span className="text-text-muted">—</span>;
  if (!row.enabled) {
    return (
      <Badge color="slate" soft>
        <Ban aria-hidden="true" />
        Disabled
      </Badge>
    );
  }
  const counted = row.tenants_ok + row.tenants_missing + row.tenants_not_probed;
  if (counted === 0) return <span className="text-xs text-text-muted">No computers</span>;
  if (row.tenants_missing > 0) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Badge color="high" soft>
          <CircleAlert aria-hidden="true" />
          Missing tables
        </Badge>
        <span className="font-mono text-xs text-text-muted">{row.missing_tables.join(", ")}</span>
        {counted > 1 ? <span className="text-xs text-text-muted">{row.tenants_missing} of {counted} tenants</span> : null}
      </div>
    );
  }
  if (row.tenants_not_probed > 0) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Badge color="medium" soft>
          <CircleHelp aria-hidden="true" />
          Not probed
        </Badge>
        {row.tenants_ok > 0 ? <span className="text-xs text-text-muted">{row.tenants_not_probed} of {counted} tenants</span> : null}
      </div>
    );
  }
  return (
    <Badge color="safe" soft>
      <CircleCheck aria-hidden="true" />
      OK
    </Badge>
  );
}

const PROBE_STATUS: Record<string, { label: string; color: "info" | "safe" | "critical" | "medium"; icon: typeof CircleCheck }> = {
  running: { label: "Running", color: "info", icon: CircleDashed },
  succeeded: { label: "Succeeded", color: "safe", icon: CircleCheck },
  failed: { label: "Failed", color: "critical", icon: CircleAlert },
  no_response: { label: "No response", color: "medium", icon: WifiOff },
};

function ProbeList({ probes }: { probes: ProbeRow[] }) {
  if (probes.length === 0) {
    return <p className="m-0 text-sm text-text-muted">No probe has run yet.</p>;
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Latest probes">
      {probes.map((probe) => {
        const status = PROBE_STATUS[probe.status ?? ""] ?? PROBE_STATUS.failed;
        const Icon = status.icon;
        const platform = PLATFORMS.find((p) => p.id === probe.platform)?.label ?? probe.platform;
        return (
          <li key={probe.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <Badge color={status.color} soft>
              <Icon aria-hidden="true" className={probe.status === "running" ? "animate-spin" : undefined} />
              {status.label}
            </Badge>
            <span className="text-text-strong">
              {probe.tenant_name} · {platform}
            </span>
            <span className="text-text-muted">
              {probe.hostname}
              {probe.table_count ? ` · ${probe.table_count} tables` : ""}
              {probe.started_at ? ` · ${formatDateTime(probe.started_at)}` : ""}
            </span>
            {probe.error ? <span className="w-full text-xs text-text-muted">{probe.error}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
