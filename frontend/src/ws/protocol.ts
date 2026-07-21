/**
 * Wire protocol for `/ws`.
 *
 * Server-to-client only; the hub reads and discards anything we send. Frames
 * are coalesced server-side per `ws_batch_ms` (500ms) and are explicitly
 * ADVISORY — api/ws.py states clients must re-sync via REST after every
 * (re)connect. Nothing here is a source of truth.
 */
import type { JobPatch } from '@/api/types'

export interface JobFrame {
  t: 'job'
  id: string
  /** Only ever the six fields in `JobPatch`. Never `progress`. */
  patch: JobPatch
}

export interface ChunksFrame {
  t: 'chunks'
  job: string
  /** `[seq, stateCode]` pairs — a delta, not a full snapshot. */
  cells: [number, number][]
}

export interface TpFrame {
  t: 'tp'
  job: string
  /** epoch milliseconds */
  ts: number
  rows_s: number
  /** MEGABYTES per second. REST reports the same figure as `bytes_per_s`. */
  mb_s: number
}

export type WsFrame = JobFrame | ChunksFrame | TpFrame

export function parseFrame(data: unknown): WsFrame | null {
  if (typeof data !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const frame = parsed as Partial<WsFrame>
  switch (frame.t) {
    case 'job':
      return typeof (frame as JobFrame).id === 'string' ? (frame as JobFrame) : null
    case 'chunks':
      return Array.isArray((frame as ChunksFrame).cells) ? (frame as ChunksFrame) : null
    case 'tp':
      return typeof (frame as TpFrame).job === 'string' ? (frame as TpFrame) : null
    default:
      return null
  }
}
