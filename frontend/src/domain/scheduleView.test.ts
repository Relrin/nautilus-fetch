import { describe, expect, it } from 'vitest'

import type { JobDto, ScheduleDto } from '@/api/types'
import type { JobState } from '@/api/enums'

import {
  lastRunTone,
  scheduleBadge,
  scheduleBroken,
  scheduleJobs,
  symbolSummary,
  symbolsForConIds,
  templateSummary,
} from './scheduleView'

const job = (id: string, state: JobState, createdAt: number, scheduleId = 'S1'): JobDto =>
  ({
    id,
    name: id,
    state,
    data_type: 'BARS',
    schedule_id: scheduleId,
    symbols: [],
    con_ids: [],
    params: {},
    workers: 4,
    max_retries: 3,
    range_start: null,
    range_end: null,
    total_chunks: 1,
    done_chunks: 1,
    empty_chunks: 0,
    failed_chunks: 0,
    progress: 1,
    rows_written: 0,
    bytes_written: 0,
    error: null,
    created_at: createdAt,
    updated_at: createdAt,
    started_at: createdAt,
    finished_at: createdAt,
  }) satisfies JobDto

const schedule = (overrides: Partial<ScheduleDto> = {}): ScheduleDto => ({
  id: 'S1',
  name: 'nightly bars',
  cron: '30 2 * * 1-5',
  enabled: true,
  catchup: false,
  template: {
    con_ids: [1, 2],
    data_type: 'BARS',
    bar_size: '1 min',
    what_to_show: 'TRADES',
    use_rth: true,
    workers: 6,
    max_retries: 3,
    lag_minutes: 30,
    lookback_days: 7,
  },
  last_run_at: null,
  next_run_at: null,
  ...overrides,
})

describe('scheduleJobs', () => {
  it('keeps only this schedule’s jobs, newest first', () => {
    const jobs = [
      job('a', 'completed', 100),
      job('b', 'completed', 300),
      job('other', 'completed', 200, 'S2'),
      job('c', 'completed', 200),
    ]
    expect(scheduleJobs(jobs, 'S1').map((entry) => entry.id)).toEqual(['b', 'c', 'a'])
  })

  it('survives an undefined job list', () => {
    expect(scheduleJobs(undefined, 'S1')).toEqual([])
  })
})

describe('scheduleBroken', () => {
  it('is false when the newest finished run completed cleanly', () => {
    expect(scheduleBroken([job('a', 'completed', 200), job('b', 'failed', 100)])).toBe(false)
  })

  it('is true when the newest finished run had failures', () => {
    expect(scheduleBroken([job('a', 'completed_with_failures', 200)])).toBe(true)
    expect(scheduleBroken([job('a', 'failed', 200)])).toBe(true)
  })

  it('ignores a run still in flight and judges the last finished one', () => {
    // A schedule mid-run has not failed. Flagging it every night while it
    // works would teach the reader to ignore the badge.
    const jobs = [job('running', 'running', 300), job('ok', 'completed', 200)]
    expect(scheduleBroken(jobs)).toBe(false)

    const afterBadNight = [job('running', 'running', 300), job('bad', 'failed', 200)]
    expect(scheduleBroken(afterBadNight)).toBe(true)
  })

  it('is false for a schedule that has never run', () => {
    expect(scheduleBroken([])).toBe(false)
  })
})

describe('scheduleBadge', () => {
  it('reports DISABLED regardless of history', () => {
    const badge = scheduleBadge(schedule({ enabled: false }), [job('a', 'failed', 1)])
    expect(badge.label).toBe('DISABLED')
  })

  it('reports NEEDS ATTENTION for an enabled schedule whose last run broke', () => {
    expect(scheduleBadge(schedule(), [job('a', 'failed', 1)]).label).toBe('NEEDS ATTENTION')
  })

  it('reports ACTIVE otherwise', () => {
    expect(scheduleBadge(schedule(), [job('a', 'completed', 1)]).label).toBe('ACTIVE')
    expect(scheduleBadge(schedule(), []).label).toBe('ACTIVE')
  })
})

describe('lastRunTone', () => {
  it('is null before the first run', () => {
    expect(lastRunTone([])).toBeNull()
  })

  it('follows the newest run’s outcome', () => {
    expect(lastRunTone([job('a', 'completed', 1)])).toBe('var(--ndm-success)')
    expect(lastRunTone([job('a', 'completed_with_failures', 1)])).toBe('var(--ndm-warning)')
    expect(lastRunTone([job('a', 'failed', 1)])).toBe('var(--ndm-danger)')
  })
})

describe('symbolSummary', () => {
  it('joins up to three in full', () => {
    expect(symbolSummary(['AAPL', 'MSFT', 'NVDA'])).toBe('AAPL · MSFT · NVDA')
  })

  it('collapses past three so the row keeps its timing readouts', () => {
    expect(symbolSummary(['AAPL', 'MSFT', 'NVDA', 'TSLA', 'GOOG'])).toBe('AAPL · MSFT +3')
  })

  it('says so when there are none', () => {
    expect(symbolSummary([])).toBe('no instruments')
  })
})

describe('symbolsForConIds', () => {
  it('falls back to the raw con_id when the instrument is not cached', () => {
    const cached = [{ con_id: 1, symbol: 'AAPL' }] as never
    expect(symbolsForConIds([1, 999], cached)).toEqual(['AAPL', '999'])
  })
})

describe('templateSummary', () => {
  it('reads back the template’s execution settings', () => {
    expect(templateSummary(schedule())).toBe('6w · 3r · lag 30m')
  })

  it('shows the engine default when workers is unset', () => {
    const withoutWorkers = schedule()
    withoutWorkers.template.workers = null
    expect(templateSummary(withoutWorkers)).toBe('4w · 3r · lag 30m')
  })
})
