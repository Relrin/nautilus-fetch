import { describe, expect, it } from 'vitest'

import { tpFromRest, tpFromWs } from '@/api/normalize'
import type { ThroughputDto } from '@/api/types'
import { TP_BARS } from '@/lib/constants'

import { TpRing } from './throughput'

const restDto = (samples: { ts: number; bytes: number }[]): ThroughputDto => ({
  window_s: 600,
  source: 'live',
  samples: samples.map((s) => ({
    ts: s.ts,
    rows_per_s: 100,
    bytes_per_s: s.bytes,
    inflight: 2,
  })),
})

describe('unit normalisation', () => {
  it('converts the WebSocket mb_s to bytes using decimal megabytes', () => {
    // throughput.py divides by 1_000_000. Using 1048576 here would be 4.9% off
    // and the SPEED tile would silently disagree with the REST endpoint.
    expect(tpFromWs({ ts: 1, rows_s: 0, mb_s: 31.5 }).bytesPerSec).toBe(31_500_000)
  })

  it('passes REST bytes_per_s through unchanged', () => {
    expect(
      tpFromRest({ ts: 1, rows_per_s: 0, bytes_per_s: 31_500_000, inflight: null }).bytesPerSec,
    ).toBe(31_500_000)
  })

  it('agrees between the two sources for the same reading', () => {
    const rest = tpFromRest({ ts: 1, rows_per_s: 5, bytes_per_s: 2_400_000, inflight: 1 })
    const ws = tpFromWs({ ts: 1, rows_s: 5, mb_s: 2.4 })
    expect(ws.bytesPerSec).toBe(rest.bytesPerSec)
  })

  it('reports inflight as null for WebSocket samples rather than a fake zero', () => {
    expect(tpFromWs({ ts: 1, rows_s: 0, mb_s: 0 }).inflight).toBeNull()
  })
})

describe('TpRing', () => {
  it('always renders exactly TP_BARS bars, left-padded when short', () => {
    const ring = TpRing.seed(restDto([{ ts: 1, bytes: 1e6 }]))
    expect(ring.barHeights()).toHaveLength(TP_BARS)
  })

  it('keeps only the newest TP_BARS samples', () => {
    let ring = TpRing.empty()
    for (let i = 0; i < 50; i += 1) {
      ring = ring.push(tpFromWs({ ts: i, rows_s: 0, mb_s: i }))
    }
    expect(ring.latest()?.tsMs).toBe(49)
    expect(ring.barHeights()).toHaveLength(TP_BARS)
  })

  it('returns a new instance on push so React re-renders', () => {
    const before = TpRing.empty()
    expect(before.push(tpFromWs({ ts: 1, rows_s: 0, mb_s: 1 }))).not.toBe(before)
  })

  it('scales bar heights against the window peak', () => {
    const ring = TpRing.seed(
      restDto([
        { ts: 1, bytes: 1e6 },
        { ts: 2, bytes: 2e6 },
      ]),
    )
    const heights = ring.barHeights(32, 2)
    expect(heights.at(-1)).toBe(32) // peak
    expect(heights.at(-2)).toBe(16) // half the peak
  })

  it('falls back to the minimum height when nothing has been measured', () => {
    expect(TpRing.empty().barHeights()).toEqual(Array<number>(TP_BARS).fill(2))
    expect(TpRing.empty().hasData()).toBe(false)
  })

  it('surfaces resolution so a 5s persisted chart is not read as 1s live', () => {
    expect(TpRing.seed({ ...restDto([]), source: 'persisted' }).resolutionLabel()).toBe(
      'persisted · 5s',
    )
  })
})
