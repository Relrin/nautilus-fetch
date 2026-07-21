import { CREATE_JOB_TIMEOUT_MS, JOBS_PAGE_LIMIT, THROUGHPUT_WINDOW_S } from '@/lib/constants'

import { apiDelete, apiFetch, apiPost, apiPut, qs } from './client'
import type {
  CatalogSummaryDto,
  ChunksDto,
  ConsolidateBody,
  FailureDto,
  HealthDto,
  IbStatusDto,
  InstrumentDetailsDto,
  InstrumentDto,
  InstrumentSearchDto,
  JobCreateBody,
  JobCreatedDto,
  JobDto,
  RunNowDto,
  ScheduleCreateBody,
  ScheduleDto,
  ScheduleUpdateBody,
  ThroughputDto,
} from './types'

export const getHealth = () => apiFetch<HealthDto>('/api/health')
export const getIbStatus = () => apiFetch<IbStatusDto>('/api/ib/status')

// -- instruments -------------------------------------------------------------

/** Local cache only — works while the gateway is down and costs no pacing budget. */
export const listInstruments = (params: { q?: string; sec_type?: string; limit?: number } = {}) =>
  apiFetch<InstrumentDto[]>(`/api/instruments${qs({ limit: 200, ...params })}`)

/** Hits IB. Server-side rate limit is ~1/s and it queues rather than erroring. */
export const searchInstruments = (q: string, secType?: string, signal?: AbortSignal) =>
  apiFetch<InstrumentSearchDto[]>(`/api/instruments/search${qs({ q, sec_type: secType })}`, {
    ...(signal ? { signal } : {}),
  })

export const getInstrument = (conId: number, refresh = false) =>
  apiFetch<InstrumentDetailsDto>(`/api/instruments/${conId}${qs({ refresh })}`)

// -- jobs --------------------------------------------------------------------

/**
 * Deliberately unfiltered: `?state=` matches a single exact value, so
 * server-side filtering would need one request per state. We partition
 * client-side instead.
 */
export const listJobs = () => apiFetch<JobDto[]>(`/api/jobs${qs({ limit: JOBS_PAGE_LIMIT })}`)

export const getJob = (jobId: string) => apiFetch<JobDto>(`/api/jobs/${jobId}`)

/** Plans chunks synchronously with a paced IB round-trip per instrument. */
export const createJob = (body: JobCreateBody) =>
  apiPost<JobCreatedDto>('/api/jobs', body, { timeoutMs: CREATE_JOB_TIMEOUT_MS })

export const cancelJob = (jobId: string) => apiDelete<JobDto>(`/api/jobs/${jobId}`)
export const pauseJob = (jobId: string) => apiPost<JobDto>(`/api/jobs/${jobId}/pause`)
export const resumeJob = (jobId: string) => apiPost<JobDto>(`/api/jobs/${jobId}/resume`)
export const retryFailedChunks = (jobId: string) =>
  apiPost<JobDto>(`/api/jobs/${jobId}/retry-failed`)
/** DEPTH only: flushes buffered segments and completes the job cleanly. */
export const stopRecorder = (jobId: string) => apiPost<JobDto>(`/api/jobs/${jobId}/stop`)

export const getJobChunks = (jobId: string) => apiFetch<ChunksDto>(`/api/jobs/${jobId}/chunks`)

export const getJobThroughput = (jobId: string, window = THROUGHPUT_WINDOW_S) =>
  apiFetch<ThroughputDto>(`/api/jobs/${jobId}/throughput${qs({ window })}`)

export const getJobFailures = (jobId: string) =>
  apiFetch<FailureDto[]>(`/api/jobs/${jobId}/failures`)

// -- schedules ---------------------------------------------------------------

export const listSchedules = () => apiFetch<ScheduleDto[]>('/api/schedules')
export const getSchedule = (id: string) => apiFetch<ScheduleDto>(`/api/schedules/${id}`)
export const createSchedule = (body: ScheduleCreateBody) =>
  apiPost<ScheduleDto>('/api/schedules', body)
export const updateSchedule = (id: string, body: ScheduleUpdateBody) =>
  apiPut<ScheduleDto>(`/api/schedules/${id}`, body)
/** 204 with an empty body. */
export const deleteSchedule = (id: string) => apiDelete<void>(`/api/schedules/${id}`)
/** May resolve with `job: null` when there is nothing new to fetch. */
export const runScheduleNow = (id: string) =>
  apiPost<RunNowDto>(`/api/schedules/${id}/run-now`, undefined, {
    timeoutMs: CREATE_JOB_TIMEOUT_MS,
  })

// -- catalog -----------------------------------------------------------------

export const getCatalogSummary = () => apiFetch<CatalogSummaryDto>('/api/catalog/summary')

/** Blocking rewrite of Parquet files; no progress stream exists. */
export const consolidateCatalog = (body: ConsolidateBody = {}) =>
  apiPost<{ status: string }>('/api/catalog/consolidate', body, { timeoutMs: 10 * 60_000 })
