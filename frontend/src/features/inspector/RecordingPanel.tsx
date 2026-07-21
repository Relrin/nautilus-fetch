import { Square } from 'lucide-react'

import { useStopRecorder } from '@/api/mutations'
import { isoToDate } from '@/api/normalize'
import type { CaptureWindowDto, JobDto } from '@/api/types'
import { Panel } from '@/components/ndm/Panel'
import { StatusDot } from '@/components/ndm/StatusDot'
import { Button } from '@/components/ui/button'
import { jobElapsedSeconds } from '@/domain/jobView'
import { fmtClock, fmtDateTime } from '@/lib/format'
import { useToasts } from '@/state/toastsContext'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * Replaces the progress block for DEPTH recorders.
 *
 * A recorder has no meaningful percentage — `recorder.py` bumps `done` and
 * `total` together on every buffer flush, so its `progress` reads 1.0 for the
 * entire life of the capture. An elapsed clock is the honest headline, and it
 * has to be ticked client-side because nothing arrives between flushes.
 */
export function RecordingPanel({ job, now }: { job: JobDto; now: number }) {
  const stop = useStopRecorder()
  const { push } = useToasts()
  const elapsed = jobElapsedSeconds(job, now)
  const live = job.state === 'running'
  const window = job.params.capture_window ?? null

  return (
    <Panel>
      <div className="flex items-center gap-[8px]">
        {live && <StatusDot color="var(--ndm-accent)" pulse />}
        <span className="text-24 text-t1 flex-none font-mono leading-none font-semibold tabular-nums">
          {fmtClock(elapsed ?? 0)}
        </span>
        <div className="flex-1" />
        <span className="text-t2 text-105 min-w-0 truncate font-mono">
          {live ? 'recording' : job.state}
        </span>
      </div>

      <dl className="mt-[11px] flex flex-col gap-[5px]">
        <Field label="until" value={fmtDateTime(isoToDate(job.params.capture_until))} />
        {window && <Field label="window" value={describeWindow(window)} />}
      </dl>

      {live && (
        <Button
          variant="outline"
          size="block"
          className="mt-[10px]"
          disabled={stop.isPending}
          // Not `danger`: unlike Cancel, this is the SAFE finish. It flushes
          // buffered segments and keeps everything captured so far.
          title="Flushes buffered segments and completes the job — data is kept"
          onClick={() =>
            stop.mutate(job.id, {
              onSuccess: () => push('Recorder stopping — buffers are being flushed'),
              onError: (error) => push(`Could not stop: ${error.message}`, 'danger'),
            })
          }
        >
          <Square size={11} strokeWidth={2.4} />
          Stop recording
        </Button>
      )}
    </Panel>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-[8px]">
      <dt className="text-t3 text-95 w-[46px] flex-none font-mono">{label}</dt>
      <dd className="text-t1b text-105 m-0 font-mono">{value}</dd>
    </div>
  )
}

function describeWindow(window: CaptureWindowDto): string {
  const days = [...window.days].sort((a, b) => a - b)
  const labels = days.map((day) => DAYS[day] ?? '?')
  const span =
    days.length === 7
      ? 'daily'
      : // Contiguous runs are the common case (Mon–Fri) and read far better
        // than five comma-separated names in a 344px column.
        days.length > 2 && days.every((day, i) => i === 0 || day === (days[i - 1] ?? 0) + 1)
        ? `${labels.at(0)}–${labels.at(-1)}`
        : labels.join(' ')

  return `${window.start}–${window.end} ${window.tz} · ${span}`
}
