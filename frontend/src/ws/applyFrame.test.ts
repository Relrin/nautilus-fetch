import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'

import { CHUNK_CODE } from '@/api/enums'
import { qk } from '@/api/keys'
import type { ChunksDto, JobDto, ThroughputDto } from '@/api/types'
import { ChunkBuffer } from '@/domain/chunkMap'
import { jobProgress } from '@/domain/jobView'
import { TpRing } from '@/domain/throughput'

import { applyFrame } from './applyFrame'

const job = (overrides: Partial<JobDto> = {}): JobDto => ({
  id: 'J1',
  name: 'AAPL',
  state: 'running',
  data_type: 'BARS',
  schedule_id: null,
  symbols: ['AAPL.SMART'],
  params: { bar_size: '1 min', what_to_show: 'TRADES', use_rth: true },
  workers: 4,
  max_retries: 3,
  range_start: '2026-06-21T00:00:00Z',
  range_end: '2026-07-21T00:00:00Z',
  total_chunks: 1_000,
  done_chunks: 100,
  empty_chunks: 0,
  failed_chunks: 0,
  // The stale value the hub can never correct. 0.1 matches the counters above.
  progress: 0.1,
  rows_written: 1_000,
  bytes_written: 2_000,
  error: null,
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
  started_at: 1_700_000_000_000,
  finished_at: null,
  ...overrides,
})

let queryClient: QueryClient

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

describe('applyFrame — job frames', () => {
  it('advances derived progress even though the hub never sends `progress`', () => {
    // This is correction #1. The bug it guards is invisible: the bar simply
    // stops moving while every counter beside it keeps climbing.
    queryClient.setQueryData<JobDto[]>(qk.jobs, [job()])
    queryClient.setQueryData<JobDto>(qk.job('J1'), job())

    applyFrame(queryClient, { t: 'job', id: 'J1', patch: { done_chunks: 640 } })

    const patched = queryClient.getQueryData<JobDto>(qk.job('J1'))!
    expect(jobProgress(patched)).toBeCloseTo(0.64)
    // The wire field is still the value from the original GET. Anything that
    // renders it instead of deriving would show 10% on a 64%-complete job.
    expect(patched.progress).toBe(0.1)
    expect(queryClient.getQueryData<JobDto[]>(qk.jobs)![0]!.done_chunks).toBe(640)
  })

  it('counts empty and failed chunks as settled', () => {
    queryClient.setQueryData<JobDto>(qk.job('J1'), job())
    applyFrame(queryClient, {
      t: 'job',
      id: 'J1',
      patch: { done_chunks: 500, empty_chunks: 300, failed_chunks: 200 },
    })
    expect(jobProgress(queryClient.getQueryData<JobDto>(qk.job('J1'))!)).toBe(1)
  })

  it('invalidates the list when a job reaches a terminal state', () => {
    // `finished_at` and the queue/history split are not in the patch, so the
    // merged copy alone would leave a finished job sitting in the queue.
    queryClient.setQueryData<JobDto[]>(qk.jobs, [job()])
    expect(queryClient.getQueryState(qk.jobs)?.isInvalidated).toBe(false)

    applyFrame(queryClient, { t: 'job', id: 'J1', patch: { state: 'completed' } })

    expect(queryClient.getQueryState(qk.jobs)?.isInvalidated).toBe(true)
  })

  it('leaves the list alone for a non-terminal state change', () => {
    queryClient.setQueryData<JobDto[]>(qk.jobs, [job()])
    applyFrame(queryClient, { t: 'job', id: 'J1', patch: { state: 'paused' } })
    expect(queryClient.getQueryState(qk.jobs)?.isInvalidated).toBe(false)
    expect(queryClient.getQueryData<JobDto[]>(qk.jobs)![0]!.state).toBe('paused')
  })

  it('ignores a frame for a job that is not cached', () => {
    applyFrame(queryClient, { t: 'job', id: 'ghost', patch: { done_chunks: 5 } })
    expect(queryClient.getQueryData(qk.job('ghost'))).toBeUndefined()
  })
})

describe('applyFrame — chunk frames', () => {
  const dto: ChunksDto = { total: 4, state_codes: CHUNK_CODE, cells: [] }

  it('applies a delta to the cached buffer', () => {
    queryClient.setQueryData(qk.chunks('J1'), ChunkBuffer.fromDto(dto))

    applyFrame(queryClient, {
      t: 'chunks',
      job: 'J1',
      cells: [
        [0, CHUNK_CODE.done],
        [1, CHUNK_CODE.failed],
      ],
    })

    const buffer = queryClient.getQueryData<ChunkBuffer>(qk.chunks('J1'))!
    expect(buffer.counts()).toEqual({ pending: 2, active: 0, done: 1, empty: 0, failed: 1 })
  })

  it('returns a new buffer instance so React re-renders the map', () => {
    const before = ChunkBuffer.fromDto(dto)
    queryClient.setQueryData(qk.chunks('J1'), before)
    applyFrame(queryClient, { t: 'chunks', job: 'J1', cells: [[0, CHUNK_CODE.done]] })
    expect(queryClient.getQueryData(qk.chunks('J1'))).not.toBe(before)
  })

  it('drops deltas for a job whose chunks were never fetched', () => {
    applyFrame(queryClient, { t: 'chunks', job: 'J9', cells: [[0, CHUNK_CODE.done]] })
    expect(queryClient.getQueryData(qk.chunks('J9'))).toBeUndefined()
  })
})

describe('applyFrame — throughput frames', () => {
  const dto: ThroughputDto = { window_s: 600, source: 'live', samples: [] }

  it('converts mb_s to bytes with decimal megabytes, not mebibytes', () => {
    // Correction #3: throughput.py divides by 1_000_000. Using 1048576 here
    // would under-report every speed reading by 4.9% — wrong, but believable.
    queryClient.setQueryData(qk.throughput('J1'), TpRing.seed(dto))

    applyFrame(queryClient, { t: 'tp', job: 'J1', ts: 1_700_000_001_000, rows_s: 900, mb_s: 2.5 })

    const ring = queryClient.getQueryData<TpRing>(qk.throughput('J1'))!
    expect(ring.latest()?.bytesPerSec).toBe(2_500_000)
    expect(ring.latest()?.rowsPerSec).toBe(900)
    // The `tp` frame carries no inflight count; reporting 0 would draw a line
    // that says "nothing is in flight" when we simply do not know.
    expect(ring.latest()?.inflight).toBeNull()
  })

  it('drops samples for a job whose throughput was never fetched', () => {
    applyFrame(queryClient, { t: 'tp', job: 'J9', ts: 1, rows_s: 1, mb_s: 1 })
    expect(queryClient.getQueryData(qk.throughput('J9'))).toBeUndefined()
  })
})
