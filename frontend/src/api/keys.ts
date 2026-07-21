import { THROUGHPUT_WINDOW_S } from '@/lib/constants'

/**
 * Query key factory. `jobs` is intentionally parameterless — the list is always
 * fetched unfiltered and partitioned client-side, so there is exactly one
 * cache entry for it and WebSocket patches always know where to land.
 */
export const qk = {
  health: ['health'] as const,
  ibStatus: ['ib', 'status'] as const,

  jobs: ['jobs'] as const,
  job: (id: string) => ['jobs', id] as const,
  chunks: (id: string) => ['jobs', id, 'chunks'] as const,
  throughput: (id: string, window: number = THROUGHPUT_WINDOW_S) =>
    ['jobs', id, 'throughput', window] as const,
  failures: (id: string) => ['jobs', id, 'failures'] as const,

  schedules: ['schedules'] as const,
  schedule: (id: string) => ['schedules', id] as const,

  catalog: ['catalog', 'summary'] as const,

  instruments: (q: string, secType: string | null) => ['instruments', 'list', q, secType] as const,
  instrumentSearch: (q: string, secType: string | null) =>
    ['instruments', 'search', q, secType] as const,
  instrument: (conId: number) => ['instruments', conId] as const,
}
