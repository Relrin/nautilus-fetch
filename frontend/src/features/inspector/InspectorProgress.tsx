import type { JobDto } from '@/api/types'
import { ProgressBar } from '@/components/ndm/ProgressBar'
import { jobEtaSeconds, jobFailedFraction, jobProgress, jobTimes } from '@/domain/jobView'
import { fmtAgo, fmtDuration, fmtPct } from '@/lib/format'

/**
 * The headline percentage.
 *
 * `jobProgress()` recomputes from the counters rather than reading
 * `job.progress`, which the WebSocket hub never emits — rendering the wire
 * field here would pin this number at whatever the first GET returned and it
 * would never move again. This is the most visible place that bug would show.
 *
 * Deliberately unpanelled: it is the aside's headline, not one of the bordered
 * sub-panels below it. The settled/total count lives in the CHUNKS stat tile
 * rather than being repeated here.
 */
export function InspectorProgress({ job, now }: { job: JobDto; now: number }) {
  const progress = jobProgress(job)
  const eta = jobEtaSeconds(job, now)

  const tone =
    job.state === 'paused'
      ? 'paused'
      : job.state === 'completed' || job.state === 'completed_with_failures'
        ? 'done'
        : 'active'

  return (
    <div>
      <div className="mb-[6px] flex items-baseline justify-between gap-[8px]">
        <span className="text-24 text-t1 flex-none font-mono leading-none font-bold tabular-nums">
          {job.total_chunks > 0 ? fmtPct(progress) : '—'}
        </span>
        {/* min-w-0 is what lets `truncate` actually engage inside a flex row —
            without it the caption keeps its intrinsic width and shoves the
            percentage out of the column. */}
        <span className="text-t2 text-105 min-w-0 truncate font-mono">
          {caption(job, eta, now)}
        </span>
      </div>

      <ProgressBar value={progress} failed={jobFailedFraction(job)} size="inspector" tone={tone} />
    </div>
  )
}

function caption(job: JobDto, eta: number | null, now: number): string {
  switch (job.state) {
    case 'queued':
      return 'waiting for a worker slot'
    case 'paused':
      return 'paused'
    case 'running':
      return eta === null ? 'estimating…' : `ETA ${fmtDuration(eta)}`
    default:
      return `finished ${fmtAgo(jobTimes(job).finishedAt, now)}`
  }
}
