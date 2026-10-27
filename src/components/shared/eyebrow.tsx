import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type EyebrowProps = {
  children: ReactNode;
  tone?: "default" | "brand" | "muted";
  tick?: boolean;
  className?: string;
};

// DS eyebrow: Zalando Sans Expanded semibold, all caps, tracking 0.1em; `tick` adds the brand tick.
export function Eyebrow({ children, tone = "default", tick = false, className }: EyebrowProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2.5 font-display text-xs leading-none font-semibold tracking-[0.1em] uppercase",
        tone === "brand" && "text-text-brand",
        tone === "default" && "text-text-strong",
        tone === "muted" && "text-text-muted",
        tick && "before:h-0.5 before:w-5 before:bg-current before:content-['']",
        className,
      )}
    >
      {children}
    </span>
  );
}
