import { cn } from '@/lib/cn'

interface StatTileProps {
  /** Authored in caps: CHUNKS, FAILED, DOWNLOADED, ... */
  label: string
  value: string
  /** Secondary line, for a value that will not fit beside its context. */
  sub?: string
  /** Failed counts turn red once non-zero. */
  tone?: 'default' | 'danger'
  title?: string
}

/**
 * A tile is one third of a 344px column — about 76px of content.
 *
 * Anything containing a space wraps at that width: `12,432 / 12,480` becomes
 * two lines and makes its row taller than the two beside it. So values never
 * wrap; the font steps down for longer strings instead, and only once the
 * ladder bottoms out can it ellipsise — with the full text on hover, so a
 * number is never silently shown half.
 */
/**
 * Measured, not guessed: 74px of content fits ~10 mono characters at 11.5px,
 * ~11 at 10.5px and ~12 at 9.5px.
 */
const LONG = 10
const VERY_LONG = 11

const sizeFor = (value: string): string =>
  value.length > VERY_LONG ? 'text-95' : value.length > LONG ? 'text-105' : 'text-115'

export function StatTile({ label, value, sub, tone = 'default', title }: StatTileProps) {
  return (
    <div
      className="border-b1 bg-panel rounded-8 overflow-hidden border px-[10px] py-[8px]"
      title={title}
    >
      <div className="text-t3 text-8 mb-[3px] truncate font-semibold tracking-[1px]">{label}</div>
      <div
        // `truncate` carries whitespace-nowrap, so the shrink ladder is what
        // actually keeps long values readable rather than clipped.
        className={cn(
          'truncate font-mono',
          sizeFor(value),
          tone === 'danger' ? 'text-danger' : 'text-t1',
        )}
        // Only once the ladder has bottomed out and clipping is possible —
        // otherwise this would shadow the tile's explanatory tooltip.
        {...(value.length > VERY_LONG ? { title: value } : {})}
      >
        {value}
      </div>
      {sub ? <div className="text-t3 text-85 truncate font-mono">{sub}</div> : null}
    </div>
  )
}
