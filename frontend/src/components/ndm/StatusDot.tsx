import { cn } from '@/lib/cn'

interface StatusDotProps {
  /** A CSS colour, usually a `var(--ndm-*)` or semantic hex. */
  color: string
  pulse?: boolean
  size?: number
  className?: string
}

export function StatusDot({ color, pulse = false, size = 7, className }: StatusDotProps) {
  return (
    <span
      className={cn('shrink-0 rounded-full', pulse && 'animate-ndm-pulse', className)}
      style={{ width: size, height: size, background: color }}
    />
  )
}
