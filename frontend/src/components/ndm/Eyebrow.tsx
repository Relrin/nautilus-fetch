import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

interface EyebrowProps {
  children: ReactNode
  /** `pane` heads a whole column (INSPECTOR); `micro` labels a field or panel. */
  variant?: 'pane' | 'micro'
  className?: string
}

/** Uppercase micro-label. Strings are authored in caps, matching the mockup. */
export function Eyebrow({ children, variant = 'micro', className }: EyebrowProps) {
  return (
    <span
      className={cn(
        'font-semibold',
        variant === 'pane' ? 'text-95 text-t2 tracking-[1.4px]' : 'text-85 text-t3 tracking-[1px]',
        className,
      )}
    >
      {children}
    </span>
  )
}

interface DividerLabelProps {
  children: ReactNode
  className?: string
}

/** A micro label followed by a hairline rule, e.g. `RUN HISTORY ─────`. */
export function DividerLabel({ children, className }: DividerLabelProps) {
  return (
    <div className={cn('flex items-center gap-[8px]', className)}>
      <Eyebrow>{children}</Eyebrow>
      <div className="bg-b1 h-px flex-1" />
    </div>
  )
}
