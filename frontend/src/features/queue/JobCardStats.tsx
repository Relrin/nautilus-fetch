import type { JobDto } from '@/api/types'
import { isRecorder, jobElapsedSeconds, jobEtaSeconds, jobProgress } from '@/domain/jobView'
import { fmtBytes, fmtDuration, fmtInt, fmtPct, fmtRows } from '@/lib/format'

/** The mono stats strip under a job's progress bar. */
export function JobCardStats({ job }: { job: JobDto }) {
  // A queued job has nothing to report yet; the mockup shows its position.
  if (job.state === 'queued') {
    return (
      <div className="text-t2 text-105 mt-[8px] font-mono">
        {`waiting for a worker slot · ${fmtInt(job.total_chunks)} chunks planned`}
      </div>
    )
  }

  const elapsed = jobElapsedSeconds(job)

  if (isRecorder(job)) {
    return (
      <div className="text-t2 text-105 mt-[8px] flex items-center gap-[12px] font-mono">
        <span className="text-t1 font-semibold">{`elapsed ${fmtDuration(elapsed)}`}</span>
        <span>{`${fmtRows(job.rows_written)} snapshots`}</span>
        <span>{fmtBytes(job.bytes_written)}</span>
        <span>{`${fmtInt(job.done_chunks)} segments`}</span>
      </div>
    )
  }

  const settled = job.done_chunks + job.empty_chunks + job.failed_chunks
  const eta = jobEtaSeconds(job)

  return (
    <div className="text-t2 text-105 mt-[8px] flex items-center gap-[12px] font-mono">
      <span className="text-t1 font-semibold">{fmtPct(jobProgress(job))}</span>
      <span>{`${fmtInt(settled)}/${fmtInt(job.total_chunks)} chunks`}</span>
      {job.failed_chunks > 0 && (
        <span className="text-danger">{`${fmtInt(job.failed_chunks)} failed`}</span>
      )}
      <span>{fmtBytes(job.bytes_written)}</span>
      <span>{`${fmtRows(job.rows_written)} rows`}</span>
      <div className="flex-1" />
      {eta !== null && <span className="text-t1b flex-none">{`ETA ${fmtDuration(eta)}`}</span>}
    </div>
  )
}
