/**
 * Rolling throughput window backing the 36-bar sparkline.
 *
 * Seeded from REST, then appended from WebSocket `tp` frames. Both sources are
 * normalised to bytes/second in api/normalize.ts before they get here.
 */
import { TP_BARS } from '@/lib/constants'
import type { TpSample } from '@/api/normalize'
import { tpFromRest } from '@/api/normalize'
import type { ThroughputDto } from '@/api/types'

export class TpRing {
  private readonly samples: TpSample[]
  readonly source: ThroughputDto['source'] | null

  private constructor(samples: TpSample[], source: ThroughputDto['source'] | null) {
    this.samples = samples
    this.source = source
  }

  static empty(): TpRing {
    return new TpRing([], null)
  }

  static seed(dto: ThroughputDto): TpRing {
    return new TpRing(dto.samples.slice(-TP_BARS).map(tpFromRest), dto.source)
  }

  /** Returns a new instance — React compares by identity. */
  push(sample: TpSample): TpRing {
    const next = this.samples.concat(sample)
    if (next.length > TP_BARS) next.splice(0, next.length - TP_BARS)
    return new TpRing(next, this.source)
  }

  latest(): TpSample | null {
    return this.samples.at(-1) ?? null
  }

  peakBytesPerSec(): number {
    return this.samples.reduce((max, s) => (s.bytesPerSec > max ? s.bytesPerSec : max), 0)
  }

  isEmpty(): boolean {
    return this.samples.length === 0
  }

  /**
   * Exactly `TP_BARS` bar heights in px, left-padded with zeroes so the
   * sparkline always renders the same number of divs and never reflows.
   */
  barHeights(maxPx = 32, minPx = 2): number[] {
    const peak = this.peakBytesPerSec()
    const pad = TP_BARS - this.samples.length
    return Array.from({ length: TP_BARS }, (_, i) => {
      const sample = i < pad ? undefined : this.samples[i - pad]
      if (!sample || peak <= 0) return minPx
      return Math.max(minPx, (sample.bytesPerSec / peak) * maxPx)
    })
  }

  /** True once the ring holds a real reading, so callers can render "—". */
  hasData(): boolean {
    return this.samples.some((s) => s.bytesPerSec > 0 || s.rowsPerSec > 0)
  }

  /**
   * `persisted` samples are written every 5th tick (`throughput_persist_every`),
   * so a finished job's chart is 5s-resolution while a live one is 1s. Worth
   * showing rather than silently comparing different things.
   */
  resolutionLabel(): string {
    if (this.source === 'persisted') return 'persisted · 5s'
    if (this.source === 'live') return 'live'
    return ''
  }
}
