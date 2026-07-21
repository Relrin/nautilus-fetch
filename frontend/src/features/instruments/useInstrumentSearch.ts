import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

import { qk } from '@/api/keys'
import { searchInstruments } from '@/api/endpoints'
import { useInstruments } from '@/api/queries'
import type { ApiError } from '@/api/client'
import { classifyInstrument, type InstrumentClass } from '@/domain/instrumentClass'
import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_INTERVAL_MS } from '@/lib/constants'
import { SerialQueue, isSuperseded } from '@/lib/rateLimit'

export interface InstrumentRowView {
  conId: number
  symbol: string
  description: string | null
  secType: string
  exchange: string | null
  cls: InstrumentClass
  /** Already in the server's instrument table; false means search-only. */
  cached: boolean
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

export interface InstrumentSearchResult {
  rows: InstrumentRowView[]
  isSearching: boolean
  /** Set when IB is unreachable; the cached rows are still usable. */
  searchError: ApiError | null
  cachedCount: number
}

/**
 * The sidebar's data source: the server's cached instrument table, with live
 * IB search layered on top.
 *
 * The cached list answers instantly and works while the gateway is down. IB
 * search is debounced and funnelled through a single-flight queue, because the
 * backend's limiter is a lock+sleep — bursting does not error, it silently
 * queues, and every keystroke then resolves seconds late and out of order.
 */
export function useInstrumentSearch(
  query: string,
  cls: InstrumentClass | null,
): InstrumentSearchResult {
  const debouncedQuery = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS)
  const queue = useRef<SerialQueue | null>(null)
  queue.current ??= new SerialQueue(SEARCH_MIN_INTERVAL_MS)

  const cached = useInstruments(debouncedQuery, null)

  const search = useQuery({
    queryKey: qk.instrumentSearch(debouncedQuery, null),
    queryFn: ({ signal }) =>
      queue.current!.run((queueSignal) =>
        searchInstruments(debouncedQuery, undefined, AbortSignal.any([signal, queueSignal])),
      ),
    enabled: debouncedQuery.length >= 1,
    retry: false,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })

  const rows = useMemo(() => {
    const byConId = new Map<number, InstrumentRowView>()

    for (const row of cached.data ?? []) {
      byConId.set(row.con_id, {
        conId: row.con_id,
        symbol: row.symbol,
        description: row.description,
        secType: row.sec_type,
        exchange: row.primary_exchange ?? row.exchange,
        cls: classifyInstrument(row.sec_type),
        cached: true,
      })
    }

    // Search results fill in instruments we have never looked up. Cached rows
    // win on conflict — they carry exchange and instrument_id that search omits.
    for (const row of search.data ?? []) {
      if (byConId.has(row.con_id)) continue
      byConId.set(row.con_id, {
        conId: row.con_id,
        symbol: row.symbol,
        description: row.description,
        secType: row.sec_type,
        exchange: row.primary_exchange,
        cls: classifyInstrument(row.sec_type),
        cached: false,
      })
    }

    const all = [...byConId.values()]
    // Class filtering is client-side on purpose: the server's `sec_type` filter
    // also matches derivativeSecTypes, so sec_type=OPT returns underlying
    // stock rows rather than options.
    const filtered = cls ? all.filter((row) => row.cls === cls) : all

    return filtered.sort((a, b) => {
      if (a.cached !== b.cached) return a.cached ? -1 : 1
      return a.symbol.localeCompare(b.symbol)
    })
  }, [cached.data, search.data, cls])

  const error = search.error as ApiError | null
  return {
    rows,
    isSearching: search.isFetching,
    searchError: error && !isSuperseded(error) ? error : null,
    cachedCount: cached.data?.length ?? 0,
  }
}
