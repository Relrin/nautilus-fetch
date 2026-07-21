import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'

import { useJobs } from '@/api/queries'
import { Chip } from '@/components/ndm/Chip'
import { EmptyState } from '@/components/ndm/EmptyState'
import { NautilusMark } from '@/components/ndm/NautilusMark'
import { SectionHeader, SectionTitle } from '@/components/ndm/SectionHeader'
import { Button } from '@/components/ui/button'
import { partitionJobs } from '@/domain/jobView'
import { MAX_WORKERS } from '@/lib/constants'
import { useSelection } from '@/state/selectionContext'

import { HistoryRow } from './HistoryRow'
import { JobCard } from './JobCard'

const HIDDEN_BEFORE_KEY = 'ndm.history.hiddenBefore'

interface QueuePaneProps {
  onNewJob: () => void
}

export function QueuePane({ onNewJob }: QueuePaneProps) {
  const { data, isLoading, error } = useJobs()
  const { selectedJobId, selectJob } = useSelection()
  const [hiddenBefore, setHiddenBefore] = useState<number>(() =>
    Number(localStorage.getItem(HIDDEN_BEFORE_KEY) ?? 0),
  )

  const { queue, history } = useMemo(() => partitionJobs(data), [data])
  const hasCached = (data?.length ?? 0) > 0
  const visibleHistory = useMemo(
    () => history.filter((job) => job.created_at > hiddenBefore),
    [history, hiddenBefore],
  )

  const hideHistory = () => {
    const now = Date.now()
    localStorage.setItem(HIDDEN_BEFORE_KEY, String(now))
    setHiddenBefore(now)
  }

  return (
    <main className="bg-page flex min-h-0 flex-col">
      <SectionHeader>
        <SectionTitle>Dataset queue</SectionTitle>
        <Chip>{String(queue.length)}</Chip>
        <div className="flex-1" />
        {/* Read-only: `config.max_workers` has no write endpoint, and the
            engine silently clamps per-job workers to it. An editable stepper
            here would do nothing. */}
        <span
          className="text-t2 text-105"
          title="Server-side cap (max_workers). Per-job workers are set in the job form."
        >
          max workers
        </span>
        <Chip>{String(MAX_WORKERS)}</Chip>
        <div className="bg-b2 h-[18px] w-px" />
        <Button size="sm" onClick={onNewJob}>
          <Plus size={12} strokeWidth={2.6} />
          New job
        </Button>
      </SectionHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-[14px] pt-[12px] pb-[20px]">
        {/* An outage with jobs still in cache is a different situation from one
            with nothing to show. Announcing "could not load jobs" above four
            visible job cards trains the reader to distrust the banner. */}
        {error && !hasCached ? (
          <EmptyState
            title="Could not load jobs"
            body={error.message}
            icon={<NautilusMark size={26} stroke="var(--ndm-danger)" className="mx-auto" />}
          />
        ) : null}

        {error && hasCached ? (
          <div
            title={error.message}
            className="border-warning/30 bg-warning/5 text-warning text-105 rounded-10 mb-[10px] border px-[11px] py-[8px] font-mono"
          >
            Backend unreachable — showing the last known state, not live data.
          </div>
        ) : null}

        {!error && queue.length === 0 && !isLoading ? (
          <EmptyState
            icon={<NautilusMark size={26} className="mx-auto opacity-85" />}
            title="No dataset jobs yet"
            body="Pick an instrument on the left, choose data kind and range, and the fetcher will pull history from IB Gateway chunk by chunk into the parquet catalog."
            action={
              <Button size="md" onClick={onNewJob}>
                Create your first job
              </Button>
            }
            className="mb-[16px]"
          />
        ) : null}

        <div className="flex flex-col gap-[9px]">
          {queue.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              selected={job.id === selectedJobId}
              onSelect={() => selectJob(job.id)}
            />
          ))}
        </div>

        <div className="mt-[20px] mb-[10px] flex items-center gap-[10px]">
          <SectionTitle>History</SectionTitle>
          <Chip>{String(visibleHistory.length)}</Chip>
          <div className="flex-1" />
          {visibleHistory.length > 0 && (
            <Button
              variant="outline"
              size="xs"
              onClick={hideHistory}
              // There is no delete endpoint. Calling this "Clear" would imply
              // data loss that does not happen.
              title="Hides completed jobs from this view; nothing is deleted"
            >
              Hide
            </Button>
          )}
        </div>

        {visibleHistory.length === 0 ? (
          <EmptyState variant="inline" title="Completed and cancelled jobs land here." />
        ) : (
          <div className="flex flex-col gap-[2px]">
            {visibleHistory.map((job) => (
              <HistoryRow
                key={job.id}
                job={job}
                selected={job.id === selectedJobId}
                onSelect={() => selectJob(job.id)}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
