import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

interface SectionHeaderProps {
  children: ReactNode
  className?: string
}

/** The fixed 44px bar that tops every pane. */
export function SectionHeader({ children, className }: SectionHeaderProps) {
  return (
    <div
      className={cn(
        'border-b1 flex h-[44px] flex-none items-center gap-[10px] border-b px-[14px]',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <span className="text-125 font-semibold">{children}</span>
}
