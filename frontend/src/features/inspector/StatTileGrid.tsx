import type { JobDto } from '@/api/types'
import { StatTile } from '@/components/ndm/StatTile'
import { isRecorder, jobElapsedSeconds } from '@/domain/jobView'
import type { TpRing } from '@/domain/throughput'
import { fmtBytes, fmtDuration, fmtInt, fmtRate, fmtRows } from '@/lib/format'

interface StatTileGridProps {
  job: JobDto
  ring: TpRing | undefined
  now: number
}

/** The six-tile summary. Recorders relabel the first two columns. */
export function StatTileGrid({ job, ring, now }: StatTileGridProps) {
  const latest = ring?.latest() ?? null
  const recorder = isRecorder(job)
  const settled = job.done_chunks + job.empty_chunks + job.failed_chunks

  return (
    <div className="grid grid-cols-3 gap-[9px]">
      {recorder ? (
        <>
          <StatTile
            label="SEGMENTS"
            value={fmtInt(job.done_chunks)}
            title="Buffered segments flushed to parquet, roughly one per five minutes"
          />
          {/* `chunks.gap_warning` is recorded in the database but no endpoint
              exposes it, so a number here would be invented. */}
          <StatTile label="GAPS" value="—" title="Not exposed by the API yet" />
        </>
      ) : (
        <>
          {/* Two lines: `8,024/12,480` is twelve characters and a tile is only
              ~74px wide, so one line would either wrap or shrink the headline
              number to 9.5px. The total belongs here, just not inline. */}
          <StatTile
            label="CHUNKS"
            value={fmtInt(settled)}
            sub={`of ${fmtInt(job.total_chunks)}`}
            title="Settled (done + empty + failed) out of planned"
          />
          <StatTile
            label="FAILED"
            value={fmtInt(job.failed_chunks)}
            tone={job.failed_chunks > 0 ? 'danger' : 'default'}
          />
        </>
      )}

      <StatTile label="DOWNLOADED" value={fmtBytes(job.bytes_written)} />
      <StatTile label="SPEED" value={fmtRate(latest?.bytesPerSec)} />
      <StatTile label="ROWS / S" value={latest ? fmtRows(latest.rowsPerSec) : '—'} />
      <StatTile label="ELAPSED" value={fmtDuration(jobElapsedSeconds(job, now))} />
    </div>
  )
}
