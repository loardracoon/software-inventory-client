import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// Sophos DS 2026 CTA: full pill, Zalando Sans semibold, 2px stroke, sentence case.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full border-2 border-transparent font-sans font-semibold leading-none whitespace-nowrap transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border-action bg-action text-on-action hover:border-action-hover hover:bg-action-hover",
        secondary: "border-text-brand bg-transparent text-text-brand hover:bg-surface-subtle",
        destructive: "border-status-critical bg-status-critical text-on-status-critical hover:opacity-90",
        outline: "border-border-subtle bg-surface-raised text-text-strong hover:bg-surface-subtle",
        ghost: "bg-transparent text-text-brand hover:bg-surface-subtle",
        link: "border-0 text-text-brand underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[45px] px-7 text-sm has-[>svg]:px-6",
        xs: "h-7 gap-1 px-3 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1.5 px-[18px] text-[13px] has-[>svg]:px-4",
        lg: "h-[52px] px-8 text-base",
        icon: "size-10",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
