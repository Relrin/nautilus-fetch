/**
 * Derived schedule state.
 *
 * The status badge is **not** a stored field — the backend has `enabled` and
 * nothing else. Health comes from how the schedule's most recent job ended,
 * which means it is only as fresh as the job list.
 */
import { TERMINAL_JOB_STATES, type JobState } from '@/api/enums'
import type { InstrumentDto, JobDto, ScheduleDto } from '@/api/types'

/**
 * The schedule's jobs, newest first.
 *
 * `schedule_id` was added to `job_dto` in Phase 0 precisely so this could be a
 * client-side filter instead of a per-schedule endpoint.
 */
export function scheduleJobs(jobs: JobDto[] | undefined, scheduleId: string): JobDto[] {
  return (jobs ?? [])
    .filter((job) => job.schedule_id === scheduleId)
    .sort((a, b) => b.created_at - a.created_at)
}

const UNHEALTHY: readonly JobState[] = ['completed_with_failures', 'failed']

/**
 * Whether the last *finished* run went badly.
 *
 * Deliberately skips jobs still running or queued: a schedule whose newest job
 * is mid-flight has not failed, and flagging it NEEDS ATTENTION every night
 * while it works would train the badge to be ignored.
 */
export function scheduleBroken(jobs: JobDto[]): boolean {
  const lastFinished = jobs.find((job) => TERMINAL_JOB_STATES.includes(job.state))
  return lastFinished !== undefined && UNHEALTHY.includes(lastFinished.state)
}

export interface ScheduleBadge {
  label: string
  /** Tailwind text + background classes. */
  className: string
  /** The card's 3px left edge — a CSS colour, not a class. */
  edge: string
}

export function scheduleBadge(schedule: ScheduleDto, jobs: JobDto[]): ScheduleBadge {
  if (!schedule.enabled) {
    return { label: 'DISABLED', className: 'text-t2 bg-track', edge: 'var(--ndm-b2)' }
  }
  if (scheduleBroken(jobs)) {
    return {
      label: 'NEEDS ATTENTION',
      className: 'text-danger bg-danger/10',
      edge: 'var(--ndm-danger)',
    }
  }
  return { label: 'ACTIVE', className: 'text-success bg-success/10', edge: 'var(--ndm-accent)' }
}

/** Outcome dot beside "last run". Null when the schedule has never fired. */
export function lastRunTone(jobs: JobDto[]): string | null {
  const last = jobs.at(0)
  if (!last) return null
  switch (last.state) {
    case 'completed':
      return 'var(--ndm-success)'
    case 'completed_with_failures':
      return 'var(--ndm-warning)'
    case 'failed':
      return 'var(--ndm-danger)'
    case 'canceled':
      return 'var(--ndm-b3)'
    default:
      return 'var(--ndm-accent)'
  }
}

/**
 * `AAPL · MSFT · NVDA`, or `AAPL · MSFT +6` past three.
 *
 * The card has one line for this and long lists would push the timing readouts
 * off the row, so it truncates by count rather than by ellipsis.
 */
export function symbolSummary(names: string[]): string {
  if (names.length === 0) return 'no instruments'
  if (names.length <= 3) return names.join(' · ')
  return `${names.slice(0, 2).join(' · ')} +${names.length - 2}`
}

/**
 * Resolve a template's con_ids to tickers using the cached instrument table.
 *
 * `ScheduleTemplate` stores con_ids only. Instruments missing from the cache
 * fall back to the raw id — wrong-looking, but honest, and it still identifies
 * the row.
 */
export function symbolsForConIds(
  conIds: number[],
  instruments: InstrumentDto[] | undefined,
): string[] {
  const bySymbol = new Map((instruments ?? []).map((row) => [row.con_id, row.symbol]))
  return conIds.map((conId) => bySymbol.get(conId) ?? String(conId))
}

/** `4w · 3r · lag 15m` — the template's execution settings in one chip. */
export const templateSummary = (schedule: ScheduleDto): string =>
  `${schedule.template.workers ?? 4}w · ${schedule.template.max_retries}r · lag ${schedule.template.lag_minutes}m`
