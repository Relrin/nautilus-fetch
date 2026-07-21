import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { applyFrame, resync } from './applyFrame'
import { WsClient, type WsStatus } from './WsClient'
import { WsContext, type WsValue } from './context'

interface WsProviderProps {
  children: ReactNode
  /** The inspector's job — only it needs chunk and throughput detail. */
  selectedJobId: string | null
}

interface Transport {
  status: WsStatus
  nextAttemptAt: number
}

/**
 * Owns the app's single socket and publishes its state.
 *
 * The merge and re-sync logic lives in `applyFrame.ts` so it can be tested
 * without React — see `applyFrame.test.ts`, which pins the two corrections
 * that would otherwise fail silently.
 */
export function WsProvider({ children, selectedJobId }: WsProviderProps) {
  const queryClient = useQueryClient()
  const [transport, setTransport] = useState<Transport>({ status: 'closed', nextAttemptAt: 0 })
  const clientRef = useRef<WsClient | null>(null)

  // The socket outlives any particular selection, so the reconnect handler
  // reads the current job through a ref rather than closing over a stale one.
  const selectedRef = useRef(selectedJobId)
  useEffect(() => {
    selectedRef.current = selectedJobId
  }, [selectedJobId])

  useEffect(() => {
    const client = new WsClient(
      (frame) => applyFrame(queryClient, frame),
      () => resync(queryClient, selectedRef.current),
    )
    clientRef.current = client

    const unsubscribe = client.subscribe(() =>
      setTransport({ status: client.getStatus(), nextAttemptAt: client.getNextAttemptAt() }),
    )

    // A backgrounded tab should not make the NAS push frames it will never show.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') client.start()
    }
    document.addEventListener('visibilitychange', onVisibility)

    client.start()
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      unsubscribe()
      client.stop()
      clientRef.current = null
    }
  }, [queryClient])

  const reconnectNow = useCallback(() => clientRef.current?.reconnectNow(), [])

  const value = useMemo<WsValue>(() => ({ ...transport, reconnectNow }), [transport, reconnectNow])

  return <WsContext.Provider value={value}>{children}</WsContext.Provider>
}
