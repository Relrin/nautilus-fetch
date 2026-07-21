import { useIbStatus } from '@/api/queries'
import { StatusDot } from '@/components/ndm/StatusDot'
import { secToDate } from '@/api/normalize'
import { fmtAgo } from '@/lib/format'
import type { ConnState } from '@/api/enums'

interface Presentation {
  color: string
  pulse: boolean
  border: string
  background: string
  text: string
}

const PRESENTATION: Record<ConnState, Presentation> = {
  connected: {
    color: 'var(--ndm-accent)',
    pulse: true,
    border: 'border-acc-30',
    background: 'bg-pill',
    text: 'text-accent-txt',
  },
  // Degraded means IB sent a data-farm warning without dropping the socket —
  // requests may fail even though we are technically connected.
  degraded: {
    color: 'var(--ndm-warning)',
    pulse: true,
    border: 'border-warning/30',
    background: 'bg-warning/10',
    text: 'text-warning',
  },
  connecting: {
    color: 'var(--ndm-t2)',
    pulse: false,
    border: 'border-b2',
    background: 'bg-card',
    text: 'text-t2',
  },
  disconnected: {
    color: 'var(--ndm-danger)',
    pulse: false,
    border: 'border-danger/30',
    background: 'bg-danger/10',
    text: 'text-danger',
  },
}

export function ConnectionPill() {
  const { data, isLoading } = useIbStatus()

  if (isLoading || !data) {
    return (
      <span className="border-b2 bg-card text-t3 text-105 flex items-center gap-[7px] rounded-full border px-[11px] py-[4.5px] font-mono">
        <StatusDot color="var(--ndm-t3)" />
        IB GW · …
      </span>
    )
  }

  const style = PRESENTATION[data.state]
  const since = secToDate(data.connected_since)
  const title =
    data.state === 'connected'
      ? `Connected since ${fmtAgo(since)}`
      : (data.last_error ?? `IB gateway is ${data.state}`)

  return (
    <span
      title={title}
      className={`${style.border} ${style.background} flex items-center gap-[7px] rounded-full border px-[11px] py-[4.5px]`}
    >
      <StatusDot color={style.color} pulse={style.pulse} />
      <span className={`text-105 font-mono ${style.text}`}>
        {`IB GW · ${data.host}:${data.port}`}
        {data.state !== 'connected' && data.state !== 'degraded' ? ` · ${data.state}` : ''}
      </span>
    </span>
  )
}
