import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { TERMINAL_JOB_STATES } from '@/api/enums'
import { qk } from '@/api/keys'
import { tpFromWs } from '@/api/normalize'
import type { JobDto } from '@/api/types'
import type { ChunkBuffer } from '@/domain/chunkMap'
import type { TpRing } from '@/domain/throughput'

import { WsClient, type WsStatus } from './WsClient'
import { WsStatusContext } from './context'
import type { WsFrame } from './protocol'

interface WsProviderProps {
  children: ReactNode
  /** The inspector's job — only it needs chunk and throughput detail. */
  selectedJobId: string | null
}

export function WsProvider({ children, selectedJobId }: WsProviderProps) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<WsStatus>('closed')

  // The socket outlives any particular selection, so the reconnect handler
  // reads the current job through a ref rather than closing over a stale one.
  const selectedRef = useRef(selectedJobId)
  useEffect(() => {
    selectedRef.current = selectedJobId
  }, [selectedJobId])

  useEffect(() => {
    const handleFrame = (frame: WsFrame) => {
      switch (frame.t) {
        case 'job': {
          const { id, patch } = frame
          // Safe as a shallow merge ONLY because JobPatch is typed to the six
          // fields the hub can emit. If it ever carried `progress`, this would
          // overwrite a fresh value with a stale one.
          queryClient.setQueryData<JobDto[]>(qk.jobs, (list) =>
            list?.map((job) => (job.id === id ? { ...job, ...patch } : job)),
          )
          queryClient.setQueryData<JobDto>(qk.job(id), (job) => (job ? { ...job, ...patch } : job))
          // A terminal state moves the job between queue and history and sets
          // `finished_at` — neither of which is in the patch.
          if (patch.state && TERMINAL_JOB_STATES.includes(patch.state)) {
            void queryClient.invalidateQueries({ queryKey: qk.jobs })
            void queryClient.invalidateQueries({ queryKey: qk.failures(id) })
          }
          break
        }

        case 'chunks': {
          // Dropped when we hold no buffer for this job: selecting it later
          // fetches the authoritative full set from REST anyway.
          queryClient.setQueryData<ChunkBuffer>(qk.chunks(frame.job), (buffer) =>
            buffer?.applyDelta(frame.cells),
          )
          break
        }

        case 'tp': {
          queryClient.setQueryData<TpRing>(qk.throughput(frame.job), (ring) =>
            ring?.push(tpFromWs(frame)),
          )
          break
        }
      }
    }

    const handleOpen = () => {
      // Everything that happened while disconnected was missed. `chunks` and
      // `throughput` are staleTime:Infinity, so they need refetch — invalidate
      // alone would never refire them.
      void queryClient.invalidateQueries({ queryKey: qk.jobs })
      void queryClient.invalidateQueries({ queryKey: qk.ibStatus })
      const jobId = selectedRef.current
      if (jobId) {
        void queryClient.invalidateQueries({ queryKey: qk.job(jobId) })
        void queryClient.invalidateQueries({ queryKey: qk.failures(jobId) })
        void queryClient.refetchQueries({ queryKey: qk.chunks(jobId) })
        void queryClient.refetchQueries({ queryKey: qk.throughput(jobId) })
      }
    }

    const client = new WsClient(handleFrame, handleOpen)
    const unsubscribe = client.subscribe(() => setStatus(client.getStatus()))

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
    }
  }, [queryClient])

  return <WsStatusContext.Provider value={status}>{children}</WsStatusContext.Provider>
}
