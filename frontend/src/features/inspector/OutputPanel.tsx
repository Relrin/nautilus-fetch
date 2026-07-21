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
    <Panel title="OUTPUT" headerClassName="mb-[7px]">
      <div className="text-t1 text-105 font-mono break-all">{data?.path ?? '—'}</div>
      <div className="text-t2 text-10 mt-[3px] font-mono break-all">{CATALOG_FILE_PATTERN}</div>
    </Panel>
  )
}
