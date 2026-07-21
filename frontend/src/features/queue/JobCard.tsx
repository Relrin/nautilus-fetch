import { Pause, Play, Square, X } from 'lucide-react'

import type { JobDto } from '@/api/types'
import { useCancelJob, usePauseJob, useResumeJob, useStopRecorder } from '@/api/mutations'
import { NdmBadge } from '@/components/ndm/Badge'
import { Chip } from '@/components/ndm/Chip'
import { IndeterminateBar, ProgressBar } from '@/components/ndm/ProgressBar'
import { StatusDot } from '@/components/ndm/StatusDot'
import { Button } from '@/components/ui/button'
import { formatChipLabel } from '@/domain/kind'
import {
  isRecorder,
  jobBadge,
  jobFailedFraction,
  jobProgress,
  jobTimes,
  jobTitle,
} from '@/domain/jobView'
import { cn } from '@/lib/cn'
import { fmtDate } from '@/lib/format'
import { useToasts } from '@/state/toastsContext'

import { JobCardStats } from './JobCardStats'

const DOT_COLOR: Record<string, string> = {
  RUNNING: 'var(--ndm-accent)',
  RECORDING: 'var(--ndm-accent)',
  QUEUED: 'var(--ndm-t3)',
  PAUSED: 'var(--ndm-t2)',
  DONE: 'var(--ndm-success)',
  ISSUES: 'var(--ndm-warning)',
  CANCELED: 'var(--ndm-b3)',
  FAILED: 'var(--ndm-danger)',
}

interface JobCardProps {
  job: JobDto
  selected: boolean
  onSelect: () => void
}

export function JobCard({ job, selected, onSelect }: JobCardProps) {
  const badge = jobBadge(job)
  const times = jobTimes(job)
  const recorder = isRecorder(job)
  const { push } = useToasts()

  const pause = usePauseJob()
  const resume = useResumeJob()
  const cancel = useCancelJob()
  const stop = useStopRecorder()

  // The backend answers 409 for an invalid transition (pausing a job that just
  // finished, say), which is normal rather than exceptional — surface it plainly.
  const act = (mutation: typeof pause, verb: string) => (event: React.MouseEvent) => {
    event.stopPropagation()
    mutation.mutate(job.id, {
      onError: (error: Error) => push(`Could not ${verb}: ${error.message}`, 'danger'),
    })
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'bg-card rounded-10 hover:border-b3 w-full cursor-pointer border p-[11px_13px] text-left transition-colors',
        selected ? 'border-acc-45' : 'border-b1',
      )}
    >
      <div className="flex items-center gap-[9px]">
        <StatusDot color={DOT_COLOR[badge.label] ?? 'var(--ndm-t3)'} pulse={badge.pulse} />
        <NdmBadge label={badge.label} className={badge.className} />
        <span className="text-125 text-t1 truncate font-mono font-semibold">{jobTitle(job)}</span>

        {/* The mockup's note slot. `schedule_id` is the one note we can source
            truthfully — it marks a job a recurring rule created, not a person. */}
        {job.schedule_id !== null && (
          <Chip tone="muted" title="Created by a schedule">
            scheduled
          </Chip>
        )}

        <div className="flex-1" />

        <span className="text-10 text-t2 flex-none font-mono">
          {recorder
            ? `since ${fmtDate(times.rangeStart)}`
            : `${fmtDate(times.rangeStart)} → ${fmtDate(times.rangeEnd)}`}
        </span>
        <Chip tone="track">{formatChipLabel(job.data_type, job.params)}</Chip>

        {/* Stop is DEPTH-only and is the SAFE finish: it flushes buffers and
            keeps the data. Cancel aborts. The API makes them look alike. */}
        {recorder && job.state === 'running' && (
          <Button
            variant="ghost"
            size="icon"
            title="Stop recording — flushes buffers and keeps the data"
            onClick={act(stop, 'stop recording')}
            asChild={false}
          >
            <Square size={11} strokeWidth={2.4} />
          </Button>
        )}
        {job.state === 'running' && (
          <Button variant="ghost" size="icon" title="Pause job" onClick={act(pause, 'pause')}>
            <Pause size={12} strokeWidth={2.4} />
          </Button>
        )}
        {job.state === 'paused' && (
          <Button variant="ghost" size="icon" title="Resume job" onClick={act(resume, 'resume')}>
            <Play size={12} strokeWidth={2.4} />
          </Button>
        )}
        <Button
          variant="ghostDanger"
          size="icon"
          title={recorder ? 'Cancel — aborts without flushing' : 'Cancel job'}
          onClick={act(cancel, 'cancel')}
        >
          <X size={12} strokeWidth={2.4} />
        </Button>
      </div>

      <div className="mt-[9px]">
        {recorder ? (
          <IndeterminateBar paused={job.state === 'paused'} />
        ) : (
          <ProgressBar
            value={jobProgress(job)}
            failed={jobFailedFraction(job)}
            tone={job.state === 'paused' ? 'paused' : 'active'}
          />
        )}
      </div>

      <JobCardStats job={job} />
    </button>
  )
}
