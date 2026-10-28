import { useSyncExternalStore, type ReactElement } from "react";
import type { PolicyClass } from "@policy";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CLASS_INFO } from "./classes";

// Touch screens have no hover: there the class information opens on tap (Popover) instead.
const NO_HOVER = "(hover: none)";
function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(NO_HOVER);
  media.addEventListener?.("change", onChange);
  return () => media.removeEventListener?.("change", onChange);
}
function useNoHover(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(NO_HOVER).matches : false),
    () => false,
  );
}

export function ClassInfoContent({ cls }: { cls: PolicyClass }) {
  const info = CLASS_INFO[cls];
  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex items-center gap-2">
        <span className="font-semibold text-text-strong">{info.label}</span>
        <code className="font-mono text-xs text-text-muted">{info.machineId}</code>
      </span>
      <span>{info.meaning}</span>
      <span className="text-xs text-text-muted">CIS v8.1 · {info.cis}</span>
    </span>
  );
}

// Wraps a focusable element (button or link) with the class information: on hover and keyboard
// focus (Tooltip), or on tap on touch screens (Popover; links keep their navigation).
export function ClassHint({ cls, children, link = false }: { cls: PolicyClass; children: ReactElement; link?: boolean }) {
  const noHover = useNoHover();
  if (noHover && !link) {
    return (
      <Popover>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent>
          <ClassInfoContent cls={cls} />
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>
        <ClassInfoContent cls={cls} />
      </TooltipContent>
    </Tooltip>
  );
}

export function ClassDot({ cls, className }: { cls: PolicyClass; className?: string }) {
  return <i aria-hidden="true" className={cn("inline-block size-2.5 shrink-0 rounded-full", CLASS_INFO[cls].dot, className)} />;
}

// Colour dot plus the class name (never colour alone), with the class information on hover/focus/tap.
export function ClassBadge({ cls, size = "md", hint = true }: { cls: PolicyClass | null | undefined; size?: "sm" | "md"; hint?: boolean }) {
  const pill = cn(
    "inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-page font-semibold whitespace-nowrap text-text-strong",
    size === "sm" ? "px-2 py-px text-xs" : "py-[3px] pr-2.5 pl-2 text-[13px]",
  );
  if (!cls) return <span className={cn(pill, "font-normal text-text-muted")}>Not evaluated</span>;
  const content = (
    <>
      <ClassDot cls={cls} />
      {CLASS_INFO[cls].label}
    </>
  );
  if (!hint) return <span className={pill}>{content}</span>;
  return (
    <ClassHint cls={cls}>
      <button type="button" className={cn(pill, "cursor-help focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring")}>
        {content}
      </button>
    </ClassHint>
  );
}
