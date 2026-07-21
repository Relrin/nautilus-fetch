import type { JobDto } from '@/api/types'
import { NdmBadge } from '@/components/ndm/Badge'
import { Chip } from '@/components/ndm/Chip'
import { isRecorder, jobBadge, jobTimes, jobTitle } from '@/domain/jobView'
import { kindLabel } from '@/domain/kind'
import { fmtDate, fmtDateTime } from '@/lib/format'

/** Title, status badge, range line and the job's configuration chips. */
export function InspectorIdentity({ job }: { job: JobDto }) {
  const badge = jobBadge(job)
  const times = jobTimes(job)
  const recorder = isRecorder(job)

  return (
    <section>
      <div className="flex items-center gap-[8px]">
        <span
          className="text-13 text-t1 min-w-0 flex-1 truncate font-mono font-bold"
          title={jobTitle(job)}
        >
          {jobTitle(job)}
        </span>
        <NdmBadge label={badge.label} className={badge.className} />
      </div>

      <div className="text-t2 text-105 mt-[5px] font-mono">
        {recorder
          ? // A recorder has no end: `range_end` is null and stays null.
            `capturing since ${fmtDateTime(times.startedAt ?? times.rangeStart)}`
          : `${fmtDate(times.rangeStart)} → ${fmtDate(times.rangeEnd)}`}
      </div>

      <div className="mt-[8px] flex flex-wrap gap-[5px]">
        {/* Spelled out, not `4w` / `3r`. The aside has room for words and the
            abbreviations were only legible to whoever wrote them. */}
        <Chip tone="config" title="Output format">
          parquet
        </Chip>
        <Chip tone="config">{kindLabel(job.data_type, job.params.bar_size)}</Chip>
        {job.params.what_to_show && <Chip tone="config">{job.params.what_to_show}</Chip>}
        {recorder && job.params.depth_levels !== undefined && (
          <Chip tone="config" title="Order book levels per side">
            {`${job.params.depth_levels} levels`}
          </Chip>
        )}
        {recorder && job.params.snapshot_interval_ms !== undefined && (
          <Chip tone="config" title="Snapshot interval">
            {`${job.params.snapshot_interval_ms} ms`}
          </Chip>
        )}
        {job.params.use_rth !== undefined && (
          <Chip
            tone="config"
            title={
              job.params.use_rth
                ? 'Regular trading hours only'
                : 'Includes extended / overnight sessions'
            }
          >
            {job.params.use_rth ? 'RTH only' : 'all hours'}
          </Chip>
        )}
        {/* Recorders run a single subscription per instrument — a worker count
            would be meaningless, and retries do not apply to a live stream. */}
        {!recorder && (
          <>
            <Chip tone="config" title="Max retries per chunk">{`retries ${job.max_retries}`}</Chip>
            <Chip tone="config" title="Parallel workers">
              {`${job.workers} ${job.workers === 1 ? 'worker' : 'workers'}`}
            </Chip>
          </>
        )}
        {/* The mockup's cadence chip. `schedule_id` is the truthful equivalent:
            a job either came from a recurring rule or it did not. */}
        {job.schedule_id !== null && (
          <Chip tone="config" title="Created by a schedule">
            scheduled
          </Chip>
        )}
      </div>
    </section>
  )
}
