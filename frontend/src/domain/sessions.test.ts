import { describe, expect, it } from 'vitest'

import { classifyInstrument, maySupportDepth } from './instrumentClass'
import { kindLabel } from './kind'
import { formatSessions, parseSessions } from './sessions'

describe('parseSessions', () => {
  it('reads the current IB format', () => {
    expect(parseSessions('20260721:0930-20260721:1600;20260722:CLOSED', 'US/Eastern')).toEqual({
      hours: '09:30–16:00',
      timezone: 'US/Eastern',
    })
  })

  it('reads the legacy same-day format', () => {
    expect(parseSessions('20090507:0700-1830;20090508:CLOSED')?.hours).toBe('07:00–18:30')
  })

  it('spans across comma-separated sessions within a day', () => {
    // Two sittings: the outer bounds are what the sidebar shows.
    expect(parseSessions('20090507:0700-1830,1900-2330')?.hours).toBe('07:00–23:30')
  })

  it('skips leading closed days', () => {
    expect(
      parseSessions('20260719:CLOSED;20260720:CLOSED;20260721:0930-20260721:1600')?.hours,
    ).toBe('09:30–16:00')
  })

  it('returns null rather than guessing when there is nothing usable', () => {
    expect(parseSessions(null)).toBeNull()
    expect(parseSessions('')).toBeNull()
    expect(parseSessions('20260719:CLOSED')).toBeNull()
    expect(parseSessions('garbage')).toBeNull()
  })

  it('renders an em-dash placeholder when unknown', () => {
    expect(formatSessions(null)).toBe('—')
  })
})

describe('classifyInstrument', () => {
  it('maps IB secTypes onto the sidebar classes', () => {
    expect(classifyInstrument('CASH')).toBe('FX')
    expect(classifyInstrument('STK')).toBe('STOCK')
    expect(classifyInstrument('FUT')).toBe('FUTURES')
    expect(classifyInstrument('OPT')).toBe('OPTIONS')
    expect(classifyInstrument('CRYPTO')).toBe('CRYPTO')
    expect(classifyInstrument('BOND')).toBe('OTHER')
  })

  it('needs stockType to tell an ETF from a stock', () => {
    // stockType only exists on the details endpoint, so a search-only row
    // cannot be classified as ETF. That is a known limitation, not a bug.
    expect(classifyInstrument('STK', 'ETF')).toBe('ETF')
    expect(classifyInstrument('STK', null)).toBe('STOCK')
  })

  it('flags which types could plausibly offer depth', () => {
    expect(maySupportDepth('STK')).toBe(true)
    expect(maySupportDepth('OPT')).toBe(false)
  })
})

describe('kindLabel', () => {
  it('uses the mockup shorthand where one exists', () => {
    expect(kindLabel('BARS', '1 min')).toBe('bars M1')
    expect(kindLabel('BARS', '1 day')).toBe('bars D1')
    expect(kindLabel('TRADE_TICKS')).toBe('trade ticks')
    expect(kindLabel('QUOTE_TICKS')).toBe('quotes L1')
    expect(kindLabel('DEPTH')).toBe('depth L2')
  })

  it('shows the raw IB size for the 17 sizes with no shorthand', () => {
    // Collapsing "15 mins" into "bars M1" would misreport the job.
    expect(kindLabel('BARS', '15 mins')).toBe('bars 15 mins')
    expect(kindLabel('BARS', '4 hours')).toBe('bars 4 hours')
    expect(kindLabel('BARS', '1 week')).toBe('bars 1 week')
  })
})
