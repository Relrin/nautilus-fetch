import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'

import { StatusDot } from '@/components/ndm/StatusDot'
import { cn } from '@/lib/cn'
import { useNow } from '@/lib/useNow'
import { useWs } from '@/ws/context'

/**
 * Transport state plus the manual refresh affordance, in one control.
 *
 * Separate from `ConnectionPill`, which reports the *IB gateway*. These are
 * genuinely different failures — the gateway can be down while our own socket
 * is perfectly healthy, and collapsing them would make an IB outage look like
 * a dead dashboard.
 *
 * The countdown exists because the backoff reaches 30s. Without it, a restart
 * of the backend looks like the UI has simply given up.
 */
export function LivePill() {
  const { status, nextAttemptAt, reconnectNow } = useWs()
  const queryClient = useQueryClient()
  const fetching = useIsFetching() > 0

  // Only tick while there is a countdown to run down.
  const now = useNow(1000, status !== 'open' && nextAttemptAt > 0)
  const retryIn = nextAttemptAt > 0 ? Math.max(0, Math.ceil((nextAttemptAt - now) / 1000)) : 0

  const refresh = () => {
    // Refetch what is on screen, and stop waiting out the backoff — someone
    // who just restarted the backend is telling us it is back.
    void queryClient.refetchQueries({ type: 'active' })
    reconnectNow()
  }

  const label =
    status === 'open'
      ? 'LIVE'
      : status === 'connecting'
        ? 'CONNECTING'
        : retryIn > 0
          ? `RETRY ${retryIn}s`
          : 'OFFLINE'

  const tone =
    status === 'open'
      ? { dot: 'var(--ndm-success)', text: 'text-t1b', border: 'border-b2' }
      : status === 'connecting'
        ? { dot: 'var(--ndm-t2)', text: 'text-t2', border: 'border-b2' }
        : { dot: 'var(--ndm-warning)', text: 'text-warning', border: 'border-warning/30' }

  return (
    <button
      type="button"
      onClick={refresh}
      title={
        status === 'open'
          ? 'Live updates are streaming. Click to refresh anyway.'
          : 'Live updates are down — the list is polling instead. Click to retry now.'
      }
      className={cn(
        'bg-card hover:border-b3 flex flex-none cursor-pointer items-center gap-[7px] rounded-full border px-[10px] py-[4.5px] transition-colors',
        tone.border,
      )}
    >
      <StatusDot color={tone.dot} pulse={status === 'open'} size={6} />
      <span className={cn('text-105 font-mono', tone.text)}>{label}</span>
      <RefreshCw
        size={11}
        strokeWidth={2.2}
        className={cn('text-t2', fetching && 'animate-spin')}
      />
    </button>
  )
}
