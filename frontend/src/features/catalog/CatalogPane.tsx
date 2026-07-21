import { Layers } from 'lucide-react'
import { useMemo, useState } from 'react'

import { CATALOG_TYPE_LABEL, type CatalogType } from '@/api/enums'
import { useCatalogSummary } from '@/api/queries'
import { Chip } from '@/components/ndm/Chip'
import { EmptyState } from '@/components/ndm/EmptyState'
import { NautilusMark } from '@/components/ndm/NautilusMark'
import { SectionHeader, SectionTitle } from '@/components/ndm/SectionHeader'
import { Button } from '@/components/ui/button'
import { catalogRows, type CatalogSort } from '@/domain/catalogView'
import { cn } from '@/lib/cn'
import { useSelection } from '@/state/selectionContext'

import { CatalogTable } from './CatalogTable'
import { ConsolidateModal, type ConsolidateTarget } from './ConsolidateModal'
import { InstrumentDetailAside } from './InstrumentDetailAside'
import { TypeRail } from './TypeRail'

export function CatalogPane() {
  const { data: summary, isLoading, error } = useCatalogSummary()
  const { catalogType, setCatalogType, selectedIdentifier, selectIdentifier } = useSelection()
  const [sort, setSort] = useState<CatalogSort>('size')
  const [consolidating, setConsolidating] = useState<ConsolidateTarget | null>(null)

  const { rows, axis } = useMemo(
    () => catalogRows(summary, catalogType, sort),
    [summary, catalogType, sort],
  )
  const selectedRow = rows.find((row) => row.identifier === selectedIdentifier)
  const typeLabel = CATALOG_TYPE_LABEL[catalogType as CatalogType] ?? catalogType
  const typeFiles = rows.reduce((sum, row) => sum + row.files, 0)
  const allFiles =
    summary?.classes.reduce(
      (sum, entry) => sum + entry.identifiers.reduce((inner, row) => inner + row.files, 0),
      0,
    ) ?? 0

  return (
    <div className="grid min-h-0 grid-cols-[292px_minmax(0,1fr)_344px]">
      <TypeRail
        summary={summary}
        selected={catalogType}
        onSelect={(type) => {
          setCatalogType(type)
          // The identifier belongs to the old type; keeping it would highlight
          // a row that is not in the new list.
          selectIdentifier(null)
        }}
      />

      <main className="bg-page flex min-h-0 flex-col">
        <SectionHeader>
          <SectionTitle>{typeLabel}</SectionTitle>
          <Chip>{String(rows.length)}</Chip>
          <div className="flex-1" />

          <span className="text-10 text-t3">sort</span>
          <div className="border-b2 rounded-7 flex overflow-hidden border">
            {(['size', 'date'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setSort(option)}
                className={cn(
                  'border-b1 text-105 h-[26px] cursor-pointer border-r bg-transparent px-[11px] font-mono last:border-r-0',
                  sort === option ? 'text-accent' : 'text-t2 hover:text-t1b',
                )}
              >
                {option}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            disabled={typeFiles === 0}
            title="Merge small files across this data type"
            onClick={() =>
              setConsolidating({
                label: typeLabel,
                files: typeFiles,
                body: { data_type: catalogType },
              })
            }
          >
            <Layers size={12} strokeWidth={2} />
            Consolidate type
          </Button>
          <Button
            size="sm"
            disabled={allFiles === 0}
            onClick={() =>
              setConsolidating({ label: 'the whole catalog', files: allFiles, body: {} })
            }
          >
            Consolidate all
          </Button>
        </SectionHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-[14px] pt-[10px] pb-[20px]">
          {error && (
            <EmptyState
              title="Could not read the catalog"
              body={error.message}
              icon={<NautilusMark size={26} stroke="var(--ndm-danger)" className="mx-auto" />}
            />
          )}

          {!error && rows.length === 0 && !isLoading && (
            <EmptyState
              icon={<NautilusMark size={26} className="mx-auto opacity-85" />}
              title={`No ${typeLabel.toLowerCase()} written yet`}
              body="Completed jobs write Parquet here. Queue a job for this data type and it will show up once the first chunk lands."
            />
          )}

          {rows.length > 0 && (
            <CatalogTable rows={rows} selected={selectedIdentifier} onSelect={selectIdentifier} />
          )}
        </div>
      </main>

      <InstrumentDetailAside
        row={selectedRow}
        axis={axis}
        dataType={catalogType}
        catalogPath={summary?.path}
        onConsolidate={() =>
          selectedRow &&
          setConsolidating({
            label: selectedRow.identifier,
            files: selectedRow.files,
            body: { data_type: catalogType, identifier: selectedRow.identifier },
          })
        }
      />

      {consolidating && (
        <ConsolidateModal target={consolidating} onClose={() => setConsolidating(null)} />
      )}
    </div>
  )
}
