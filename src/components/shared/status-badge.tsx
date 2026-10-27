import { CircleCheck, CircleMinus, CircleSlash, Clock, Hourglass, OctagonX, Send, CalendarOff, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Scan statuses shown to users. Tasks: pending, dispatched, collected, retry_scheduled (also
// no_response), missed, error, skipped; a computer without tasks in the open cycle: not_scheduled.
export type ScanStatus = "collected" | "dispatched" | "pending" | "retry_scheduled" | "missed" | "error" | "skipped" | "not_scheduled";

const STATUS: Record<ScanStatus, { label: string; icon: LucideIcon; className: string }> = {
  collected: { label: "Collected", icon: CircleCheck, className: "bg-status-safe text-on-status" },
  dispatched: { label: "Dispatched", icon: Send, className: "bg-status-info text-on-status" },
  pending: { label: "Waiting", icon: Hourglass, className: "bg-surface-subtle text-text-strong ring-1 ring-border-subtle ring-inset" },
  retry_scheduled: { label: "Retry scheduled", icon: Clock, className: "bg-status-high text-on-status" },
  missed: { label: "Missed", icon: CircleSlash, className: "bg-slate text-dark-blue" },
  error: { label: "Error", icon: OctagonX, className: "bg-status-critical text-on-status-critical" },
  skipped: { label: "Skipped", icon: CircleMinus, className: "bg-surface-subtle text-text-muted ring-1 ring-border-subtle ring-inset" },
  not_scheduled: { label: "Not scheduled", icon: CalendarOff, className: "bg-surface-subtle text-text-muted ring-1 ring-border-subtle ring-inset" },
};

export function asScanStatus(value: string | null | undefined): ScanStatus {
  if (value === "no_response") return "retry_scheduled";
  return value && value in STATUS ? (value as ScanStatus) : "not_scheduled";
}

type StatusBadgeProps = {
  status: ScanStatus;
  // Overrides the word, e.g. "Query error". The icon always stays.
  label?: string;
  size?: "sm" | "md";
  className?: string;
};

// Status always shows a word and an icon, never colour alone.
export function StatusBadge({ status, label, size = "sm", className }: StatusBadgeProps) {
  const { label: defaultLabel, icon: Icon, className: tone } = STATUS[status];
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex w-fit items-center rounded-full font-sans leading-none font-semibold whitespace-nowrap",
        size === "sm" ? "gap-[5px] px-[9px] py-1 text-xs" : "gap-[7px] px-3 py-1.5 text-sm",
        tone,
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-[13px]" : "size-4"} aria-hidden="true" strokeWidth={2} />
      {label ?? defaultLabel}
    </span>
  );
}
