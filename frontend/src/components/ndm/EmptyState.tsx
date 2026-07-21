import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  body?: ReactNode
  action?: ReactNode
  /** `card` is the large dashed panel; `inline` the small one-liner. */
  variant?: 'card' | 'inline'
  className?: string
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  variant = 'card',
  className,
}: EmptyStateProps) {
  if (variant === 'inline') {
    return (
      <div
        className={cn(
          'border-b1 rounded-10 text-t3 text-11 border border-dashed p-[18px] text-center',
          className,
        )}
      >
        {title}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'border-b2 rounded-12 border border-dashed px-[20px] py-[36px] text-center',
        className,
      )}
    >
      {icon}
      <div className="text-13 mt-[10px] mb-[4px] font-semibold">{title}</div>
      {body ? (
        <div className="text-t2 text-115 mx-auto mb-[16px] max-w-[400px] leading-[1.5]">{body}</div>
      ) : null}
      {action}
    </div>
  )
}

/** Centred placeholder for an aside with nothing selected. */
export function PaneEmptyState({
  icon,
  title,
  body,
}: {
  icon?: ReactNode
  title: string
  body?: string
}) {
  return (
    <div className="text-t3 flex flex-1 flex-col items-center justify-center gap-[8px] p-[24px] text-center">
      {icon}
      <div className="text-t2 text-115">{title}</div>
      {body ? <div className="text-105 max-w-[200px] leading-[1.5]">{body}</div> : null}
    </div>
  )
}
