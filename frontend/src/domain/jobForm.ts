/**
 * The new-job form's state, validation and payload builders.
 *
 * Validation mirrors `check_data_type_params` in `backend/src/api/schemas.py`
 * rather than discovering the rules through 422s. The point is not to replace
 * the server check — it stays authoritative — but to stop the form offering
 * combinations the server will certainly reject.
 */
import cronstrue from 'cronstrue'

import type { BarSize, DataType, WhatToShow } from '@/api/enums'
import type { CaptureWindowDto, JobCreateBody, ScheduleCreateBody } from '@/api/types'
import {
  MAX_CON_IDS,
  MAX_DEPTH_LEVELS,
  MAX_RETRIES,
  MAX_SNAPSHOT_INTERVAL_MS,
  MAX_WORKERS,
} from '@/lib/constants'

/** `once` posts a job; the other two create a schedule. */
export type Cadence = 'once' | 'nightly' | 'cron'

export interface JobFormState {
  conIds: number[]
  dataType: DataType
  barSize: BarSize | null
  whatToShow: WhatToShow
  useRth: boolean
  /** `yyyy-mm-dd`, as produced by `<input type="date">`. */
  from: string
  to: string
  workers: number
  maxRetries: number
  cadence: Cadence
  /** `HH:MM` for the nightly cadence. */
  nightlyTime: string
  cron: string
  depthLevels: number
  snapshotIntervalMs: number
  /** `yyyy-mm-dd`, optional stop time for a recorder. */
  captureUntil: string
  captureWindowEnabled: boolean
  captureWindow: CaptureWindowDto
}

export const DEFAULT_CAPTURE_WINDOW: CaptureWindowDto = {
  start: '09:30',
  end: '16:00',
  tz: 'America/New_York',
  // Mon–Fri. Matches the backend default and the only sane starting point for
  // an equities recorder.
  days: [0, 1, 2, 3, 4],
}

export function initialJobForm(today = new Date()): JobFormState {
  const { from, to } = presetRange(1, today)
  return {
    conIds: [],
    dataType: 'BARS',
    barSize: '1 min',
    whatToShow: 'TRADES',
    useRth: true,
    from,
    to,
    workers: 4,
    maxRetries: 3,
    cadence: 'once',
    nightlyTime: '02:30',
    cron: '30 2 * * 1-5',
    depthLevels: 10,
    snapshotIntervalMs: 1000,
    captureUntil: '',
    captureWindowEnabled: false,
    captureWindow: DEFAULT_CAPTURE_WINDOW,
  }
}

// -- range presets -----------------------------------------------------------

export const RANGE_PRESETS = [
  { label: '1M', months: 1 },
  { label: '3M', months: 3 },
  { label: '6M', months: 6 },
  { label: '1Y', months: 12 },
  { label: '5Y', months: 60 },
] as const

const isoDay = (date: Date): string => date.toISOString().slice(0, 10)

export function presetRange(months: number, today = new Date()): { from: string; to: string } {
  const start = new Date(today)
  start.setMonth(start.getMonth() - months)
  return { from: isoDay(start), to: isoDay(today) }
}

// -- validation --------------------------------------------------------------

export interface FieldError {
  field: string
  message: string
}

/**
 * Every reason the current state cannot be submitted.
 *
 * `DEPTH` is the branch worth reading twice: the backend rejects `end` on a
 * recorder AND rejects depth options on everything else, so the two shapes are
 * mutually exclusive rather than merely different.
 */
export function validateJobForm(state: JobFormState): FieldError[] {
  const errors: FieldError[] = []
  const recorder = state.dataType === 'DEPTH'

  if (state.conIds.length === 0) {
    errors.push({ field: 'conIds', message: 'Pick at least one instrument.' })
  }
  if (state.conIds.length > MAX_CON_IDS) {
    errors.push({ field: 'conIds', message: `At most ${MAX_CON_IDS} instruments per job.` })
  }
  if (state.dataType === 'BARS' && !state.barSize) {
    errors.push({ field: 'barSize', message: 'Bar size is required for bar jobs.' })
  }

  if (recorder) {
    if (state.snapshotIntervalMs < 0 || state.snapshotIntervalMs > MAX_SNAPSHOT_INTERVAL_MS) {
      errors.push({
        field: 'snapshotIntervalMs',
        message: `Snapshot interval must be between 0 and ${MAX_SNAPSHOT_INTERVAL_MS} ms.`,
      })
    }
    if (state.depthLevels < 1 || state.depthLevels > MAX_DEPTH_LEVELS) {
      errors.push({
        field: 'depthLevels',
        message: `Depth levels must be between 1 and ${MAX_DEPTH_LEVELS}.`,
      })
    }
    if (state.captureWindowEnabled && state.captureWindow.days.length === 0) {
      errors.push({ field: 'captureWindow', message: 'Pick at least one weekday.' })
    }
  } else {
    if (!state.from || !state.to) {
      errors.push({ field: 'range', message: 'Both From and To are required.' })
    } else if (state.from > state.to) {
      errors.push({ field: 'range', message: 'From must be on or before To.' })
    }
  }

  if (state.workers < 1 || state.workers > MAX_WORKERS) {
    errors.push({ field: 'workers', message: `Workers must be between 1 and ${MAX_WORKERS}.` })
  }
  if (state.maxRetries < 0 || state.maxRetries > MAX_RETRIES) {
    errors.push({ field: 'maxRetries', message: `Retries must be between 0 and ${MAX_RETRIES}.` })
  }

  if (state.cadence !== 'once') {
    if (recorder) {
      errors.push({
        field: 'cadence',
        message: 'Depth recorders run continuously and cannot be scheduled.',
      })
    }
    // `cron` is `min_length=9` server-side, so a truncated paste 422s.
    if (state.cadence === 'cron' && state.cron.trim().length < 9) {
      errors.push({ field: 'cron', message: 'Cron needs all five fields, e.g. `30 2 * * 1-5`.' })
    }
    if (state.cadence === 'nightly' && !/^\d{2}:\d{2}$/.test(state.nightlyTime)) {
      errors.push({ field: 'nightlyTime', message: 'Time must be HH:MM.' })
    }
  }

  return errors
}

// -- payload builders --------------------------------------------------------

/** Full-day bounds, so the To date the user picked is actually included. */
const startOfDayIso = (day: string): string => `${day}T00:00:00Z`
const endOfDayIso = (day: string): string => `${day}T23:59:59Z`

/**
 * Build the `POST /api/jobs` body.
 *
 * Keys are DELETED rather than set to `undefined`. `exactOptionalPropertyTypes`
 * makes that a compile error instead of a runtime 422 — the backend rejects a
 * present-but-null `end` on a recorder just as firmly as a wrong value.
 */
export function buildJobBody(state: JobFormState, name?: string): JobCreateBody {
  const body: JobCreateBody = {
    con_ids: state.conIds,
    data_type: state.dataType,
    use_rth: state.useRth,
    workers: state.workers,
    max_retries: state.maxRetries,
  }
  if (name) body.name = name

  if (state.dataType === 'BARS') {
    if (state.barSize) body.bar_size = state.barSize
    body.what_to_show = state.whatToShow
  }

  if (state.dataType === 'DEPTH') {
    body.depth_levels = state.depthLevels
    body.snapshot_interval_ms = state.snapshotIntervalMs
    if (state.captureUntil) body.capture_until = endOfDayIso(state.captureUntil)
    if (state.captureWindowEnabled) body.capture_window = state.captureWindow
  } else {
    body.start = startOfDayIso(state.from)
    body.end = endOfDayIso(state.to)
  }

  return body
}

/**
 * Plain-English cron, or an explicit "not valid".
 *
 * cronstrue throws only with `throwExceptionOnParseError`; without it, garbage
 * comes back as a confident-sounding sentence.
 */
export function humanCron(expression: string): string {
  try {
    return cronstrue.toString(expression, { verbose: false, throwExceptionOnParseError: true })
  } catch {
    return 'not a valid cron expression'
  }
}

/** `nightly HH:MM` becomes `M H * * *`; `cron` is passed through verbatim. */
export function cronFor(state: JobFormState): string {
  if (state.cadence === 'cron') return state.cron.trim()
  const [hour = '02', minute = '30'] = state.nightlyTime.split(':')
  return `${Number(minute)} ${Number(hour)} * * *`
}

/**
 * Build the `POST /api/schedules` body.
 *
 * `lag_minutes` and `lookback_days` are sent explicitly even though they match
 * the backend defaults — the estimate panel states both, and a stated number
 * that is not actually transmitted is the kind of small lie that costs trust
 * when someone later changes the default.
 */
export function buildScheduleBody(state: JobFormState, name: string): ScheduleCreateBody {
  if (state.dataType === 'DEPTH') {
    throw new Error('DEPTH recorders cannot be scheduled')
  }
  return {
    name,
    cron: cronFor(state),
    enabled: true,
    catchup: false,
    template: {
      con_ids: state.conIds,
      data_type: state.dataType,
      bar_size: state.dataType === 'BARS' ? state.barSize : null,
      what_to_show: state.dataType === 'BARS' ? state.whatToShow : null,
      use_rth: state.useRth,
      workers: state.workers,
      max_retries: state.maxRetries,
      lag_minutes: 15,
      lookback_days: 7,
    },
  }
}
