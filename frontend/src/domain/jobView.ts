/**
 * Derived job state. Everything the UI renders about a job comes from here.
 */
import { ACTIVE_JOB_STATES, type JobState } from '@/api/enums'
import { isoToDate, msToDateOrNull } from '@/api/normalize'
import type { JobDto } from '@/api/types'

/**
 * Fraction settled, 0..1.
 *
 * MUST be used instead of `job.progress`. The WebSocket hub never emits
 * `progress` or `total_chunks` — only the five counters and `state` — so a
 * value read from the REST snapshot and then patched would freeze at whatever
 * the first GET returned and never move again. Recomputing from the counters
 * the hub *does* send is what makes the bar advance.
 */
export function jobProgress(job: JobDto): number {
  if (job.total_chunks <= 0) return 0
  const settled = job.done_chunks + job.empty_chunks + job.failed_chunks
  return Math.min(1, settled / job.total_chunks)
}

/** Fraction of the bar that should render as failed, 0..1. */
export function jobFailedFraction(job: JobDto): number {
  if (job.total_chunks <= 0) return 0
  return Math.min(1, job.failed_chunks / job.total_chunks)
}

/**
 * A live L2 recorder.
 *
 * Gate on data_type, never on `total_chunks === 0`: recorder.py bumps
 * `done` and `total` together on every buffer flush, so a recorder's
 * `progress` is 0 for the first few minutes and then pinned at 1.0 for the
 * rest of its life while still actively recording.
 */
export const isRecorder = (job: JobDto): boolean => job.data_type === 'DEPTH'

export const isActive = (state: JobState): boolean => ACTIVE_JOB_STATES.includes(state)

export interface JobBadge {
  label: string
  /** Tailwind classes for text + background. */
  className: string
  /** History-row glyph; null for active jobs, which use a status dot. */
  glyph: string | null
  pulse: boolean
}

export function jobBadge(job: JobDto): JobBadge {
  if (isRecorder(job) && job.state === 'running') {
    return { label: 'RECORDING', className: 'text-accent bg-acc-14', glyph: null, pulse: true }
  }
  switch (job.state) {
    case 'running':
      return { label: 'RUNNING', className: 'text-accent bg-acc-10', glyph: null, pulse: true }
    case 'queued':
      return { label: 'QUEUED', className: 'text-t1b bg-track', glyph: null, pulse: false }
    case 'paused':
      return { label: 'PAUSED', className: 'text-t1b bg-track', glyph: null, pulse: false }
    case 'completed':
      return { label: 'DONE', className: 'text-success bg-success/10', glyph: '✓', pulse: false }
    case 'completed_with_failures':
      return { label: 'ISSUES', className: 'text-warning bg-warning/10', glyph: '!', pulse: false }
    case 'canceled':
      return { label: 'CANCELED', className: 'text-t2 bg-track', glyph: '×', pulse: false }
    case 'failed':
      // The mockup has no FAILED variant — a wholly failed job was not a state
      // the simulated fetcher could reach.
      return { label: 'FAILED', className: 'text-danger bg-danger/10', glyph: '×', pulse: false }
  }
}

/** Card title. Falls back to `name` for jobs with no recorded symbols. */
export function jobTitle(job: JobDto): string {
  return job.symbols.length > 0 ? job.symbols.join(' · ') : job.name
}

export interface JobTimes {
  rangeStart: Date | null
  rangeEnd: Date | null
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
}

/** ISO strings and epoch-ms fields, resolved in one place. */
export function jobTimes(job: JobDto): JobTimes {
  return {
    rangeStart: isoToDate(job.range_start),
    rangeEnd: isoToDate(job.range_end),
    createdAt: new Date(job.created_at),
    startedAt: msToDateOrNull(job.started_at),
    finishedAt: msToDateOrNull(job.finished_at),
  }
}

/** Seconds a job has been (or was) running. */
export function jobElapsedSeconds(job: JobDto, now: number = Date.now()): number | null {
  if (job.started_at === null) return null
  const end = job.finished_at ?? now
  return Math.max(0, (end - job.started_at) / 1000)
}

/**
 * Seconds remaining, from settled-chunk rate. Null when it cannot be known —
 * recorders are open-ended, and a job that has settled nothing has no rate.
 */
export function jobEtaSeconds(job: JobDto, now: number = Date.now()): number | null {
  if (isRecorder(job) || job.state !== 'running' || job.total_chunks <= 0) return null
  const elapsed = jobElapsedSeconds(job, now)
  if (!elapsed) return null
  const settled = job.done_chunks + job.empty_chunks + job.failed_chunks
  if (settled <= 0) return null
  const remaining = job.total_chunks - settled
  if (remaining <= 0) return 0
  return (remaining * elapsed) / settled
}

export interface JobPartition {
  queue: JobDto[]
  history: JobDto[]
}

/**
 * `GET /api/jobs?state=` matches a single exact value, so filtering
 * server-side would need one request per state. One unfiltered fetch, split
 * here instead.
 */
export function partitionJobs(jobs: JobDto[] | undefined): JobPartition {
  const queue: JobDto[] = []
  const history: JobDto[] = []
  for (const job of jobs ?? []) {
    ;(isActive(job.state) ? queue : history).push(job)
  }
  return { queue, history }
}
