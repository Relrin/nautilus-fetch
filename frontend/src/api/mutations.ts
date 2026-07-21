import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'

import type { JobDto, ScheduleCreateBody, ScheduleUpdateBody } from './types'
import type { JobState } from './enums'
import * as api from './endpoints'
import { qk } from './keys'

/** Write a job into both the list and its detail entry, keeping them in step. */
function patchJobCache(queryClient: QueryClient, job: JobDto) {
  queryClient.setQueryData<JobDto[]>(qk.jobs, (list) =>
    list?.map((entry) => (entry.id === job.id ? job : entry)),
  )
  queryClient.setQueryData<JobDto>(qk.job(job.id), job)
}

/**
 * Optimistically flip a job's state, returning a rollback.
 *
 * The backend answers 409 for an invalid transition (e.g. pausing a job that
 * just finished), so the optimistic value genuinely can be wrong and the
 * rollback genuinely fires.
 */
function optimisticState(queryClient: QueryClient, jobId: string, state: JobState) {
  const previousList = queryClient.getQueryData<JobDto[]>(qk.jobs)
  const previousJob = queryClient.getQueryData<JobDto>(qk.job(jobId))

  queryClient.setQueryData<JobDto[]>(qk.jobs, (list) =>
    list?.map((entry) => (entry.id === jobId ? { ...entry, state } : entry)),
  )
  queryClient.setQueryData<JobDto>(qk.job(jobId), (job) => (job ? { ...job, state } : job))

  return () => {
    queryClient.setQueryData(qk.jobs, previousList)
    queryClient.setQueryData(qk.job(jobId), previousJob)
  }
}

function useJobStateMutation(
  action: (jobId: string) => Promise<JobDto>,
  optimistic: JobState | null,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: action,
    onMutate: (jobId: string) =>
      optimistic ? { rollback: optimisticState(queryClient, jobId, optimistic) } : undefined,
    onError: (_error, _jobId, context) => context?.rollback(),
    onSuccess: (job) => patchJobCache(queryClient, job),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.jobs }),
  })
}

export const usePauseJob = () => useJobStateMutation(api.pauseJob, 'paused')
export const useResumeJob = () => useJobStateMutation(api.resumeJob, 'running')
export const useCancelJob = () => useJobStateMutation(api.cancelJob, 'canceled')
/** DEPTH only. Unlike cancel, this flushes buffers and keeps the data. */
export const useStopRecorder = () => useJobStateMutation(api.stopRecorder, null)

export function useRetryFailed() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.retryFailedChunks,
    onSuccess: (job) => {
      patchJobCache(queryClient, job)
      // Requeued chunks go back to pending, so both derived views are stale.
      void queryClient.refetchQueries({ queryKey: qk.chunks(job.id) })
      void queryClient.invalidateQueries({ queryKey: qk.failures(job.id) })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.jobs }),
  })
}

export function useCreateJob() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.createJob,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.jobs }),
  })
}

export function useCreateSchedule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.createSchedule,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.schedules }),
  })
}

export function useUpdateSchedule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ScheduleUpdateBody }) =>
      api.updateSchedule(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.schedules }),
  })
}

export function useDeleteSchedule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.deleteSchedule,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.schedules }),
  })
}

export function useRunScheduleNow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.runScheduleNow,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.jobs })
      void queryClient.invalidateQueries({ queryKey: qk.schedules })
    },
  })
}

export function useConsolidate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.consolidateCatalog,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.catalog }),
  })
}

export type { ScheduleCreateBody }
