import { Database, Layers } from 'lucide-react'

import { CATALOG_TYPE_LABEL, type CatalogType } from '@/api/enums'
import { PaneEmptyState } from '@/components/ndm/EmptyState'
import { Eyebrow } from '@/components/ndm/Eyebrow'
import { Panel } from '@/components/ndm/Panel'
import { SectionHeader } from '@/components/ndm/SectionHeader'
import { Button } from '@/components/ui/button'
import {
  averageFileBytes,
  catalogDay,
  type CatalogAxis,
  type CatalogRowView,
} from '@/domain/catalogView'
import { CATALOG_FILE_PATTERN } from '@/lib/constants'
import { fmtBytes, fmtInt } from '@/lib/format'

import { CoverageStrip } from './CoverageStrip'

interface InstrumentDetailAsideProps {
  row: CatalogRowView | undefined
  axis: CatalogAxis | null
  dataType: string
  catalogPath: string | undefined
  onConsolidate: () => void
}

export function InstrumentDetailAside({
  row,
  axis,
  dataType,
  catalogPath,
  onConsolidate,
}: InstrumentDetailAsideProps) {
  return (
    <aside className="border-b1 bg-bar flex min-h-0 flex-col border-l">
      <SectionHeader className="gap-[8px]">
        <Eyebrow variant="pane">INSTRUMENT</Eyebrow>
      </SectionHeader>

      {!row ? (
        <PaneEmptyState
          icon={<Database size={22} strokeWidth={1.8} className="text-b3" />}
          title="Select an instrument"
          body="Coverage, size and file breakdown show up here."
        />
      ) : (
        <div className="animate-ndm-fade flex min-h-0 flex-1 flex-col gap-[12px] overflow-y-auto px-[14px] pt-[13px] pb-[20px]">
          <div>
            <div className="text-12 text-t1 mb-[4px] font-mono font-bold break-all">
              {row.identifier}
            </div>
            <div className="text-105 text-t2">
              {CATALOG_TYPE_LABEL[dataType as CatalogType] ?? dataType}
            </div>
          </div>

          <div className="flex items-baseline gap-[10px]">
            <span className="text-24 text-t1 font-mono font-bold">{fmtBytes(row.bytes)}</span>
            <span className="text-105 text-t2 font-mono">{`${fmtInt(row.files)} files`}</span>
          </div>

          <Panel title="COVERAGE" caption="outer bounds · gaps normal">
            <CoverageStrip offset={row.offset} width={row.width} height={12} className="mb-[4px]" />
            <div className="text-85 text-t3 flex justify-between font-mono">
              {(axis?.ticks ?? []).map((tick) => (
                <span key={tick}>{tick}</span>
              ))}
            </div>
          </Panel>

          <Panel>
            <div className="flex flex-col gap-[8px]">
              <Row label="earliest" value={catalogDay(row.start) ?? '—'} />
              <Row label="latest" value={catalogDay(row.end) ?? '—'} />
              <Row label="avg file" value={fmtBytes(averageFileBytes(row))} />
            </div>
          </Panel>

          <Panel title="PATH" headerClassName="mb-[7px]">
            <div className="text-10 text-t1b font-mono break-all">
              {`${catalogPath ?? ''}/${CATALOG_FILE_PATTERN.replace('{type}', dataType).replace('{instrument_id}', row.identifier)}`}
            </div>
          </Panel>

          <Button variant="outline" size="md" onClick={onConsolidate}>
            <Layers size={12} strokeWidth={2} />
            Consolidate this instrument
          </Button>
        </div>
      )}
    </aside>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-105 flex justify-between gap-[10px] font-mono">
      <span className="text-t3">{label}</span>
      <span className="text-t1 text-right break-all">{value}</span>
    </div>
  )
}
