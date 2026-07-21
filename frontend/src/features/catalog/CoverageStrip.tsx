import { cn } from '@/lib/cn'

interface CoverageStripProps {
  offset: number
  width: number
  height?: number
  className?: string
}

/**
 * One identifier's extent on the shared axis.
 *
 * Extent, **not** continuity. `/api/catalog/summary` reports only outer bounds
 * parsed from filenames, so a solid bar means "data exists between these two
 * dates", never "every session in between is present". Closed-session gaps are
 * normal for market data, and drawing them as breaks would read as damage.
 */
export function CoverageStrip({ offset, width, height = 8, className }: CoverageStripProps) {
  return (
    <div
      className={cn('bg-track relative overflow-hidden rounded-[3px]', className)}
      style={{ height }}
    >
      {width > 0 && (
        <div
          className="bg-accent absolute top-0 bottom-0 rounded-[3px] opacity-70"
          style={{ left: `${(offset * 100).toFixed(3)}%`, width: `${(width * 100).toFixed(3)}%` }}
        />
      )}
    </div>
  )
}
