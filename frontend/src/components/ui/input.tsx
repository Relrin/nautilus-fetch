import * as React from "react"

import { cn } from "@/lib/cn"

/**
 * `font-mono` lives here, not at the call sites: in this design EVERY form
 * input is Geist Mono, and putting it in the primitive means nothing can
 * forget it.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "bg-panel border-b2 text-t1 rounded-8 text-11 placeholder:text-t3 w-full min-w-0 border px-[10px] py-[7px] font-mono outline-none",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-danger/45",
        className
      )}
      {...props}
    />
  )
}

export { Input }
