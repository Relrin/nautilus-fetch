import { describe, expect, it } from 'vitest'

import type { CatalogIdentifierDto, CatalogSummaryDto } from '@/api/types'

import {
  averageFileBytes,
  catalogAxis,
  catalogDay,
  catalogRows,
  coverageBar,
  estimateAfterConsolidation,
  typeTotals,
} from './catalogView'

/** What Nautilus actually writes: ISO date, then a HYPHEN-separated time. */
const NAUTILUS_START = '2023-10-26T07-30-50-123456789Z'
const NAUTILUS_END = '2024-03-01T08-30-50-123456789Z'

describe('catalogDay', () => {
  it('extracts the day from a real Nautilus file timestamp', () => {
    // `Date.parse` returns NaN for this whole string — the hyphenated time is
    // not ISO-8601. Reading it directly silently produced an empty coverage
    // strip against every real catalog while fixtures with plain dates passed.
    expect(Number.isNaN(Date.parse(NAUTILUS_START))).toBe(true)
    expect(catalogDay(NAUTILUS_START)).toBe('2023-10-26')
  })

  it('passes a bare date through', () => {
    expect(catalogDay('2004-01-02')).toBe('2004-01-02')
  })

  it('is null for junk or absent values', () => {
    expect(catalogDay(null)).toBeNull()
    expect(catalogDay('')).toBeNull()
    expect(catalogDay('not-a-date')).toBeNull()
  })
})

describe('coverage against real Nautilus filenames', () => {
  it('produces a bar rather than an empty strip', () => {
    const rows = [row('AAPL.NASDAQ', NAUTILUS_START, NAUTILUS_END)]
    const axis = catalogAxis(rows)
    expect(axis).not.toBeNull()
    expect(new Date(axis!.minMs).getUTCFullYear()).toBe(2023)
    expect(coverageBar(rows[0]!, axis).width).toBeGreaterThan(0)
  })
})

const row = (
  identifier: string,
  start: string | null,
  end: string | null,
  bytes = 1_000,
  files = 4,
): CatalogIdentifierDto => ({ identifier, files, bytes, start, end })

const summary = (): CatalogSummaryDto => ({
  path: '/mnt/user/data/parquet',
  total_bytes: 6_000,
  classes: [
    {
      data_type: 'bar',
      identifiers: [
        row('AAPL.NASDAQ', '2004-01-02', '2026-12-31', 5_000, 23),
        row('ES.CME', '2018-01-02', '2026-12-31', 1_000, 9),
      ],
    },
    { data_type: 'trade_tick', identifiers: [row('TSLA.NASDAQ', '2026-03-01', '2026-07-28')] },
  ],
})

describe('catalogAxis', () => {
  it('spans the outermost bounds across all rows', () => {
    const axis = catalogAxis(summary().classes[0]!.identifiers)!
    expect(new Date(axis.minMs).getUTCFullYear()).toBe(2004)
    expect(new Date(axis.maxMs).getUTCFullYear()).toBe(2026)
  })

  it('is null when nothing has parseable dates', () => {
    expect(catalogAxis([])).toBeNull()
    expect(catalogAxis([row('X', null, null)])).toBeNull()
  })

  it('labels the axis with the first and last year', () => {
    const axis = catalogAxis([row('A', '2004-01-02', '2026-12-31')])!
    expect(axis.ticks.at(0)).toBe('2004')
    expect(axis.ticks.at(-1)).toBe('2026')
  })
})

describe('coverageBar', () => {
  const axis = catalogAxis([row('A', '2000-01-01', '2020-01-01')])!

  it('places a row proportionally on the shared axis', () => {
    // Second half of a 20-year axis.
    const bar = coverageBar(row('B', '2010-01-01', '2020-01-01'), axis)
    expect(bar.offset).toBeCloseTo(0.5, 2)
    expect(bar.width).toBeCloseTo(0.5, 2)
  })

  it('keeps a single-day file visible instead of rounding it away', () => {
    const bar = coverageBar(row('B', '2010-01-01', '2010-01-02'), axis)
    expect(bar.width).toBeGreaterThan(0)
  })

  it('never overflows the track', () => {
    const bar = coverageBar(row('B', '2019-12-30', '2020-01-01'), axis)
    expect(bar.offset + bar.width).toBeLessThanOrEqual(1.0001)
  })

  it('renders a full bar when the whole catalog is one instant', () => {
    // A zero-width axis must not divide by zero.
    const flat = catalogAxis([row('A', '2026-07-21', '2026-07-21')])!
    expect(coverageBar(row('A', '2026-07-21', '2026-07-21'), flat)).toEqual({
      offset: 0,
      width: 1,
    })
  })

  it('is empty when the row has no dates', () => {
    expect(coverageBar(row('B', null, null), axis)).toEqual({ offset: 0, width: 0 })
  })
})

describe('catalogRows', () => {
  it('sorts by bytes descending for size', () => {
    const { rows } = catalogRows(summary(), 'bar', 'size')
    expect(rows.map((entry) => entry.identifier)).toEqual(['AAPL.NASDAQ', 'ES.CME'])
  })

  it('sorts by earliest start ascending for date', () => {
    const { rows } = catalogRows(summary(), 'bar', 'date')
    expect(rows.map((entry) => entry.identifier)).toEqual(['AAPL.NASDAQ', 'ES.CME'])
  })

  it('shares one axis across rows so bars stay comparable', () => {
    // ES starts 14 years into a 23-year span, so it must be offset — not
    // stretched to full width like AAPL.
    const { rows } = catalogRows(summary(), 'bar', 'size')
    const [aapl, es] = rows
    expect(aapl!.offset).toBeCloseTo(0, 2)
    expect(es!.offset).toBeGreaterThan(0.5)
  })

  it('returns nothing for a type with no data', () => {
    const { rows, axis } = catalogRows(summary(), 'order_book_depth10', 'size')
    expect(rows).toEqual([])
    expect(axis).toBeNull()
  })
})

describe('typeTotals', () => {
  it('aggregates identifiers, files and bytes', () => {
    expect(typeTotals(summary(), 'bar')).toEqual({ identifiers: 2, files: 32, bytes: 6_000 })
  })

  it('reports zeroes for a type the catalog has never written', () => {
    expect(typeTotals(summary(), 'order_book_depth10')).toEqual({
      identifiers: 0,
      files: 0,
      bytes: 0,
    })
  })
})

describe('estimateAfterConsolidation', () => {
  it('never estimates fewer than one file', () => {
    expect(estimateAfterConsolidation(3)).toBe(1)
    expect(estimateAfterConsolidation(0)).toBe(1)
  })

  it('applies the stated 25:1 ratio', () => {
    expect(estimateAfterConsolidation(250)).toBe(10)
  })
})

describe('averageFileBytes', () => {
  it('does not divide by zero for an empty identifier', () => {
    expect(averageFileBytes(row('X', null, null, 0, 0))).toBe(0)
  })
})
