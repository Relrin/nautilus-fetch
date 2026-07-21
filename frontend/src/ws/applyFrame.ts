import type { QueryClient } from '@tanstack/react-query'

import { TERMINAL_JOB_STATES } from '@/api/enums'
import { qk } from '@/api/keys'
import { tpFromWs } from '@/api/normalize'
import type { JobDto } from '@/api/types'
import type { ChunkBuffer } from '@/domain/chunkMap'
import type { TpRing } from '@/domain/throughput'

import type { WsFrame } from './protocol'

/**
 * Merge one advisory frame into the cache.
 *
 * Extracted from `WsProvider` so it can be tested without React: this is where
 * corrections #1 and #3 either hold or silently break, and neither failure is
 * visible from a screenshot — a frozen percentage and a 4.9%-wrong MB/s both
 * look entirely plausible.
 */
export function applyFrame(queryClient: QueryClient, frame: WsFrame): void {
  switch (frame.t) {
    case 'job': {
      const { id, patch } = frame
      // Safe as a shallow merge ONLY because JobPatch is typed to the six
      // fields the hub can emit. If it ever carried `progress`, this would
      // overwrite a fresh derived value with a stale wire one.
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

/**
 * Re-sync after every (re)connect.
 *
 * `api/ws.py` states plainly that frames are advisory and clients must re-read
 * REST on connect — everything that happened while the socket was down was
 * missed outright.
 *
 * `chunks` and `throughput` are `staleTime: Infinity`, so they need
 * `refetchQueries`. `invalidateQueries` alone would mark them stale and never
 * refire them, and the chunk map would sit frozen at its pre-outage state.
 */
export function resync(queryClient: QueryClient, selectedJobId: string | null): void {
  void queryClient.invalidateQueries({ queryKey: qk.jobs })
  void queryClient.invalidateQueries({ queryKey: qk.ibStatus })
  if (!selectedJobId) return
  void queryClient.invalidateQueries({ queryKey: qk.job(selectedJobId) })
  void queryClient.invalidateQueries({ queryKey: qk.failures(selectedJobId) })
  void queryClient.refetchQueries({ queryKey: qk.chunks(selectedJobId) })
  void queryClient.refetchQueries({ queryKey: qk.throughput(selectedJobId) })
}
