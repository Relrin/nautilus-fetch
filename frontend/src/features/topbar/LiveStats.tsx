import { useCatalogSummary, useJobs, useSchedules } from '@/api/queries'
import { partitionJobs } from '@/domain/jobView'
import { fmtBytes, fmtInt } from '@/lib/format'
import { useSelection } from '@/state/selectionContext'

function startOfTodayMs(): number {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

/**
 * The top bar's stat line, which says something different on each page.
 *
 * The mockup's "1.48 GB today" had no backend equivalent, so it is computed
 * from jobs created since local midnight — real, exact, and already in cache.
 */
export function LiveStats() {
  const { page } = useSelection()
  const jobs = useJobs()
  const schedules = useSchedules()
  const catalog = useCatalogSummary()

  if (page === 'schedules') {
    const rows = schedules.data ?? []
    if (!schedules.data) return <Placeholder />
    const enabled = rows.filter((schedule) => schedule.enabled).length
    return (
      <Line>
        {`${rows.length} ${rows.length === 1 ? 'schedule' : 'schedules'} · ${enabled} enabled`}
      </Line>
    )
  }

  if (page === 'catalog') {
    if (!catalog.data) return <Placeholder />
    const identifiers = catalog.data.classes.flatMap((entry) => entry.identifiers)
    const files = identifiers.reduce((sum, entry) => sum + entry.files, 0)
    return (
      <Line>
        {`${identifiers.length} instruments · ${fmtInt(files)} files · ${fmtBytes(catalog.data.total_bytes)} on disk`}
      </Line>
    )
  }

  if (!jobs.data) return <Placeholder />
  const { queue } = partitionJobs(jobs.data)
  const running = queue.filter((job) => job.state === 'running').length
  const queued = queue.filter((job) => job.state === 'queued').length
  const since = startOfTodayMs()
  const todayBytes = jobs.data
    .filter((job) => job.created_at >= since)
    .reduce((sum, job) => sum + job.bytes_written, 0)

  return <Line>{`${running} running · ${queued} queued · ${fmtBytes(todayBytes)} today`}</Line>
}

const Line = ({ children }: { children: string }) => (
  <span className="text-t2 text-11 font-mono">{children}</span>
)

const Placeholder = () => <span className="text-t3 text-11 font-mono">…</span>
