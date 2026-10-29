import { useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Touch screens have no hover: there the details open on tap (Popover) instead.
const NO_HOVER = "(hover: none)";
function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(NO_HOVER);
  media.addEventListener?.("change", onChange);
  return () => media.removeEventListener?.("change", onChange);
}

export function useNoHover(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(NO_HOVER).matches : false),
    () => false,
  );
}

// Wraps a focusable element (button or link) with details: on hover and keyboard focus (Tooltip), or
// on tap on touch screens (Popover; links keep their navigation).
export function Hint({ content, children, link = false }: { content: ReactNode; children: ReactElement; link?: boolean }) {
  const noHover = useNoHover();
  if (noHover && !link) {
    return (
      <Popover>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent>{content}</PopoverContent>
      </Popover>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{content}</TooltipContent>
    </Tooltip>
  );
}
