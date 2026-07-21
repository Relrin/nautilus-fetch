/**
 * Chunk-state storage and the fold down to the mockup's 96 cells.
 *
 * `/api/jobs/{id}/chunks` returns every chunk — up to `max_chunks_per_job`
 * (50,000). Storing that as `[seq, code][]` or a Map would cost 20-40x the
 * memory and make re-bucketing on every WebSocket delta noticeably slow, so
 * state lives in a `Uint8Array` indexed by seq. 50,000 chunks is 50 KB.
 */
import { CHUNK_CELLS } from '@/lib/constants'
import { CHUNK_CODE, type ChunkState } from '@/api/enums'
import type { ChunksDto } from '@/api/types'

/**
 * Which state wins when many chunks collapse into one cell.
 *
 * Worst-state-wins: a single failure among 500 successes must stay visible,
 * because the cell is a summary and the eye should be drawn to the problem.
 * `empty` ranks lowest alongside `done` — it IS a success (the market was
 * closed), and giving it a distinct colour would need a fifth legend entry the
 * mockup does not have.
 */
const RANK: Record<number, number> = {
  [CHUNK_CODE.failed]: 4,
  [CHUNK_CODE.active]: 3,
  [CHUNK_CODE.pending]: 2,
  [CHUNK_CODE.done]: 1,
  [CHUNK_CODE.empty]: 1,
}

/**
 * "No chunk has landed in this bucket yet", distinct from every wire code.
 * It must NOT be 0 — that is `pending`, a real state with a real rank.
 */
const UNSET = 255

/** What a folded cell renders as. `empty` is deliberately absent — it folds to `done`. */
export type CellState = 'pending' | 'active' | 'done' | 'failed'

const CELL_OF_CODE: Record<number, CellState> = {
  [CHUNK_CODE.pending]: 'pending',
  [CHUNK_CODE.active]: 'active',
  [CHUNK_CODE.done]: 'done',
  [CHUNK_CODE.empty]: 'done',
  [CHUNK_CODE.failed]: 'failed',
}

export interface ChunkCounts {
  pending: number
  active: number
  done: number
  empty: number
  failed: number
}

export class ChunkBuffer {
  readonly total: number
  private readonly cells: Uint8Array

  private constructor(total: number, cells: Uint8Array) {
    this.total = total
    this.cells = cells
  }

  static empty(total = 0): ChunkBuffer {
    return new ChunkBuffer(total, new Uint8Array(Math.max(0, total)))
  }

  static fromDto(dto: ChunksDto): ChunkBuffer {
    // Cells arrive sparse; anything unmentioned is pending (code 0), which is
    // what a zero-filled array already means.
    const size = Math.max(dto.total, ...dto.cells.map(([seq]) => seq + 1), 0)
    const cells = new Uint8Array(size)
    for (const [seq, code] of dto.cells) {
      if (seq >= 0 && seq < size) cells[seq] = code
    }
    return new ChunkBuffer(dto.total, cells)
  }

  /**
   * Apply a WebSocket delta. Mutates the backing array in place for speed but
   * returns a NEW wrapper — React compares by identity, so reusing `this`
   * would mean the chunk map never re-renders.
   */
  applyDelta(delta: [number, number][]): ChunkBuffer {
    if (delta.length === 0) return this

    // DEPTH recorders grow their chunk count as segments flush, so a delta can
    // legitimately reference a seq beyond the current array.
    const maxSeq = delta.reduce((max, [seq]) => (seq > max ? seq : max), -1)
    let cells = this.cells
    if (maxSeq >= cells.length) {
      cells = new Uint8Array(Math.max(maxSeq + 1, cells.length * 2))
      cells.set(this.cells)
    }
    for (const [seq, code] of delta) {
      if (seq >= 0) cells[seq] = code
    }
    return new ChunkBuffer(Math.max(this.total, maxSeq + 1), cells)
  }

  counts(): ChunkCounts {
    const counts: ChunkCounts = { pending: 0, active: 0, done: 0, empty: 0, failed: 0 }
    const limit = Math.min(this.total, this.cells.length)
    for (let i = 0; i < limit; i += 1) {
      switch (this.cells[i]) {
        case CHUNK_CODE.active:
          counts.active += 1
          break
        case CHUNK_CODE.done:
          counts.done += 1
          break
        case CHUNK_CODE.empty:
          counts.empty += 1
          break
        case CHUNK_CODE.failed:
          counts.failed += 1
          break
        default:
          counts.pending += 1
      }
    }
    return counts
  }

  /**
   * Collapse to at most `buckets` cells.
   *
   * When there are fewer chunks than buckets we return exactly `total` cells
   * rather than stretching each chunk across ~19 of them: a 3-chunk job
   * lighting up 57 cells reads as a lie about how much work is happening.
   */
  fold(buckets = CHUNK_CELLS): CellState[] {
    if (this.total <= 0) return []
    if (this.total <= buckets) {
      return Array.from(
        { length: this.total },
        (_, i) => CELL_OF_CODE[this.cells[i] ?? 0] ?? 'pending',
      )
    }

    // UNSET, not 0: zero is `pending`, which outranks `done`. Seeding the
    // buckets with it would mean a bucket whose chunks all succeeded could
    // never beat its own initial value, and a job at 64% would draw a chunk
    // map that looks untouched.
    const winners = new Uint8Array(buckets).fill(UNSET)
    for (let i = 0; i < this.total; i += 1) {
      const bucket = Math.floor((i * buckets) / this.total)
      const code = this.cells[i] ?? 0
      const current = winners[bucket] ?? UNSET
      if ((RANK[code] ?? 0) > (RANK[current] ?? 0)) winners[bucket] = code
    }
    return Array.from(winners, (code) => CELL_OF_CODE[code] ?? 'pending')
  }

  /** Caption under the map: how much each cell stands for. */
  scaleLabel(buckets = CHUNK_CELLS): string {
    if (this.total <= 0) return 'waiting for plan'
    if (this.total <= buckets) return '1 cell = 1 chunk'
    return `1 cell ≈ ${Math.ceil(this.total / buckets).toLocaleString('en-US')} chunks`
  }
}

export const chunkStateFromCode = (code: number): ChunkState => {
  const entry = Object.entries(CHUNK_CODE).find(([, value]) => value === code)
  return (entry?.[0] as ChunkState | undefined) ?? 'pending'
}
