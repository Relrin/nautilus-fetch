import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/cn"

/**
 * Restyled onto the ndm scale. shadcn's stock sizes (h-9, text-sm, rounded-md)
 * are all wrong for this mockup, so the variant table is replaced wholesale
 * rather than overridden per call site.
 *
 *   primary   28px toolbar accent button
 *   primaryLg 30px accent button (modal footers, sidebar CTA)
 *   outline   30px bordered secondary
 *   outlineSm 24px bordered secondary (row actions)
 *   danger    23px danger outline ("Retry failed")
 *   dangerLg  full-width danger outline (inspector)
 *   ghost     24px icon button
 */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-[6px] whitespace-nowrap outline-none transition-colors disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-ink hover:bg-accent-hov border-none font-semibold",
        outline:
          "border-b2 text-t1b hover:border-b3 hover:text-t1 border bg-transparent font-medium",
        danger:
          "border-danger/40 text-danger hover:bg-danger/10 border bg-transparent font-medium",
        ghost: "text-t1b hover:bg-b1 hover:text-t1 border-none bg-transparent",
        ghostDanger:
          "text-t1b hover:bg-danger/12 hover:text-danger border-none bg-transparent",
      },
      size: {
        sm: "text-115 h-[28px] rounded-7 px-[12px]",
        md: "text-115 h-[30px] rounded-7 px-[14px]",
        xs: "text-105 h-[24px] rounded-6 px-[9px]",
        tiny: "text-10 h-[23px] rounded-6 gap-[5px] px-[9px]",
        block: "text-115 h-[30px] rounded-7 w-full px-[14px]",
        blockSm: "text-105 h-[27px] rounded-6 w-full px-[10px] font-semibold",
        icon: "size-[24px] rounded-6",
        iconLg: "size-[26px] rounded-7",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "sm",
    },
  }
)

function Button({
  className,
  variant = "primary",
  size = "sm",
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
