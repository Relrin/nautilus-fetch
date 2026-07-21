import { PlugZap, Search } from 'lucide-react'
import { useState } from 'react'

import type { InstrumentClass } from '@/domain/instrumentClass'
import { useSelection } from '@/state/selectionContext'

import { ClassFilterChips } from './ClassFilterChips'
import { InstrumentDetailFooter } from './InstrumentDetailFooter'
import { InstrumentRow } from './InstrumentRow'
import { useInstrumentSearch } from './useInstrumentSearch'

interface InstrumentsAsideProps {
  onQueueJob: (conId: number) => void
}

export function InstrumentsAside({ onQueueJob }: InstrumentsAsideProps) {
  const [query, setQuery] = useState('')
  const [cls, setCls] = useState<InstrumentClass | null>(null)
  const { selectedConId, selectInstrument } = useSelection()
  const { rows, isSearching, searchError, cachedCount } = useInstrumentSearch(query, cls)

  return (
    <aside className="border-b1 bg-bar flex min-h-0 flex-col border-r">
      <div className="flex flex-none flex-col gap-[8px] px-[10px] pt-[10px] pb-[8px]">
        <label className="bg-panel border-b2 rounded-8 flex h-[34px] items-center gap-[8px] border px-[10px]">
          <Search size={13} strokeWidth={2} className="text-t2 flex-none" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${cachedCount || ''} instruments…`.replace('  ', ' ')}
            className="text-115 text-t1 min-w-0 flex-1 border-none bg-transparent p-0 font-mono outline-none"
          />
          {isSearching && <span className="text-t3 text-9 flex-none font-mono">IB…</span>}
        </label>
        <ClassFilterChips value={cls} onChange={setCls} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-[6px] pb-[6px]">
        {searchError ? <SearchError message={searchError.detail} /> : null}
        {rows.length === 0 && !searchError ? <NoResults query={query} /> : null}
        {rows.map((row) => (
          <InstrumentRow
            key={row.conId}
            row={row}
            selected={row.conId === selectedConId}
            onSelect={() => selectInstrument(row.conId)}
          />
        ))}
      </div>

      {selectedConId !== null && (
        <InstrumentDetailFooter
          conId={selectedConId}
          onQueueJob={() => onQueueJob(selectedConId)}
        />
      )}
    </aside>
  )
}

/**
 * IB being down is a persistent condition, not a transient event — it belongs
 * inline where the missing results would be, not in a toast that disappears.
 */
function SearchError({ message }: { message: string }) {
  return (
    <div className="border-danger/25 bg-danger/5 rounded-8 m-[6px] border p-[12px] text-center">
      <PlugZap size={18} strokeWidth={1.8} className="text-danger mx-auto mb-[6px]" />
      <div className="text-t1b text-105 mb-[4px]">IB search unavailable</div>
      <div className="text-t3 text-10 leading-[1.5]">{message}</div>
      <div className="text-t3 text-10 mt-[6px]">Cached instruments are still listed.</div>
    </div>
  )
}

function NoResults({ query }: { query: string }) {
  return (
    <div className="text-t3 text-11 px-[12px] py-[22px] text-center">
      {query ? `No instruments match "${query}"` : 'No instruments cached yet — search to add one.'}
    </div>
  )
}
