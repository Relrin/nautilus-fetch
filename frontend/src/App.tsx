import { useCallback, useState } from 'react'

import { useInstruments } from '@/api/queries'
import type { JobDto } from '@/api/types'
import { ToastHost } from '@/components/ndm/ToastHost'
import { classifyInstrument } from '@/domain/instrumentClass'
import { jobConIds } from '@/domain/jobView'
import { isBarSize } from '@/domain/kind'
import { CatalogPane } from '@/features/catalog/CatalogPane'
import { InspectorAside } from '@/features/inspector/InspectorAside'
import { InstrumentsAside } from '@/features/instruments/InstrumentsAside'
import { NewJobModal, type NewJobPrefill } from '@/features/newjob/NewJobModal'
import { QueuePane } from '@/features/queue/QueuePane'
import { SchedulesPane } from '@/features/schedules/SchedulesPane'
import { TopBar } from '@/features/topbar/TopBar'
import { SelectionProvider } from '@/state/selection'
import { useSelection } from '@/state/selectionContext'
import { ToastProvider } from '@/state/toasts'
import { WsProvider } from '@/ws/WsProvider'

export default function App() {
  return (
    <SelectionProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </SelectionProvider>
  )
}

function Shell() {
  const { page, selectedJobId } = useSelection()

  return (
    <WsProvider selectedJobId={selectedJobId}>
      <div className="text-13 grid h-screen min-w-[1280px] grid-rows-[50px_1fr] overflow-hidden">
        <TopBar />
        {page === 'queue' && <QueuePage />}
        {page === 'schedules' && <SchedulesPane />}
        {page === 'catalog' && <CatalogPane />}
      </div>
      <ToastHost />
    </WsProvider>
  )
}

function QueuePage() {
  const [modalOpen, setModalOpen] = useState(false)
  const [prefill, setPrefill] = useState<NewJobPrefill | null>(null)
  const { data: instruments } = useInstruments('', null)

  const openBlank = useCallback(() => {
    setPrefill(null)
    setModalOpen(true)
  }, [])

  const openForInstrument = useCallback(
    (conId: number) => {
      const match = instruments?.find((row) => row.con_id === conId)
      setPrefill({
        picked: [
          {
            conId,
            symbol: match?.symbol ?? String(conId),
            cls: match ? classifyInstrument(match.sec_type) : undefined,
          },
        ],
        state: { conIds: [conId] },
      })
      setModalOpen(true)
    },
    [instruments],
  )

  const openForRerun = useCallback(
    (job: JobDto) => {
      const conIds = jobConIds(job)
      setPrefill({
        picked: conIds.map((conId, index) => {
          const match = instruments?.find((row) => row.con_id === conId)
          return {
            conId,
            // `symbols` are instrument ids like `AAPL.SMART`; the ticker is enough
            // for a chip and the two arrays share job_symbols' ordinal ordering.
            symbol: job.symbols[index]?.split('.')[0] ?? String(conId),
            // Class comes from the cache when the instrument is known; forex
            // reruns then default to MIDPOINT like a fresh pick.
            cls: match ? classifyInstrument(match.sec_type) : undefined,
          }
        }),
        state: {
          conIds,
          dataType: job.data_type,
          barSize:
            job.params.bar_size && isBarSize(job.params.bar_size) ? job.params.bar_size : null,
          ...(job.params.what_to_show ? { whatToShow: job.params.what_to_show } : {}),
          ...(job.params.use_rth === undefined ? {} : { useRth: job.params.use_rth }),
          workers: job.workers,
          maxRetries: job.max_retries,
          ...(job.range_start ? { from: job.range_start.slice(0, 10) } : {}),
          ...(job.range_end ? { to: job.range_end.slice(0, 10) } : {}),
        },
      })
      setModalOpen(true)
    },
    [instruments],
  )

  return (
    <div className="grid min-h-0 grid-cols-[292px_minmax(0,1fr)_344px]">
      <InstrumentsAside onQueueJob={openForInstrument} />
      <QueuePane onNewJob={openBlank} onRerun={openForRerun} />
      <InspectorAside />
      {modalOpen && <NewJobModal onClose={() => setModalOpen(false)} prefill={prefill} />}
    </div>
  )
}
