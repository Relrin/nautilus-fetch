import { describe, expect, it } from 'vitest'

import {
  buildJobBody,
  buildScheduleBody,
  cronFor,
  hasForexTradeTicks,
  initialJobForm,
  resolveWhatToShow,
  validateJobForm,
  type JobFormState,
} from './jobForm'

const form = (overrides: Partial<JobFormState> = {}): JobFormState => ({
  ...initialJobForm(new Date('2026-07-21T12:00:00Z')),
  conIds: [265598],
  ...overrides,
})

const fieldsOf = (state: JobFormState) => validateJobForm(state).map((error) => error.field)

describe('validateJobForm', () => {
  it('accepts a plain bars backfill', () => {
    expect(validateJobForm(form())).toEqual([])
  })

  it('requires at least one instrument', () => {
    expect(fieldsOf(form({ conIds: [] }))).toContain('conIds')
  })

  it('requires a bar size for BARS, mirroring check_data_type_params', () => {
    expect(fieldsOf(form({ dataType: 'BARS', barSize: null }))).toContain('barSize')
    // ...and does not demand one for tick types.
    expect(fieldsOf(form({ dataType: 'TRADE_TICKS', barSize: null }))).not.toContain('barSize')
  })

  it('rejects an inverted range', () => {
    expect(fieldsOf(form({ from: '2026-07-21', to: '2026-06-21' }))).toContain('range')
  })

  it('does not ask a DEPTH recorder for a date range', () => {
    // The backend rejects `end` outright on a recorder, so requiring one here
    // would block the form on a value that must never be sent.
    const state = form({ dataType: 'DEPTH', from: '', to: '' })
    expect(fieldsOf(state)).not.toContain('range')
    expect(validateJobForm(state)).toEqual([])
  })

  it('refuses to schedule a DEPTH recorder', () => {
    // ScheduleTemplate has no DEPTH variant — recorders run continuously.
    expect(fieldsOf(form({ dataType: 'DEPTH', cadence: 'nightly' }))).toContain('cadence')
  })

  it('rejects a cron shorter than the server minimum', () => {
    expect(fieldsOf(form({ cadence: 'cron', cron: '30 2 *' }))).toContain('cron')
    expect(fieldsOf(form({ cadence: 'cron', cron: '30 2 * * 1-5' }))).not.toContain('cron')
  })

  it('clamps workers to the engine limit, not the schema limit', () => {
    // JobCreateRequest permits 16, but config.max_workers is 8 and the engine
    // silently clamps — accepting 12 here would misreport what was submitted.
    expect(fieldsOf(form({ workers: 12 }))).toContain('workers')
  })
})

describe('buildJobBody', () => {
  it('sends start and end for a backfill and no depth options', () => {
    const body = buildJobBody(form({ from: '2026-06-01', to: '2026-06-30' }))
    expect(body.start).toBe('2026-06-01T00:00:00Z')
    // End of day, so the To date the user picked is actually included.
    expect(body.end).toBe('2026-06-30T23:59:59Z')
    expect('depth_levels' in body).toBe(false)
    expect('capture_until' in body).toBe(false)
  })

  it('omits `end` entirely for DEPTH rather than sending null', () => {
    // `check_data_type_params` raises on a present `end`; a null would 422 just
    // as hard as a date. The key must be absent.
    const body = buildJobBody(form({ dataType: 'DEPTH' }))
    expect('end' in body).toBe(false)
    expect('start' in body).toBe(false)
    expect(body.depth_levels).toBe(10)
  })

  it('omits what_to_show for non-BARS jobs', () => {
    // The backend rejects it outright: "what_to_show only applies to BARS jobs".
    expect('what_to_show' in buildJobBody(form({ dataType: 'QUOTE_TICKS' }))).toBe(false)
    expect(buildJobBody(form({ dataType: 'BARS' })).what_to_show).toBe('TRADES')
  })

  it('only sends a capture window when one was enabled', () => {
    const off = buildJobBody(form({ dataType: 'DEPTH', captureWindowEnabled: false }))
    expect('capture_window' in off).toBe(false)
    const on = buildJobBody(form({ dataType: 'DEPTH', captureWindowEnabled: true }))
    expect(on.capture_window?.days).toEqual([0, 1, 2, 3, 4])
  })
})

describe('resolveWhatToShow', () => {
  it('coerces TRADES to MIDPOINT only for a fully-forex selection', () => {
    expect(resolveWhatToShow('TRADES', ['FX'])).toBe('MIDPOINT')
    expect(resolveWhatToShow('TRADES', ['FX', 'FX'])).toBe('MIDPOINT')
  })

  it('keeps TRADES for stock-only and mixed selections (backend coerces FX legs)', () => {
    expect(resolveWhatToShow('TRADES', ['STOCK'])).toBe('TRADES')
    expect(resolveWhatToShow('TRADES', ['FX', 'STOCK'])).toBe('TRADES')
    // Unknown class (rerun/prefill without lookup) is treated as non-forex.
    expect(resolveWhatToShow('TRADES', ['FX', undefined])).toBe('TRADES')
    expect(resolveWhatToShow('TRADES', [])).toBe('TRADES')
  })

  it('never overrides an explicit BID/ASK/MIDPOINT choice, even for forex', () => {
    expect(resolveWhatToShow('BID', ['FX'])).toBe('BID')
    expect(resolveWhatToShow('ASK', ['FX'])).toBe('ASK')
    expect(resolveWhatToShow('MIDPOINT', ['FX'])).toBe('MIDPOINT')
  })
})

describe('hasForexTradeTicks', () => {
  it('flags trade ticks on any forex leg, and nothing else', () => {
    expect(hasForexTradeTicks('TRADE_TICKS', ['FX'])).toBe(true)
    expect(hasForexTradeTicks('TRADE_TICKS', ['STOCK', 'FX'])).toBe(true)
    expect(hasForexTradeTicks('TRADE_TICKS', ['STOCK'])).toBe(false)
    // Forex quotes and bars are fine — only trade ticks are unavailable.
    expect(hasForexTradeTicks('QUOTE_TICKS', ['FX'])).toBe(false)
    expect(hasForexTradeTicks('BARS', ['FX'])).toBe(false)
  })
})

describe('cronFor / buildScheduleBody', () => {
  it('turns a nightly time into a cron expression', () => {
    expect(cronFor(form({ cadence: 'nightly', nightlyTime: '02:30' }))).toBe('30 2 * * *')
    expect(cronFor(form({ cadence: 'nightly', nightlyTime: '00:05' }))).toBe('5 0 * * *')
  })

  it('passes a cron expression through verbatim', () => {
    expect(cronFor(form({ cadence: 'cron', cron: ' 15 3 * * 2-6 ' }))).toBe('15 3 * * 2-6')
  })

  it('states lag and lookback explicitly so the estimate panel is not lying', () => {
    const body = buildScheduleBody(form({ cadence: 'nightly' }), 'AAPL')
    expect(body.template.lag_minutes).toBe(15)
    expect(body.template.lookback_days).toBe(7)
    expect(body.template.bar_size).toBe('1 min')
  })

  it('refuses to build a schedule for DEPTH', () => {
    expect(() => buildScheduleBody(form({ dataType: 'DEPTH' }), 'ES')).toThrow(/DEPTH/)
  })
})
