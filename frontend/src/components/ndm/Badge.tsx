import { cn } from '@/lib/cn'

interface BadgeProps {
  label: string
  /** Tailwind text + background classes from jobBadge()/scheduleBadge(). */
  className?: string
  /** Schedule badges sit a half-step smaller than job badges. */
  size?: 'job' | 'schedule'
}

/** Uppercase status pill. Labels are authored in caps — no text-transform. */
export function NdmBadge({ label, className, size = 'job' }: BadgeProps) {
  return (
    <span
      className={cn(
        'rounded-4 shrink-0 font-semibold tracking-[0.6px]',
        size === 'job' ? 'text-95 px-[7px] py-[2.5px]' : 'text-9 px-[7px] py-[2.5px]',
        className,
      )}
    >
      {label}
    </span>
  )
}
