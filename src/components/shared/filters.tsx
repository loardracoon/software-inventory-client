import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// DS tag used as a toggle chip (category filters). aria-pressed carries the state.
export function FilterChip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-9 items-center gap-2 rounded-sm border px-3 text-[13px] leading-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
        pressed ? "border-action bg-action text-on-action" : "border-border-control bg-surface-raised text-text-body hover:bg-surface-subtle",
      )}
    >
      {children}
    </button>
  );
}

// Label above, control below (DS fields).
export function Field({ label, htmlFor, children, className }: { label: string; htmlFor: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-semibold text-text-strong">
        {label}
      </label>
      {children}
    </div>
  );
}

const CONTROL =
  "h-10 w-full min-w-0 rounded-sm border-[1.5px] border-input bg-surface-raised px-3 text-[15px] text-text-body focus-visible:border-action focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-page focus-visible:outline-none";

export function NativeSelect({
  id,
  value,
  onChange,
  options,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select id={id} className={CONTROL} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function DateInput({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return <input id={id} type="date" className={CONTROL} value={value} onChange={(event) => onChange(event.target.value)} />;
}
