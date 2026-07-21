import { Download } from 'lucide-react'

import { useInstrument } from '@/api/queries'
import { nsToDate } from '@/api/normalize'
import { Button } from '@/components/ui/button'
import { maySupportDepth } from '@/domain/instrumentClass'
import { formatSessions } from '@/domain/sessions'
import { fmtDate } from '@/lib/format'

interface InstrumentDetailFooterProps {
  conId: number
  onQueueJob: () => void
}

/** Pinned detail panel for the selected instrument. */
export function InstrumentDetailFooter({ conId, onQueueJob }: InstrumentDetailFooterProps) {
  const { data, isLoading, error } = useInstrument(conId)

  if (isLoading || !data) {
    return (
      <div className="border-b1 bg-panel text-t3 text-105 flex-none border-t p-[12px]">
        {error ? 'Contract details unavailable' : 'Loading contract details…'}
      </div>
    )
  }

  const details = data.details
  const head = nsToDate(data.head_timestamp_ns)

  return (
    <div className="border-b1 bg-panel animate-ndm-fade flex-none border-t p-[12px]">
      <div className="mb-[10px] flex items-baseline gap-[8px]">
        <span className="text-13 text-t1 font-mono font-bold">{data.symbol}</span>
        <span className="text-105 text-t2 truncate">{data.description ?? data.sec_type}</span>
      </div>

      <div className="mb-[10px] grid grid-cols-2 gap-x-[12px] gap-y-[8px]">
        <Field label="VENUE" value={data.primary_exchange ?? data.exchange ?? '—'} />
        {/* Replaces the mockup's MARKET DATA badges: con_id is real and useful
            for debugging, whereas an L2 entitlement badge would be a guess. */}
        <Field label="CON ID" value={String(data.con_id)} />
        <Field
          label="HISTORY FROM"
          value={head ? fmtDate(head) : '—'}
          title={head ? undefined : 'Learned when a job first plans this instrument'}
        />
        <Field label="CURRENCY" value={data.currency ?? '—'} />
        <div className="col-span-2">
          <Field
            label="SESSIONS"
            value={formatSessions(
              details?.liquidHours ?? details?.tradingHours,
              details?.timeZoneId,
            )}
          />
        </div>
      </div>

      <div className="mb-[10px] flex items-center gap-[5px]">
        <Capability label="L1" available />
        <Capability label="L2" available={maySupportDepth(data.sec_type)} />
      </div>

      <Button size="block" onClick={onQueueJob}>
        <Download size={12} strokeWidth={2.4} />
        Queue dataset job
      </Button>
    </div>
  )
}

function Field({
  label,
  value,
  title,
}: {
  label: string
  value: string
  title?: string | undefined
}) {
  return (
    <div title={title}>
      <div className="text-t3 text-85 mb-[2px] font-semibold tracking-[1px]">{label}</div>
      <div className="text-115 text-t1 truncate font-mono">{value}</div>
    </div>
  )
}

/**
 * Capability hint, not an entitlement. IB only reveals whether depth is
 * actually permitted by rejecting a live subscription, so `L2` here means
 * "this instrument type can have depth", never "your account may stream it".
 */
function Capability({ label, available }: { label: string; available: boolean }) {
  return (
    <span
      title={
        available
          ? 'Depth may be available; a recorder reports the real answer'
          : 'Depth is not offered for this instrument type'
      }
      className={
        available
          ? 'text-accent border-acc-30 bg-acc-10 text-9 rounded-4 border px-[6px] py-[2px] font-mono font-bold'
          : 'text-t3 border-b2 text-9 rounded-4 border px-[6px] py-[2px] font-mono font-bold'
      }
    >
      {label}
    </span>
  )
}
