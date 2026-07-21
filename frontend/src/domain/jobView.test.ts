import { describe, expect, it } from 'vitest'

import type { JobDto } from '@/api/types'
import type { JobPatch } from '@/api/types'

import { isRecorder, jobBadge, jobProgress, jobTitle, partitionJobs } from './jobView'

const job = (overrides: Partial<JobDto> = {}): JobDto => ({
  id: 'j1',
  name: 'AAPL',
  state: 'running',
  data_type: 'BARS',
  schedule_id: null,
  symbols: ['AAPL.NASDAQ'],
  con_ids: [265598],
  params: { bar_size: '1 min' },
  workers: 4,
  max_retries: 3,
  range_start: '2026-01-01T00:00:00+00:00',
  range_end: '2026-02-01T00:00:00+00:00',
  total_chunks: 100,
  done_chunks: 0,
  empty_chunks: 0,
  failed_chunks: 0,
  progress: 0,
  rows_written: 0,
  bytes_written: 0,
  error: null,
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
  started_at: null,
  finished_at: null,
  ...overrides,
})

describe('jobProgress', () => {
  it('counts done, empty and failed as settled', () => {
    expect(jobProgress(job({ done_chunks: 40, empty_chunks: 10, failed_chunks: 10 }))).toBeCloseTo(
      0.6,
    )
  })

  it('advances when only WebSocket-patchable fields change', () => {
    // The regression this whole design exists to prevent: the hub never sends
    // `progress`, so merging a patch over a REST snapshot must still move the
    // bar. If this ever reads job.progress, it returns the stale 0.
    const snapshot = job({ progress: 0.0, done_chunks: 0 })
    const patch: JobPatch = { done_chunks: 75 }
    const merged = { ...snapshot, ...patch }
    expect(merged.progress).toBe(0) // the wire value is still stale...
    expect(jobProgress(merged)).toBeCloseTo(0.75) // ...but the derived value is not
  })

  it('is 0 rather than NaN before the planner has produced chunks', () => {
    expect(jobProgress(job({ total_chunks: 0 }))).toBe(0)
  })

  it('never exceeds 1', () => {
    expect(jobProgress(job({ total_chunks: 10, done_chunks: 50 }))).toBe(1)
  })
})

describe('DEPTH recorders', () => {
  it('is identified by data_type, not by an absent chunk count', () => {
    // recorder.py bumps done+total together on each flush, so a recording job
    // sits at progress 1.0 forever. total_chunks === 0 is NOT the signal.
    const recording = job({ data_type: 'DEPTH', total_chunks: 12, done_chunks: 12 })
    expect(jobProgress(recording)).toBe(1)
    expect(isRecorder(recording)).toBe(true)
    expect(jobBadge(recording).label).toBe('RECORDING')
  })

  it('does not mistake a freshly queued backfill for a recorder', () => {
    expect(isRecorder(job({ total_chunks: 0 }))).toBe(false)
  })
})

describe('jobBadge', () => {
  it('maps every backend state, including the FAILED the mockup lacks', () => {
    expect(jobBadge(job({ state: 'completed' })).label).toBe('DONE')
    expect(jobBadge(job({ state: 'completed_with_failures' })).label).toBe('ISSUES')
    expect(jobBadge(job({ state: 'canceled' })).label).toBe('CANCELED')
    expect(jobBadge(job({ state: 'failed' })).label).toBe('FAILED')
    expect(jobBadge(job({ state: 'queued' })).label).toBe('QUEUED')
    expect(jobBadge(job({ state: 'paused' })).label).toBe('PAUSED')
  })
})

describe('jobTitle', () => {
  it('joins symbols', () => {
    expect(jobTitle(job({ symbols: ['EURUSD.IDEALPRO', 'GBPUSD.IDEALPRO'] }))).toBe(
      'EURUSD.IDEALPRO · GBPUSD.IDEALPRO',
    )
  })

  it('falls back to name when a job predates the symbols field', () => {
    expect(jobTitle(job({ symbols: [], name: 'FX majors @ 2026-07-21 02:00' }))).toBe(
      'FX majors @ 2026-07-21 02:00',
    )
  })
})

describe('partitionJobs', () => {
  it('splits active from terminal states', () => {
    const { queue, history } = partitionJobs([
      job({ id: 'a', state: 'queued' }),
      job({ id: 'b', state: 'running' }),
      job({ id: 'c', state: 'paused' }),
      job({ id: 'd', state: 'completed' }),
      job({ id: 'e', state: 'completed_with_failures' }),
      job({ id: 'f', state: 'canceled' }),
      job({ id: 'g', state: 'failed' }),
    ])
    expect(queue.map((j) => j.id)).toEqual(['a', 'b', 'c'])
    expect(history.map((j) => j.id)).toEqual(['d', 'e', 'f', 'g'])
  })

  it('handles an undefined list while the query is loading', () => {
    expect(partitionJobs(undefined)).toEqual({ queue: [], history: [] })
  })
})
