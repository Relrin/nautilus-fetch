import { CATALOG_TYPES, CATALOG_TYPE_LABEL, type CatalogType } from '@/api/enums'
import type { CatalogSummaryDto } from '@/api/types'
import { Eyebrow } from '@/components/ndm/Eyebrow'
import { SectionHeader } from '@/components/ndm/SectionHeader'
import { typeTotals } from '@/domain/catalogView'
import { cn } from '@/lib/cn'
import { fmtBytes, fmtInt } from '@/lib/format'

interface TypeRailProps {
  summary: CatalogSummaryDto | undefined
  selected: string
  onSelect: (dataType: string) => void
}

export function TypeRail({ summary, selected, onSelect }: TypeRailProps) {
  return (
    <aside className="border-b1 bg-bar flex min-h-0 flex-col border-r">
      <SectionHeader className="gap-[8px]">
        <Eyebrow variant="pane">DATA TYPES</Eyebrow>
      </SectionHeader>

      <div className="min-h-0 flex-1 overflow-y-auto p-[8px]">
        {/* All four types always, even at zero: an absent row reads as "this
            build cannot do depth", when it just has not written any yet. */}
        {CATALOG_TYPES.map((type: CatalogType) => {
          const totals = typeTotals(summary, type)
          const active = type === selected
          return (
            <button
              key={type}
              type="button"
              onClick={() => onSelect(type)}
              className={cn(
                'rounded-8 mb-[2px] block w-full cursor-pointer p-[10px] text-left',
                active ? 'bg-panel ring-acc-45 ring-1' : 'hover:bg-panel',
              )}
            >
              <div
                className={cn(
                  'text-12 mb-[4px] font-semibold',
                  active ? 'text-accent-txt' : 'text-t1b',
                )}
              >
                {CATALOG_TYPE_LABEL[type]}
              </div>
              <div className="text-10 text-t2 flex justify-between font-mono">
                <span>
                  {totals.identifiers === 0
                    ? 'empty'
                    : `${fmtInt(totals.identifiers)} · ${fmtInt(totals.files)} files`}
                </span>
                <span>{totals.bytes > 0 ? fmtBytes(totals.bytes) : '—'}</span>
              </div>
            </button>
          )
        })}
      </div>

      <div className="border-b1 bg-panel flex flex-none flex-col gap-[6px] border-t px-[14px] py-[12px]">
        <div className="text-t3 text-85 font-semibold tracking-[1px]">CATALOG ROOT</div>
        <div className="text-10 text-t1b font-mono break-all">{summary?.path ?? '—'}</div>
        <div className="mt-[4px] flex items-baseline justify-between">
          <span className="text-t3 text-85 font-semibold tracking-[1px]">TOTAL ON DISK</span>
          <span className="text-14 text-t1 font-mono font-bold">
            {fmtBytes(summary?.total_bytes ?? 0)}
          </span>
        </div>
      </div>
    </aside>
  )
}
