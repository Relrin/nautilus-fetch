import { X } from 'lucide-react'
import { useRef, useState } from 'react'

import { CLASS_COLOR, type InstrumentClass } from '@/domain/instrumentClass'
import {
  useInstrumentSearch,
  type InstrumentRowView,
} from '@/features/instruments/useInstrumentSearch'
import { cn } from '@/lib/cn'
import { MAX_CON_IDS } from '@/lib/constants'

export interface PickedInstrument {
  conId: number
  symbol: string
  /** Asset class, when known at pick time — drives forex-aware form defaults. */
  cls?: InstrumentClass | undefined
}

interface InstrumentMultiSelectProps {
  picked: PickedInstrument[]
  onChange: (next: PickedInstrument[]) => void
}

/**
 * Chip list plus a typeahead.
 *
 * Reuses the sidebar's `useInstrumentSearch`, which debounces and funnels IB
 * lookups through a single-flight queue — the server's limiter is a lock+sleep,
 * so bursting silently queues rather than erroring.
 */
export function InstrumentMultiSelect({ picked, onChange }: InstrumentMultiSelectProps) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { rows, isSearching, searchError } = useInstrumentSearch(query, null)
  const chosen = new Set(picked.map((row) => row.conId))
  const suggestions = rows.filter((row) => !chosen.has(row.conId)).slice(0, 8)
  const open = focused && query.trim().length > 0

  const add = (row: InstrumentRowView) => {
    if (picked.length >= MAX_CON_IDS) return
    onChange([...picked, { conId: row.conId, symbol: row.symbol, cls: row.cls }])
    setQuery('')
  }

  const remove = (conId: number) => onChange(picked.filter((row) => row.conId !== conId))

  return (
    <div className="relative">
      <div className="bg-panel border-b2 rounded-8 flex min-h-[38px] flex-wrap items-center gap-[5px] border p-[6px]">
        {picked.map((row) => (
          <span
            key={row.conId}
            className="text-105 text-accent bg-acc-10 border-acc-30 rounded-5 flex items-center gap-[5px] border py-[3px] pr-[4px] pl-[8px] font-mono font-semibold"
          >
            {row.symbol}
            <button
              type="button"
              title="Remove"
              onClick={() => remove(row.conId)}
              className="text-accent hover:bg-acc-25 rounded-4 flex h-[15px] w-[15px] cursor-pointer items-center justify-center border-none bg-transparent p-0"
            >
              <X size={9} strokeWidth={3} />
            </button>
          </span>
        ))}
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current)
            setFocused(true)
          }}
          // Deferred so a click on a suggestion lands before the list unmounts.
          onBlur={() => {
            blurTimer.current = setTimeout(() => setFocused(false), 120)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && suggestions[0]) {
              event.preventDefault()
              add(suggestions[0])
            }
            if (event.key === 'Backspace' && query === '' && picked.length > 0) {
              remove(picked[picked.length - 1]!.conId)
            }
          }}
          placeholder={picked.length === 0 ? 'Search a ticker — AAPL, ES, EURUSD…' : 'Add another…'}
          className="text-11 text-t1 min-w-[110px] flex-1 border-none bg-transparent px-[4px] py-[2px] font-mono outline-none"
        />
      </div>

      {open && (
        <div className="bg-track border-b3 rounded-8 absolute top-[calc(100%+4px)] right-0 left-0 z-10 overflow-hidden border shadow-[0_12px_32px_rgba(0,0,0,.5)]">
          {suggestions.map((row) => (
            <div
              key={row.conId}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => add(row)}
              className="hover:bg-b2 flex cursor-pointer items-center gap-[9px] px-[11px] py-[7px]"
            >
              <span className="text-11 text-t1 font-mono font-semibold">{row.symbol}</span>
              <span className="text-10 text-t2 min-w-0 flex-1 truncate">
                {row.description ?? row.secType}
              </span>
              <span
                className={cn(
                  'text-9 rounded-4 px-[5px] py-[2px] font-semibold tracking-[0.5px]',
                  CLASS_COLOR[row.cls].fg,
                  CLASS_COLOR[row.cls].bg,
                )}
              >
                {row.cls}
              </span>
            </div>
          ))}

          {suggestions.length === 0 && (
            <div className="text-105 text-t3 px-[11px] py-[9px]">
              {isSearching
                ? 'Searching IB…'
                : searchError
                  ? // The cached table still answers; say which half is down.
                    'IB search is unavailable — only already-cached instruments are listed.'
                  : 'No match — try a ticker like EURUSD or ES'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
