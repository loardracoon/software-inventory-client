// Computers › row preview drawer (one click on a row). Shows the computer's summary from the list row; the full
// page opens on double click or with "Open computer".
import { Link } from "react-router";
import { Wifi, WifiOff, CircleDashed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AttentionIcons, type AttentionCategory, type VulnCounts } from "@/components/shared/attention-icons";
import { asScanStatus, StatusBadge } from "@/components/shared/status-badge";
import { SupportBadge } from "@/components/shared/support-status";
import type { ComputerRow } from "@/features/inventory/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import { label, PLATFORM_LABEL } from "@/lib/labels";

function Stat({ label: name, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-surface-subtle px-4 py-3">
      <span className="font-display text-[11px] leading-none font-semibold tracking-[0.1em] text-text-strong uppercase">{name}</span>
      <span className="font-display text-2xl leading-none text-text-strong">{formatNumber(value)}</span>
    </div>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-sm text-text-muted">{term}</dt>
      <dd className="m-0 text-sm text-text-strong">{children}</dd>
    </>
  );
}

export function ComputerDrawer({ row, onOpenChange }: { row: ComputerRow | null; onOpenChange: (open: boolean) => void }) {
  const online = row?.online;
  const OnlineIcon = online === true ? Wifi : online === false ? WifiOff : CircleDashed;
  const onlineLabel = online === true ? "Online" : online === false ? "Offline" : "Status unknown";
  return (
    <Sheet open={row !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        {row ? (
          <>
            <SheetHeader className="border-b border-border-subtle">
              <span className="font-display text-xs font-semibold tracking-[0.1em] text-text-brand uppercase">
                {label(PLATFORM_LABEL, row.platform)}
              </span>
              <SheetTitle className="font-display text-2xl font-normal text-text-strong">{row.hostname}</SheetTitle>
              <SheetDescription>{[row.os_name, row.os_version].filter(Boolean).join(" ") || "Operating system unknown"}</SheetDescription>
              <div className="flex flex-wrap items-center gap-3 pt-2 text-sm text-text-strong">
                <span className="inline-flex items-center gap-1.5">
                  <OnlineIcon aria-hidden="true" className={online === true ? "size-4 text-status-safe" : "size-4 text-text-muted"} />
                  {onlineLabel} in Sophos Central
                </span>
                <StatusBadge status={asScanStatus(row.cycle_status)} label={row.cycle_status === "error" ? "Query error" : undefined} />
              </div>
            </SheetHeader>

            <div className="flex flex-col gap-6 p-4">
              {row.cycle_status === "error" && row.last_error ? (
                <p className="m-0 rounded-md bg-alert-red/14 p-3 text-sm text-text-strong">{row.last_error}</p>
              ) : null}
              {row.cycle_status === "retry_scheduled" && row.next_attempt_at ? (
                <p className="m-0 text-sm text-text-muted">Next attempt {formatDateTime(row.next_attempt_at)}</p>
              ) : null}

              <div className="grid grid-cols-3 gap-2">
                <Stat label="Programs" value={row.programs ?? 0} />
                <Stat label="Extensions" value={row.extensions ?? 0} />
                <Stat label="Packages" value={row.packages ?? 0} />
              </div>

              <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-3">
                <Fact term="User">{row.user_masked ? "Hidden" : (row.associated_user ?? "—")}</Fact>
                <Fact term="Last seen">{row.last_seen_at ? formatDateTime(row.last_seen_at) : "Never"}</Fact>
                <Fact term="Last collected">{row.last_collected_at ? formatDateTime(row.last_collected_at) : "Never"}</Fact>
                <Fact term="Coverage">
                  {row.coverage_status === "never"
                    ? "Never inventoried"
                    : row.inventoried_at
                      ? `${row.coverage_status === "stale" ? "Stale" : "Current"} · ${formatDateTime(row.inventoried_at)}`
                      : "—"}
                </Fact>
                <Fact term="Last patch">
                  <span className="inline-flex items-center gap-2">
                    {row.last_patch_at ?? "—"}
                    {row.patch_status === "stale" ? <span className="text-text-critical">Stale</span> : null}
                  </span>
                </Fact>
                <Fact term="OS support">
                  <SupportBadge status={row.os_eol_status} from={row.os_eol_from} />
                </Fact>
                <Fact term="Owner">{row.owner ?? "—"}</Fact>
                <Fact term="Criticality">{row.criticality ?? "—"}</Fact>
                <Fact term="Scope">{row.scope_tags?.length ? row.scope_tags.join(", ") : "—"}</Fact>
              </dl>

              <div className="flex flex-col gap-2">
                <span className="font-display text-xs font-semibold tracking-[0.1em] text-text-strong uppercase">Attention</span>
                <AttentionIcons
                  scope="computer"
                  categories={(row.attention as unknown as AttentionCategory[]) ?? []}
                  vulns={row.vulns as unknown as VulnCounts | null}
                />
              </div>
            </div>

            <SheetFooter className="border-t border-border-subtle">
              <Button asChild>
                <Link to={`/computers/${row.id}`}>Open computer</Link>
              </Button>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
