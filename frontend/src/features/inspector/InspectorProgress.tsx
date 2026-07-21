import type { JobDto } from '@/api/types'
import { Panel } from '@/components/ndm/Panel'
import { ProgressBar } from '@/components/ndm/ProgressBar'
import { jobEtaSeconds, jobFailedFraction, jobProgress, jobTimes } from '@/domain/jobView'
import { fmtAgo, fmtDuration, fmtInt, fmtPct } from '@/lib/format'

/**
 * The headline percentage.
 *
 * `jobProgress()` recomputes from the counters rather than reading
 * `job.progress`, which the WebSocket hub never emits — rendering the wire
 * field here would pin this number at whatever the first GET returned and it
 * would never move again. This is the most visible place that bug would show.
 */
export function InspectorProgress({ job, now }: { job: JobDto; now: number }) {
  const progress = jobProgress(job)
  const eta = jobEtaSeconds(job, now)
  const settled = job.done_chunks + job.empty_chunks + job.failed_chunks

  const tone =
    job.state === 'paused'
      ? 'paused'
      : job.state === 'completed' || job.state === 'completed_with_failures'
        ? 'done'
        : 'active'

  return (
    <Panel>
      <div className="flex items-baseline justify-between gap-[8px]">
        <span className="text-24 text-t1 font-mono leading-none font-semibold tabular-nums">
          {job.total_chunks > 0 ? fmtPct(progress) : '—'}
        </span>
        <span className="text-t2 text-105 truncate font-mono">{caption(job, eta, now)}</span>
      </div>

      <ProgressBar
        value={progress}
        failed={jobFailedFraction(job)}
        size="inspector"
        tone={tone}
        className="mt-[10px]"
      />

      <div className="text-t3 text-95 mt-[7px] font-mono">
        {job.total_chunks > 0
          ? `${fmtInt(settled)} / ${fmtInt(job.total_chunks)} chunks settled`
          : 'waiting for the planner'}
      </div>
    </Panel>
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
