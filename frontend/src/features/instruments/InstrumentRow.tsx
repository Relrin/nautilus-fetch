import { cn } from '@/lib/cn'
import { CLASS_COLOR } from '@/domain/instrumentClass'

import type { InstrumentRowView } from './useInstrumentSearch'

interface InstrumentRowProps {
  row: InstrumentRowView
  selected: boolean
  onSelect: () => void
}

export function InstrumentRow({ row, selected, onSelect }: InstrumentRowProps) {
  const colors = CLASS_COLOR[row.cls]

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'rounded-7 hover:bg-panel flex w-full cursor-pointer items-center gap-[8px] px-[8px] py-[7px] text-left',
        // A 2px inset ring rather than a border, so the row does not shift.
        selected && 'bg-card shadow-[inset_2px_0_0_var(--ndm-accent)]',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="text-12 text-t1 block font-mono font-semibold">{row.symbol}</span>
        <span className="text-105 text-t2 block truncate">{row.description ?? row.secType}</span>
      </span>
      <span className="flex flex-none flex-col items-end gap-[3px]">
        <span
          className={cn(
            'text-9 rounded-4 px-[5px] py-[2px] font-semibold tracking-[0.5px]',
            colors.fg,
            colors.bg,
          )}
        >
          {row.cls}
        </span>
        {!row.cached && (
          <span
            className="text-85 text-t3 border-b2 rounded-4 border px-[4px] py-[1px] font-mono"
            title="Found via IB search; not yet cached on the server"
          >
            NEW
          </span>
        )}
      </span>
    </button>
  )
}
