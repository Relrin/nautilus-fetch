import { useCatalogSummary } from '@/api/queries'
import { Panel } from '@/components/ndm/Panel'
import { CATALOG_FILE_PATTERN } from '@/lib/constants'

/**
 * Where the job's data lands.
 *
 * Both values are read-only server configuration: the catalog root comes from
 * `/api/catalog/summary` and the naming pattern is fixed by `CatalogWriter`.
 * There is no per-job override, so editable fields here would be a lie.
 */
export function OutputPanel() {
  const { data } = useCatalogSummary()

  return (
    <Panel title="OUTPUT">
      <Row label="CATALOG ROOT" value={data?.path ?? '—'} />
      <Row label="NAMING" value={CATALOG_FILE_PATTERN} className="mt-[7px]" />
    </Panel>
  )
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <div className="text-t3 text-8 mb-[2px] font-semibold tracking-[1px]">{label}</div>
      <div className="text-t1b text-98 font-mono break-all">{value}</div>
    </div>
  )
}
