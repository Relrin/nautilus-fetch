/**
 * Hand-written wire types.
 *
 * Every backend route is annotated `-> dict` with no `response_model`, so
 * `/openapi.json` carries empty response schemas — codegen would emit `unknown`
 * everywhere. These interfaces ARE the contract; keep them in sync with
 * `backend/src/api/schemas.py` by hand.
 *
 * `Dto` types mirror the wire exactly, snake_case included. Nothing outside
 * `api/` should see a `Dto` — `normalize.ts` converts at the edge.
 */
import type { ChunkState, ConnState, DataType, JobState, WhatToShow } from './enums'

// -- health / connection -----------------------------------------------------

export interface HealthDto {
  status: 'ok' | 'degraded'
  version: string
  db: string
}

export interface IbErrorDto {
  req_id: number
  code: number
  message: string
  /** epoch SECONDS (float) — connection.py uses time.time() directly. */
  ts: number
}

export interface IbStatusDto {
  state: ConnState
  host: string
  port: number
  client_id: number
  /** epoch SECONDS (float), not milliseconds. */
  connected_since: number | null
  reconnect_attempts: number
  server_version: number | null
  last_error: string | null
  last_ib_error: IbErrorDto | null
}

// -- instruments -------------------------------------------------------------

/** `/api/instruments/search` — straight off IB, no cached fields. */
export interface InstrumentSearchDto {
  con_id: number
  symbol: string
  sec_type: string
  primary_exchange: string | null
  currency: string | null
  description: string | null
  derivative_sec_types: string[]
}

/** A row of the `instruments` table: `/api/instruments` and `/api/instruments/{id}`. */
export interface InstrumentDto {
  con_id: number
  symbol: string
  sec_type: string
  exchange: string | null
  primary_exchange: string | null
  currency: string | null
  description: string | null
  instrument_id: string | null
  /** epoch milliseconds */
  refreshed_at: number | null
  /** epoch NANOSECONDS; null until a job has planned this instrument. */
  head_timestamp_ns: number | null
}

/** Raw IB ContractDetails. Only the fields we actually read are typed. */
export interface ContractDetailsDto {
  tradingHours?: string
  liquidHours?: string
  timeZoneId?: string
  stockType?: string
  longName?: string
  minTick?: number
  contract?: Record<string, unknown>
  [key: string]: unknown
}

export interface InstrumentDetailsDto extends InstrumentDto {
  details?: ContractDetailsDto
}

// -- jobs --------------------------------------------------------------------

export interface BarsParams {
  bar_size: string
  what_to_show: WhatToShow
  use_rth: boolean
}

export interface TickParams {
  use_rth: boolean
}

export interface CaptureWindowDto {
  start: string
  end: string
  tz: string
  /** 0=Mon .. 6=Sun */
  days: number[]
}

export interface DepthParams {
  depth_levels: number
  snapshot_interval_ms: number
  capture_from: string | null
  capture_until: string | null
  capture_window: CaptureWindowDto | null
}

export type JobParams = Partial<BarsParams & TickParams & DepthParams>

export interface JobDto {
  id: string
  name: string
  state: JobState
  data_type: DataType
  schedule_id: string | null
  /** Added in Phase 0; empty for jobs created before that. */
  symbols: string[]
  /** What "re-run" posts back. Not derivable from `symbols`. */
  con_ids: number[]
  params: JobParams
  workers: number
  max_retries: number
  /** ISO-8601 strings — unlike the `*_at` fields below. */
  range_start: string | null
  range_end: string | null
  total_chunks: number
  done_chunks: number
  empty_chunks: number
  failed_chunks: number
  /**
   * DO NOT RENDER THIS after a WebSocket patch has been merged.
   *
   * The hub never emits `progress` (or `total_chunks`), so a value taken from
   * the REST snapshot freezes at whatever the first GET returned. Derive it
   * with `jobProgress()` in domain/jobView.ts instead. Kept here only because
   * it is on the wire and useful as an initial sanity check.
   */
  progress: number
  rows_written: number
  bytes_written: number
  error: string | null
  /** epoch MILLISECONDS */
  created_at: number
  updated_at: number
  started_at: number | null
  finished_at: number | null
}

export type JobCreatedDto = JobDto & { warnings: string[] }

/**
 * The ONLY fields `WsHub.emit_job` can send. Verified against every call site
 * in engine/engine.py and engine/recorder.py.
 *
 * Widening this type reintroduces the frozen-progress bug: merging is
 * `{...job, ...patch}`, which is safe precisely because the patch cannot
 * contain a stale `progress` or `total_chunks`.
 */
export type JobPatch = Partial<
  Pick<
    JobDto,
    'state' | 'done_chunks' | 'empty_chunks' | 'failed_chunks' | 'rows_written' | 'bytes_written'
  >
>

export interface JobCreateBody {
  con_ids: number[]
  data_type: DataType
  name?: string
  start?: string
  end?: string
  bar_size?: string
  what_to_show?: WhatToShow
  use_rth?: boolean
  workers?: number
  max_retries?: number
  depth_levels?: number
  snapshot_interval_ms?: number
  capture_from?: string
  capture_until?: string
  capture_window?: CaptureWindowDto
}

export interface ChunksDto {
  total: number
  state_codes: Record<ChunkState, number>
  cells: [number, number][]
}

export interface ThroughputSampleDto {
  /** epoch milliseconds */
  ts: number
  rows_per_s: number
  /** BYTES per second — the WebSocket `tp` frame sends MEGABYTES instead. */
  bytes_per_s: number
  inflight: number | null
}

export interface ThroughputDto {
  window_s: number
  /** `persisted` samples are every 5th, so finished jobs are 5s-resolution. */
  source: 'live' | 'persisted'
  samples: ThroughputSampleDto[]
}

export interface FailureDto {
  chunk_id: number
  seq: number
  instrument_id: string
  /** epoch NANOSECONDS */
  range_start_ns: number
  range_end_ns: number
  attempts: number
  error_code: number | null
  error: string | null
}

// -- schedules ---------------------------------------------------------------

export interface ScheduleTemplateDto {
  con_ids: number[]
  /** No DEPTH: recorders run continuously and cannot be scheduled. */
  data_type: Exclude<DataType, 'DEPTH'>
  bar_size: string | null
  what_to_show: WhatToShow | null
  use_rth: boolean
  workers: number | null
  max_retries: number
  lag_minutes: number
  lookback_days: number
}

export interface ScheduleDto {
  id: string
  name: string
  cron: string
  enabled: boolean
  catchup: boolean
  template: ScheduleTemplateDto
  /** epoch milliseconds */
  last_run_at: number | null
  next_run_at: number | null
}

export interface ScheduleCreateBody {
  name: string
  cron: string
  template: ScheduleTemplateDto
  enabled?: boolean
  catchup?: boolean
}

export type ScheduleUpdateBody = Partial<ScheduleCreateBody>

/** `run-now` returns `job: null` when the schedule has nothing new to fetch. */
export interface RunNowDto {
  job: JobDto | null
  detail: string
}

// -- catalog -----------------------------------------------------------------

export interface CatalogIdentifierDto {
  identifier: string
  files: number
  bytes: number
  /** Date strings derived from filenames, e.g. "2004-01-02". */
  start: string | null
  end: string | null
}

export interface CatalogClassDto {
  data_type: string
  identifiers: CatalogIdentifierDto[]
}

export interface CatalogSummaryDto {
  path: string
  total_bytes: number
  classes: CatalogClassDto[]
}

export interface ConsolidateBody {
  data_type?: string
  identifier?: string
  ensure_contiguous_files?: boolean
  deduplicate?: boolean
}
