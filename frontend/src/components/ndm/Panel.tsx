import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

import { Eyebrow } from './Eyebrow'

interface PanelProps {
  children: ReactNode
  /** Rendered as a micro eyebrow in the panel's header row. */
  title?: string
  /** Right-aligned caption beside the title. */
  caption?: ReactNode
  /** Red-tinted variant for the failures panel. */
  tone?: 'default' | 'danger'
  className?: string
  /** Override the header's bottom margin; OUTPUT sits a pixel tighter. */
  headerClassName?: string
}

/** The inspector's sub-panel: a bordered block on the panel surface. */
export function Panel({
  children,
  title,
  caption,
  tone = 'default',
  className,
  headerClassName,
}: PanelProps) {
  return (
    <section
      className={cn(
        'rounded-8 border px-[12px] py-[10px]',
        tone === 'danger' ? 'border-danger/25 bg-danger/5' : 'border-b1 bg-panel',
        className,
      )}
    >
      {(title || caption) && (
        <header
          className={cn('mb-[8px] flex items-baseline justify-between gap-[8px]', headerClassName)}
        >
          {title ? (
            <Eyebrow className={tone === 'danger' ? 'text-danger' : ''}>{title}</Eyebrow>
          ) : (
            <span />
          )}
          {caption ? <span className="text-t3 text-95 font-mono">{caption}</span> : null}
        </header>
      )}
      {children}
    </section>
  )
}
