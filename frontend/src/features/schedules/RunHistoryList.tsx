import type { JobDto } from '@/api/types'
import { Chip } from '@/components/ndm/Chip'
import { jobBadge, jobElapsedSeconds, jobTimes } from '@/domain/jobView'
import { cn } from '@/lib/cn'
import { fmtBytes, fmtDuration, fmtInt, fmtRows, fmtWeekdayClock } from '@/lib/format'

const GLYPH_COLOR: Record<string, string> = {
  DONE: 'text-success',
  ISSUES: 'text-warning',
  CANCELED: 'text-t3',
  FAILED: 'text-danger',
  RUNNING: 'text-accent',
  QUEUED: 'text-t3',
  PAUSED: 'text-t2',
}

/** Newest ten runs of a schedule. Clicking one opens it in the queue inspector. */
export function RunHistoryList({
  jobs,
  onOpenJob,
}: {
  jobs: JobDto[]
  onOpenJob: (jobId: string) => void
}) {
  if (jobs.length === 0) {
    return (
      <div className="text-105 text-t3 p-[10px] text-center">
        No runs yet — this schedule has not fired.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-[2px]">
      {jobs.slice(0, 10).map((job) => {
        const badge = jobBadge(job)
        const times = jobTimes(job)
        const meta = [
          fmtBytes(job.bytes_written),
          `${fmtRows(job.rows_written)} rows`,
          fmtDuration(jobElapsedSeconds(job)),
        ].join(' · ')

        return (
          <div
            key={job.id}
            onClick={() => onOpenJob(job.id)}
            title="Open this run in the queue inspector"
            className="hover:bg-panel rounded-7 flex cursor-pointer items-center gap-[9px] px-[8px] py-[7px]"
          >
            <span
              className={cn(
                'text-12 w-[12px] flex-none text-center font-mono font-bold',
                GLYPH_COLOR[badge.label],
              )}
            >
              {/* Active runs have no glyph — a dot stands in for them. */}
              {badge.glyph ?? '·'}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-105 text-t1b font-mono">
                {fmtWeekdayClock(times.startedAt ?? times.createdAt)}
              </div>
              <div className="text-95 text-t3 truncate font-mono">{meta}</div>
            </div>
            {job.failed_chunks > 0 && (
              <Chip tone="danger" className="text-9">
                {`${fmtInt(job.failed_chunks)} failed`}
              </Chip>
            )}
          </div>
        )
      })}
    </div>
  )
}
