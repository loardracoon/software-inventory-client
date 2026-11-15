import { cn } from "@/lib/utils";

export type SupportStatus = "supported" | "ending_soon" | "eol";

export const SUPPORT_FILTERS = [
  { value: "", label: "All" },
  { value: "eol", label: "End of life" },
  { value: "ending_soon", label: "Ends within 90 days" },
  { value: "supported", label: "Supported" },
] as const;

export type SupportFilter = (typeof SUPPORT_FILTERS)[number]["value"];
export const supportFromParam = (v: string | null): SupportFilter => (SUPPORT_FILTERS.some((f) => f.value === v) ? (v as SupportFilter) : "");

// End-of-life status of a software version or an operating system (Stage 3). Supported and unknown show nothing: the
// screens flag what needs attention only.
export function SupportBadge({ status, from, className }: { status: string | null | undefined; from?: string | null; className?: string }) {
  if (status === "eol") {
    return (
      <span className={cn("flex flex-col text-xs", className)}>
        <span className="font-semibold text-text-critical">End of life</span>
        {from ? <span className="text-text-muted">since {from}</span> : null}
      </span>
    );
  }
  if (status === "ending_soon") {
    return <span className={cn("text-xs font-semibold text-text-warning", className)}>Ends {from ?? "soon"}</span>;
  }
  return null;
}
