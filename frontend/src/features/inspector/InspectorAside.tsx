import { useChunks, useJob, useThroughput } from '@/api/queries'
import { PaneEmptyState } from '@/components/ndm/EmptyState'
import { Eyebrow } from '@/components/ndm/Eyebrow'
import { NautilusMark } from '@/components/ndm/NautilusMark'
import { SectionHeader } from '@/components/ndm/SectionHeader'
import { isActive, isRecorder } from '@/domain/jobView'
import { useNow } from '@/lib/useNow'
import { useSelection } from '@/state/selectionContext'

import { ChunkMapPanel } from './ChunkMapPanel'
import { FailuresPanel } from './FailuresPanel'
import { InspectorIdentity } from './InspectorIdentity'
import { InspectorProgress } from './InspectorProgress'
import { OutputPanel } from './OutputPanel'
import { RecordingPanel } from './RecordingPanel'
import { StatTileGrid } from './StatTileGrid'
import { ThroughputPanel } from './ThroughputPanel'

/**
 * The right aside: everything known about the selected job.
 *
 * `chunks` and `throughput` are fetched here and nowhere else — they are the
 * two expensive per-job endpoints, and only the inspected job needs them.
 * `WsProvider` is told which job that is so the hub streams matching deltas.
 */
export function InspectorAside() {
  const { selectedJobId } = useSelection()
  const { data: job, error } = useJob(selectedJobId)
  const { data: chunks } = useChunks(selectedJobId)
  const { data: ring } = useThroughput(selectedJobId)

  // Terminal jobs have a fixed elapsed time; only tick while something moves.
  const now = useNow(1000, job !== undefined && isActive(job.state))

  return (
    <aside className="border-b1 bg-bar flex min-h-0 flex-col border-l">
      <SectionHeader>
        <Eyebrow variant="pane">INSPECTOR</Eyebrow>
      </SectionHeader>

      {!selectedJobId && (
        <PaneEmptyState
          icon={<NautilusMark size={22} className="opacity-70" />}
          title="No job selected"
          body="Pick a job to see chunk-level progress, throughput and failures."
        />
      )}

      {selectedJobId && error && (
        <PaneEmptyState
          icon={<NautilusMark size={22} stroke="var(--ndm-danger)" />}
          title="Could not load this job"
          body={error.message}
        />
      )}

      {job && (
        <div className="flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto px-[14px] pt-[12px] pb-[20px]">
          <InspectorIdentity job={job} />

          {isRecorder(job) ? (
            <RecordingPanel job={job} now={now} />
          ) : (
            <InspectorProgress job={job} now={now} />
          )}

          <StatTileGrid job={job} ring={ring} now={now} />
          <ThroughputPanel ring={ring} />
          <ChunkMapPanel buffer={chunks} recorder={isRecorder(job)} />

          {job.failed_chunks > 0 && <FailuresPanel job={job} />}

          <OutputPanel />
        </div>
      )}
    </aside>
  )
}
