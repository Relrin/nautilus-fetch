/**
 * The one place wire units are converted. Nothing downstream touches a raw
 * timestamp or a raw throughput number.
 *
 * The backend uses FOUR timestamp scales, which is the single easiest thing to
 * get wrong in this integration:
 *
 *   ISO-8601 string   range_start, range_end, params.capture_from/until
 *   epoch ms          created_at, updated_at, started_at, finished_at,
 *                     last_run_at, next_run_at, tp.ts, throughput samples[].ts
 *   epoch SECONDS     ib/status.connected_since, last_ib_error.ts
 *   epoch NANOSECONDS failures[].range_start_ns/range_end_ns,
 *                     instruments.head_timestamp_ns
 *
 * It also reports throughput twice with different names AND different units:
 * REST sends `bytes_per_s`, the WebSocket sends `mb_s`. Canonical internal
 * unit is bytes/second; `mb_s` must not escape this file.
 */
import type { ThroughputSampleDto } from './types'

export const msToDate = (ms: number): Date => new Date(ms)
export const msToDateOrNull = (ms: number | null | undefined): Date | null =>
  ms === null || ms === undefined ? null : new Date(ms)

/** ib/status only — connection.py stores `time.time()` unscaled. */
export const secToDate = (seconds: number | null | undefined): Date | null =>
  seconds === null || seconds === undefined ? null : new Date(seconds * 1000)

/** Nanosecond epochs (Nautilus convention) — failures and head timestamps. */
export const nsToDate = (ns: number | null | undefined): Date | null =>
  ns === null || ns === undefined ? null : new Date(ns / 1e6)

export const isoToDate = (iso: string | null | undefined): Date | null =>
  iso === null || iso === undefined ? null : new Date(iso)

/** A throughput reading in canonical units. */
export interface TpSample {
  tsMs: number
  rowsPerSec: number
  bytesPerSec: number
  /** Null for WebSocket-sourced samples: the `tp` frame does not carry it, and
   *  reporting 0 would draw a false line on the chart. */
  inflight: number | null
}

export const tpFromRest = (sample: ThroughputSampleDto): TpSample => ({
  tsMs: sample.ts,
  rowsPerSec: sample.rows_per_s,
  bytesPerSec: sample.bytes_per_s,
  inflight: sample.inflight,
})

/**
 * throughput.py:141 computes `mb_s` as `bytes_per_s / 1_000_000` — decimal
 * megabytes, NOT mebibytes. Using 1048576 here is wrong by 4.9%.
 */
export const MB_TO_BYTES = 1_000_000

export const tpFromWs = (frame: { ts: number; rows_s: number; mb_s: number }): TpSample => ({
  tsMs: frame.ts,
  rowsPerSec: frame.rows_s,
  bytesPerSec: frame.mb_s * MB_TO_BYTES,
  inflight: null,
})
