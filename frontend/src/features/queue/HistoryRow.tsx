import { RotateCw } from 'lucide-react'

import type { JobDto } from '@/api/types'
import { useRetryFailed } from '@/api/mutations'
import { Chip } from '@/components/ndm/Chip'
import { Button } from '@/components/ui/button'
import { jobBadge, jobConIds, jobElapsedSeconds, jobTimes, jobTitle } from '@/domain/jobView'
import { kindLabel } from '@/domain/kind'
import { cn } from '@/lib/cn'
import { fmtAgo, fmtBytes, fmtDate, fmtDuration } from '@/lib/format'
import { useToasts } from '@/state/toastsContext'

const GLYPH_COLOR: Record<string, string> = {
  DONE: 'text-success',
  ISSUES: 'text-warning',
  CANCELED: 'text-t3',
  FAILED: 'text-danger',
}

interface HistoryRowProps {
  job: JobDto
  selected: boolean
  onSelect: () => void
  onRerun: (job: JobDto) => void
}

export function HistoryRow({ job, selected, onSelect, onRerun }: HistoryRowProps) {
  const badge = jobBadge(job)
  const times = jobTimes(job)
  const retry = useRetryFailed()
  const { push } = useToasts()

  const meta = [
    `${fmtDate(times.rangeStart)} → ${fmtDate(times.rangeEnd)}`,
    `parquet/${kindLabel(job.data_type, job.params.bar_size)}`,
    fmtBytes(job.bytes_written),
    fmtDuration(jobElapsedSeconds(job)),
    fmtAgo(times.finishedAt ?? times.createdAt),
  ].join(' · ')

  return (
    <div
      onClick={onSelect}
      className={cn(
        'rounded-8 hover:bg-panel flex cursor-pointer items-center gap-[10px] px-[10px] py-[8px]',
        selected && 'bg-panel',
      )}
    >
      <span
        className={cn(
          'text-12 w-[14px] flex-none text-center font-mono font-bold',
          GLYPH_COLOR[badge.label],
        )}
      >
        {badge.glyph}
      </span>
      {/* One line, not two: the title sizes to its content and the meta run
          takes the remaining width and ellipsises. Stacking them doubled the
          row height and made the history list scan like a second queue. */}
      <span className="text-115 text-t1b flex-none font-mono font-semibold">{jobTitle(job)}</span>
      <span className="text-10 text-t2 min-w-0 flex-1 truncate font-mono" title={meta}>
        {meta}
      </span>

      {job.failed_chunks > 0 && <Chip tone="danger">{`${job.failed_chunks} failed`}</Chip>}

      {job.failed_chunks > 0 && (
        <Button
          variant="danger"
          size="tiny"
          title="Requeue the failed chunks on this job"
          onClick={(event) => {
            event.stopPropagation()
            retry.mutate(job.id, {
              onSuccess: () => push(`${job.failed_chunks} chunks returned to the queue`),
              onError: (error) => push(`Could not retry: ${error.message}`, 'danger'),
            })
          }}
        >
          Retry failed
        </Button>
      )}

      <Button
        variant="outline"
        size="tiny"
        // `con_ids` was added to job_dto for exactly this: they cannot be
        // recovered from the `symbols` strings.
        disabled={jobConIds(job).length === 0}
        title={
          jobConIds(job).length === 0
            ? 'This job predates instrument tracking, so it cannot be re-run'
            : 'Open the new-job form prefilled from this job'
        }
        onClick={(event) => {
          event.stopPropagation()
          onRerun(job)
        }}
      >
        <RotateCw size={10} strokeWidth={2.4} />
        Re-run
      </Button>
    </div>
  )
}
