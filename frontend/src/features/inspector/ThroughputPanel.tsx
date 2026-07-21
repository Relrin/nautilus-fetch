import { Panel } from '@/components/ndm/Panel'
import type { TpRing } from '@/domain/throughput'
import { cn } from '@/lib/cn'
import { TP_BARS } from '@/lib/constants'
import { fmtRate } from '@/lib/format'

const FLAT = Array.from({ length: TP_BARS }, () => 2)

/**
 * The 36-bar sparkline.
 *
 * Plain divs rather than an SVG or a chart library: 36 fixed-position bars
 * animating their height is exactly what CSS transitions are for, and a
 * dependency here would be an order of magnitude more code than the thing it
 * draws.
 */
export function ThroughputPanel({ ring }: { ring: TpRing | undefined }) {
  const heights = ring?.barHeights() ?? FLAT
  const peak = ring?.peakBytesPerSec() ?? 0
  const hasData = ring?.hasData() ?? false

  const resolution = ring?.resolutionLabel() ?? ''
  const caption = hasData
    ? [`peak ${fmtRate(peak)}`, resolution].filter(Boolean).join(' · ')
    : 'no samples yet'

  return (
    <Panel title="THROUGHPUT" caption={caption}>
      <div className="flex h-[34px] items-end gap-[2px]">
        {heights.map((height, index) => (
          <div
            key={index}
            className={cn(
              'flex-1 rounded-[1.5px] transition-[height] duration-300 ease-out',
              // The newest reading is the one the eye should land on.
              index === heights.length - 1 && hasData ? 'bg-accent' : 'bg-acc-40',
            )}
            style={{ height: `${height}px` }}
          />
        ))}
      </div>
    </Panel>
  )
}
