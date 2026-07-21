import { useState } from 'react'

import { useCatalogSummary, useHealth, useIbStatus, useJobs } from '@/api/queries'
import { partitionJobs } from '@/domain/jobView'
import { fmtBytes } from '@/lib/format'
import { useWsStatus } from '@/ws/context'
import { WsProvider } from '@/ws/WsProvider'


export default function App() {
  const [selectedJobId] = useState<string | null>(null)

  return (
    <WsProvider selectedJobId={selectedJobId}>
      <Shell />
    </WsProvider>
  )
}

function Shell() {
  return (
    <div className="text-13 grid h-screen min-w-[1280px] grid-rows-[50px_1fr] overflow-hidden">
      <header className="border-b1 bg-bar flex items-center gap-[14px] border-b px-[14px]">
        <div className="flex items-center gap-[9px]">
          <svg width="19" height="19" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <circle cx="9" cy="9" r="7.5" stroke="var(--ndm-accent)" strokeWidth="1.5" />
            <path
              d="M9 1.5 A7.5 7.5 0 0 1 16.5 9"
              stroke="var(--ndm-accent)"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
          <span className="text-14 font-semibold tracking-[0.3px]">
            NAUTILUS <span className="text-t2 font-normal">DATA</span>
          </span>
        </div>
        <ConnectivityProbe />
      </header>

      <div className="grid min-h-0 grid-cols-[292px_minmax(0,1fr)_344px]">
        <aside className="border-b1 bg-bar flex min-h-0 flex-col border-r" />
        <main className="bg-page flex min-h-0 flex-col" />
        <aside className="border-b1 bg-bar flex min-h-0 flex-col border-l" />
      </div>
    </div>
  )
}

function ConnectivityProbe() {
  const health = useHealth()
  const ib = useIbStatus()
  const jobs = useJobs()
  const catalog = useCatalogSummary()
  const wsStatus = useWsStatus()

  const { queue, history } = partitionJobs(jobs.data)

  return (
    <span data-testid="probe" className="text-t2 text-11 font-mono">
      {`health=${(health.data?.status ?? health.error) ? (health.data?.status ?? 'err') : '…'}`}
      {` · ib=${ib.data?.state ?? '…'}`}
      {` · ws=${wsStatus}`}
      {` · jobs=${jobs.data ? `${queue.length}q/${history.length}h` : '…'}`}
      {` · catalog=${catalog.data ? fmtBytes(catalog.data.total_bytes) : '…'}`}
    </span>
  )
}
