import { describe, expect, it } from 'vitest'

import { CHUNK_CODE } from '@/api/enums'
import type { ChunksDto } from '@/api/types'

import { ChunkBuffer } from './chunkMap'

const dto = (total: number, cells: [number, number][] = []): ChunksDto => ({
  total,
  state_codes: CHUNK_CODE,
  cells,
})

describe('ChunkBuffer.fold', () => {
  it('renders exactly 96 cells once there are more chunks than buckets', () => {
    expect(ChunkBuffer.fromDto(dto(12_480)).fold()).toHaveLength(96)
  })

  it('renders one cell per chunk when under the bucket count', () => {
    // Upsampling would light ~19 cells for a single chunk, overstating progress.
    expect(ChunkBuffer.fromDto(dto(3)).fold()).toEqual(['pending', 'pending', 'pending'])
  })

  it('keeps a lone failure visible among thousands of successes', () => {
    const cells: [number, number][] = Array.from({ length: 10_000 }, (_, i) => [i, CHUNK_CODE.done])
    cells[5_000] = [5_000, CHUNK_CODE.failed]
    const folded = ChunkBuffer.fromDto(dto(10_000, cells)).fold()
    expect(folded.filter((cell) => cell === 'failed')).toHaveLength(1)
    // ...and every OTHER cell reports the success it actually holds. The
    // bucket seed used to be 0, which is `pending` and outranks `done`, so a
    // wholly-completed bucket kept its seed and the map drew a finished job as
    // untouched. Asserting only the failure count let that pass.
    expect(folded.filter((cell) => cell === 'done')).toHaveLength(95)
  })

  it('folds a partially-run job into done, active and pending regions', () => {
    // 8,024 of 12,480 settled with 4 in flight — the shape of a live job.
    const cells: [number, number][] = []
    for (let i = 0; i < 8_024; i += 1) cells.push([i, CHUNK_CODE.done])
    for (let i = 8_024; i < 8_028; i += 1) cells.push([i, CHUNK_CODE.active])
    const folded = ChunkBuffer.fromDto(dto(12_480, cells)).fold()

    expect(folded).toHaveLength(96)
    expect(folded.filter((cell) => cell === 'done').length).toBeGreaterThan(55)
    expect(folded).toContain('active')
    expect(folded).toContain('pending')
    // The trailing third has genuinely not started.
    expect(folded.at(-1)).toBe('pending')
    expect(folded.at(0)).toBe('done')
  })

  it('ranks failed over active over pending over done within a bucket', () => {
    // 4 chunks -> 2 buckets: [done, active] and [pending, failed]
    const buffer = ChunkBuffer.fromDto(
      dto(4, [
        [0, CHUNK_CODE.done],
        [1, CHUNK_CODE.active],
        [2, CHUNK_CODE.pending],
        [3, CHUNK_CODE.failed],
      ]),
    )
    expect(buffer.fold(2)).toEqual(['active', 'failed'])
  })

  it('folds empty to done — a closed market is a success, not a fifth colour', () => {
    const buffer = ChunkBuffer.fromDto(
      dto(2, [
        [0, CHUNK_CODE.empty],
        [1, CHUNK_CODE.empty],
      ]),
    )
    expect(buffer.fold()).toEqual(['done', 'done'])
  })

  it('has no cells to render before the planner has run', () => {
    expect(ChunkBuffer.fromDto(dto(0)).fold()).toEqual([])
    expect(ChunkBuffer.fromDto(dto(0)).scaleLabel()).toBe('waiting for plan')
  })
})

describe('ChunkBuffer.applyDelta', () => {
  it('returns a new instance so React re-renders', () => {
    const before = ChunkBuffer.fromDto(dto(10))
    const after = before.applyDelta([[0, CHUNK_CODE.done]])
    expect(after).not.toBe(before)
    expect(after.counts().done).toBe(1)
  })

  it('grows for a DEPTH recorder whose segment count exceeds the current total', () => {
    // Recorders add chunks as buffers flush, so seq can exceed the known total.
    const grown = ChunkBuffer.fromDto(dto(2)).applyDelta([[7, CHUNK_CODE.done]])
    expect(grown.total).toBe(8)
    expect(grown.counts().done).toBe(1)
  })

  it('is a no-op for an empty delta', () => {
    const buffer = ChunkBuffer.fromDto(dto(4))
    expect(buffer.applyDelta([])).toBe(buffer)
  })
})

describe('ChunkBuffer.scaleLabel', () => {
  it('reports how many chunks a cell stands for', () => {
    expect(ChunkBuffer.fromDto(dto(12_480)).scaleLabel()).toBe('1 cell ≈ 130 chunks')
    expect(ChunkBuffer.fromDto(dto(50)).scaleLabel()).toBe('1 cell = 1 chunk')
  })
})
