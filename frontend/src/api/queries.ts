import { useQuery } from '@tanstack/react-query'

import { ChunkBuffer } from '@/domain/chunkMap'
import { TpRing } from '@/domain/throughput'
import { useWsConnected } from '@/ws/context'

import * as api from './endpoints'
import { qk } from './keys'

/** Only used while the socket is down; live frames are the primary channel. */
const JOBS_POLL_MS = 4_000

export function useHealth() {
  return useQuery({ queryKey: qk.health, queryFn: api.getHealth, staleTime: 60_000 })
}

export function useIbStatus() {
  return useQuery({
    queryKey: qk.ibStatus,
    queryFn: api.getIbStatus,
    // Cheap, and it drives the connection pill — the one thing that must not
    // go stale when the gateway drops.
    refetchInterval: 5_000,
    staleTime: 2_000,
  })
}

export function useJobs() {
  const wsConnected = useWsConnected()
  return useQuery({
    queryKey: qk.jobs,
    queryFn: api.listJobs,
    refetchInterval: wsConnected ? false : JOBS_POLL_MS,
    staleTime: 2_000,
  })
}

export function useJob(jobId: string | null) {
  return useQuery({
    queryKey: qk.job(jobId ?? ''),
    queryFn: () => api.getJob(jobId!),
    enabled: Boolean(jobId),
    staleTime: 2_000,
  })
}

/**
 * staleTime Infinity: after the initial fetch this is maintained exclusively by
 * WebSocket deltas. Reconnect must call `refetchQueries`, not `invalidate`.
 */
export function useChunks(jobId: string | null) {
  return useQuery({
    queryKey: qk.chunks(jobId ?? ''),
    queryFn: async () => ChunkBuffer.fromDto(await api.getJobChunks(jobId!)),
    enabled: Boolean(jobId),
    staleTime: Infinity,
  })
}

/** Same contract as useChunks: seeded once, then appended from `tp` frames. */
export function useThroughput(jobId: string | null) {
  return useQuery({
    queryKey: qk.throughput(jobId ?? ''),
    queryFn: async () => TpRing.seed(await api.getJobThroughput(jobId!)),
    enabled: Boolean(jobId),
    staleTime: Infinity,
  })
}

export function useFailures(jobId: string | null, failedCount: number) {
  return useQuery({
    queryKey: qk.failures(jobId ?? ''),
    queryFn: () => api.getJobFailures(jobId!),
    enabled: Boolean(jobId) && failedCount > 0,
    staleTime: 10_000,
  })
}

export function useSchedules() {
  return useQuery({ queryKey: qk.schedules, queryFn: api.listSchedules, staleTime: 10_000 })
}

export function useCatalogSummary() {
  return useQuery({
    queryKey: qk.catalog,
    queryFn: api.getCatalogSummary,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}

/** The cached instrument table — no IB round-trip, so it survives an outage. */
export function useInstruments(q: string, secType: string | null) {
  return useQuery({
    queryKey: qk.instruments(q, secType),
    queryFn: () =>
      api.listInstruments({ ...(q ? { q } : {}), ...(secType ? { sec_type: secType } : {}) }),
    staleTime: 30_000,
  })
}

export function useInstrument(conId: number | null) {
  return useQuery({
    queryKey: qk.instrument(conId ?? 0),
    queryFn: () => api.getInstrument(conId!),
    enabled: Boolean(conId),
    staleTime: 5 * 60_000,
  })
}
