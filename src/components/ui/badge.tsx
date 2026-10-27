import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// Sophos DS 2026 badge colours. `soft` gives a tinted background with strong text.
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-[5px] overflow-hidden rounded-full px-2.5 py-[5px] font-sans text-xs leading-none font-semibold whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      color: {
        blue: "bg-sophos-blue text-white",
        dark: "bg-dark-blue text-white ring-1 ring-border-subtle ring-inset",
        cyber: "bg-cyber-blue text-dark-blue",
        green: "bg-cyber-green text-dark-blue",
        slate: "bg-slate text-dark-blue",
        critical: "bg-status-critical text-on-status-critical",
        high: "bg-status-high text-on-status",
        medium: "bg-status-medium text-on-status",
        low: "bg-status-low text-on-status",
        safe: "bg-status-safe text-on-status",
        info: "bg-status-info text-on-status",
      },
      soft: {
        true: "text-text-strong ring-1 ring-border-subtle ring-inset",
        false: "",
      },
    },
    compoundVariants: [
      { soft: true, color: "blue", className: "bg-sophos-blue/12" },
      { soft: true, color: "dark", className: "bg-dark-blue/10" },
      { soft: true, color: "cyber", className: "bg-cyber-blue/22" },
      { soft: true, color: "green", className: "bg-cyber-green/22" },
      { soft: true, color: "slate", className: "bg-slate/16" },
      { soft: true, color: "critical", className: "bg-alert-red/14" },
      { soft: true, color: "high", className: "bg-alert-orange/22" },
      { soft: true, color: "medium", className: "bg-alert-yellow/30" },
      { soft: true, color: "low", className: "bg-alert-lime/30" },
      { soft: true, color: "safe", className: "bg-alert-green/22" },
      { soft: true, color: "info", className: "bg-sky-blue/18" },
    ],
    defaultVariants: {
      color: "slate",
      soft: false,
    },
  }
)

function Badge({
  className,
  color,
  soft,
  asChild = false,
  ...props
}: Omit<React.ComponentProps<"span">, "color"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ color, soft }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
