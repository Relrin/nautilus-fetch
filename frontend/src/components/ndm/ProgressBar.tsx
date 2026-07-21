import { cn } from '@/lib/cn'

interface ProgressBarProps {
  /** Settled fraction, 0..1. Always derive this — never read `job.progress`. */
  value: number
  /** Failed fraction, 0..1, drawn as a red segment after the fill. */
  failed?: number
  /** 6px on job cards, 8px in the inspector. */
  size?: 'card' | 'inspector'
  /** Paused jobs grey out; completed ones go green. */
  tone?: 'active' | 'paused' | 'done'
  className?: string
}

const FILL: Record<NonNullable<ProgressBarProps['tone']>, string> = {
  active: 'bg-accent',
  paused: 'bg-t2',
  done: 'bg-success',
}

export function ProgressBar({
  value,
  failed = 0,
  size = 'card',
  tone = 'active',
  className,
}: ProgressBarProps) {
  const inspector = size === 'inspector'
  const radius = inspector ? 'rounded-5' : 'rounded-4'
  // Clamp so a rounding error can never push the bar past its track.
  const fill = Math.max(0, Math.min(1, value))
  const fail = Math.max(0, Math.min(1 - fill, failed))

  return (
    <div
      className={cn(
        'bg-track flex overflow-hidden',
        radius,
        inspector ? 'h-[8px]' : 'h-[6px]',
        className,
      )}
    >
      <div
        className={cn('transition-[width] duration-[450ms] ease-linear', radius, FILL[tone])}
        style={{ width: `${(fill * 100).toFixed(2)}%` }}
      />
      {fail > 0 && (
        <div
          className="bg-danger/85 transition-[width] duration-[450ms] ease-linear"
          style={{ width: `${(fail * 100).toFixed(2)}%` }}
        />
      )}
    </div>
  )
}

/**
 * Open-ended activity indicator for DEPTH recorders.
 *
 * A recorder has no meaningful percentage — its `progress` pins to 1.0 as soon
 * as the first buffer flushes — so it gets a sweep rather than a fill.
 */
export function IndeterminateBar({ paused = false }: { paused?: boolean }) {
  return (
    <div className="bg-track rounded-4 h-[6px] overflow-hidden">
      <div
        className={cn('rounded-4 h-full w-1/3', paused ? 'bg-t2' : 'bg-accent animate-ndm-sweep')}
      />
    </div>
  )
}
