import { catalogDay, type CatalogRowView } from '@/domain/catalogView'
import { cn } from '@/lib/cn'
import { fmtBytes, fmtInt } from '@/lib/format'

import { CoverageStrip } from './CoverageStrip'

/** Shared by the header and every row, so the columns cannot drift apart. */
const GRID = 'grid grid-cols-[minmax(0,1fr)_74px_92px_224px] gap-[12px]'

interface CatalogTableProps {
  rows: CatalogRowView[]
  selected: string | null
  onSelect: (identifier: string) => void
}

/**
 * A CSS grid, not a `<table>`.
 *
 * Rows are individually bordered cards that can be selected, which a table row
 * cannot express without fighting border-collapse.
 */
export function CatalogTable({ rows, selected, onSelect }: CatalogTableProps) {
  return (
    <>
      <div
        className={cn(
          GRID,
          'text-9 text-t3 px-[12px] pb-[8px] font-mono font-semibold tracking-[0.8px]',
        )}
      >
        <span>IDENTIFIER</span>
        <span className="text-right">FILES</span>
        <span className="text-right">SIZE</span>
        <span>COVERAGE</span>
      </div>

      <div className="flex flex-col gap-[4px]">
        {rows.map((row) => (
          <div
            key={row.identifier}
            onClick={() => onSelect(row.identifier)}
            className={cn(
              GRID,
              'bg-card rounded-8 hover:border-b3 cursor-pointer items-center border px-[12px] py-[9px]',
              row.identifier === selected ? 'border-acc-45' : 'border-b1',
            )}
          >
            <span
              className="text-11 text-t1 truncate font-mono font-semibold"
              title={row.identifier}
            >
              {row.identifier}
            </span>
            <span className="text-105 text-t2 text-right font-mono">{fmtInt(row.files)}</span>
            <span className="text-105 text-t1b text-right font-mono">{fmtBytes(row.bytes)}</span>
            <div className="flex flex-col gap-[3px]">
              <CoverageStrip offset={row.offset} width={row.width} />
              {/* `catalogDay`, not the raw field: a real catalog's bounds read
                  `2023-10-26T07-30-50-123456789Z`, which does not fit here. */}
              <div className="text-85 text-t3 flex justify-between font-mono">
                <span>{catalogDay(row.start) ?? '—'}</span>
                <span>{catalogDay(row.end) ?? '—'}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
