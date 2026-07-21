import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { PAGES, SelectionContext, type Page, type SelectionValue } from './selectionContext'

const isPage = (value: string | null): value is Page =>
  value !== null && (PAGES as readonly string[]).includes(value)

function readInitial(): { page: Page; jobId: string | null } {
  const params = new URLSearchParams(window.location.search)
  const page = params.get('page')
  return { page: isPage(page) ? page : 'queue', jobId: params.get('job') }
}

/**
 * Page and selection state.
 *
 * Deliberately not a path-based router: `StaticFiles(html=True)` does not do
 * SPA fallback, so `/schedules` would 404 on a hard refresh in production.
 * Query parameters do not affect static resolution, so state lives there.
 */
export function SelectionProvider({ children }: { children: ReactNode }) {
  const [page, setPageState] = useState<Page>(() => readInitial().page)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(() => readInitial().jobId)
  const [selectedConId, setSelectedConId] = useState<number | null>(null)
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null)
  const [catalogType, setCatalogType] = useState<string>('bar')
  const [selectedIdentifier, setSelectedIdentifier] = useState<string | null>(null)

  // Mirror to the URL so a reload or a shared link lands in the same place.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (page === 'queue') params.delete('page')
    else params.set('page', page)
    if (selectedJobId) params.set('job', selectedJobId)
    else params.delete('job')

    const query = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
  }, [page, selectedJobId])

  const setPage = useCallback((next: Page) => setPageState(next), [])
  const selectJob = useCallback((jobId: string | null) => setSelectedJobId(jobId), [])
  const openJob = useCallback((jobId: string) => {
    setPageState('queue')
    setSelectedJobId(jobId)
  }, [])

  const value = useMemo<SelectionValue>(
    () => ({
      page,
      setPage,
      selectedJobId,
      selectJob,
      selectedConId,
      selectInstrument: setSelectedConId,
      selectedScheduleId,
      selectSchedule: setSelectedScheduleId,
      catalogType,
      setCatalogType,
      selectedIdentifier,
      selectIdentifier: setSelectedIdentifier,
      openJob,
    }),
    [
      page,
      setPage,
      selectedJobId,
      selectJob,
      selectedConId,
      selectedScheduleId,
      catalogType,
      selectedIdentifier,
      openJob,
    ],
  )

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}
