import { createContext, useContext } from 'react'

export const PAGES = ['queue', 'schedules', 'catalog'] as const
export type Page = (typeof PAGES)[number]

export interface SelectionValue {
  page: Page
  setPage: (page: Page) => void
  selectedJobId: string | null
  selectJob: (jobId: string | null) => void
  selectedConId: number | null
  selectInstrument: (conId: number | null) => void
  selectedScheduleId: string | null
  selectSchedule: (id: string | null) => void
  catalogType: string
  setCatalogType: (type: string) => void
  selectedIdentifier: string | null
  selectIdentifier: (identifier: string | null) => void
  /** Jump to a page and focus a job in one step (e.g. schedule "Run now"). */
  openJob: (jobId: string) => void
}

export const SelectionContext = createContext<SelectionValue | null>(null)

export function useSelection(): SelectionValue {
  const value = useContext(SelectionContext)
  if (!value) throw new Error('useSelection must be used inside SelectionProvider')
  return value
}
