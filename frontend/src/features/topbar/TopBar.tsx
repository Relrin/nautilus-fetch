import { Folder } from 'lucide-react'

import { useCatalogSummary, useHealth } from '@/api/queries'
import { Chip } from '@/components/ndm/Chip'
import { NautilusMark } from '@/components/ndm/NautilusMark'
import { fmtBytes } from '@/lib/format'

import { ConnectionPill } from './ConnectionPill'
import { LiveStats } from './LiveStats'
import { TabStrip } from './TabStrip'

export function TopBar() {
  const health = useHealth()
  const catalog = useCatalogSummary()

  return (
    <header className="border-b1 bg-bar flex items-center gap-[14px] border-b px-[14px]">
      <div className="flex flex-none items-center gap-[9px]">
        <NautilusMark />
        <span className="text-14 font-semibold tracking-[0.3px]">
          NAUTILUS <span className="text-t2 font-normal">DATA</span>
        </span>
        {health.data ? <Chip>{`v${health.data.version}`}</Chip> : null}
      </div>

      <TabStrip />
      <LiveStats />

      <div className="flex-1" />

      {catalog.data ? (
        <>
          <Chip
            tone="config"
            className="text-105 text-t1b rounded-6 gap-[6px] px-[9px] py-[4px]"
            title="Parquet catalog root"
          >
            <Folder size={12} strokeWidth={2} className="text-t2" />
            {catalog.data.path}
          </Chip>
          {/* The mockup showed free disk space; no endpoint exposes that, and
              catalog size is the number this app's user actually wants. */}
          <span className="text-t2 text-105 flex-none font-mono">
            {`${fmtBytes(catalog.data.total_bytes)} catalog`}
          </span>
        </>
      ) : null}

      <ConnectionPill />
    </header>
  )
}
