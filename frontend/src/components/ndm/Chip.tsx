import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

type ChipTone = 'count' | 'config' | 'track' | 'accent' | 'danger' | 'muted'

const TONES: Record<ChipTone, string> = {
  /** Count pills beside section titles. */
  count: 'bg-card border-b2 text-t2 text-10 rounded-5 border px-[7px] py-[2px]',
  /** Job/schedule configuration summary chips. */
  config: 'bg-card border-b2 text-t1b text-95 rounded-4 border px-[7px] py-[2.5px]',
  /** Inline data chips: format, cadence note. */
  track: 'bg-track border-b2 text-t1b text-95 rounded-4 border px-[6px] py-[2px]',
  accent: 'bg-acc-10 border-acc-25 text-accent text-95 rounded-4 border px-[7px] py-[2px]',
  danger: 'bg-danger/10 text-danger text-95 rounded-4 px-[6px] py-[2px]',
  /** Borderless note chip. */
  muted: 'bg-track text-t3 text-95 rounded-4 px-[6px] py-[2px]',
}

interface ChipProps {
  children: ReactNode
  tone?: ChipTone
  className?: string
  title?: string
}

export function Chip({ children, tone = 'count', className, title }: ChipProps) {
  return (
    <span
      title={title}
      className={cn('inline-flex shrink-0 items-center font-mono', TONES[tone], className)}
    >
      {children}
    </span>
  )
}
