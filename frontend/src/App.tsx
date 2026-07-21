import { ToastHost } from '@/components/ndm/ToastHost'
import { InstrumentsAside } from '@/features/instruments/InstrumentsAside'
import { QueuePane } from '@/features/queue/QueuePane'
import { TopBar } from '@/features/topbar/TopBar'
import { useToasts } from '@/state/toastsContext'
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
        {page === 'schedules' && <SchedulesPlaceholder />}
        {page === 'catalog' && <CatalogPlaceholder />}
      </div>
      <ToastHost />
    </WsProvider>
  )
}

function QueuePage() {
  const { push } = useToasts()
  const notYet = () => push('The new-job form arrives in the next phase', 'neutral')

  return (
    <div className="grid min-h-0 grid-cols-[292px_minmax(0,1fr)_344px]">
      <InstrumentsAside onQueueJob={notYet} />
      <QueuePane onNewJob={notYet} />
      {/* Phase 5 fills this with the inspector. */}
      <aside className="border-b1 bg-bar flex min-h-0 flex-col border-l" />
    </div>
  )
}

function SchedulesPlaceholder() {
  return (
    <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_344px]">
      <main className="bg-page flex min-h-0 flex-col" />
      <aside className="border-b1 bg-bar flex min-h-0 flex-col border-l" />
    </div>
  )
}

function CatalogPlaceholder() {
  return (
    <div className="grid min-h-0 grid-cols-[292px_minmax(0,1fr)_344px]">
      <aside className="border-b1 bg-bar flex min-h-0 flex-col border-r" />
      <main className="bg-page flex min-h-0 flex-col" />
      <aside className="border-b1 bg-bar flex min-h-0 flex-col border-l" />
    </div>
  )
}
