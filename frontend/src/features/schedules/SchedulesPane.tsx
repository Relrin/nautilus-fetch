import { CalendarClock, Plus } from 'lucide-react'
import { useState } from 'react'

import { useDeleteSchedule, useRunScheduleNow, useUpdateSchedule } from '@/api/mutations'
import { useInstruments, useJobs, useSchedules } from '@/api/queries'
import type { ScheduleDto } from '@/api/types'
import { Chip } from '@/components/ndm/Chip'
import { EmptyState } from '@/components/ndm/EmptyState'
import { SectionHeader, SectionTitle } from '@/components/ndm/SectionHeader'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { scheduleJobs, symbolsForConIds } from '@/domain/scheduleView'
import { useSelection } from '@/state/selectionContext'
import { useToasts } from '@/state/toastsContext'

import { ScheduleCard } from './ScheduleCard'
import { ScheduleDetailAside } from './ScheduleDetailAside'
import { ScheduleEditorModal } from './ScheduleEditorModal'

type EditorTarget = { schedule: ScheduleDto | null } | null

export function SchedulesPane() {
  const { data: schedules, isLoading, error } = useSchedules()
  const { data: jobs } = useJobs()
  const { data: instruments } = useInstruments('', null)
  const { selectedScheduleId, selectSchedule, openJob } = useSelection()
  const { push } = useToasts()

  const [editor, setEditor] = useState<EditorTarget>(null)
  const [pendingDelete, setPendingDelete] = useState<ScheduleDto | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)

  const runNow = useRunScheduleNow()
  const update = useUpdateSchedule()
  const remove = useDeleteSchedule()

  const rows = schedules ?? []
  const selected = rows.find((row) => row.id === selectedScheduleId)
  const selectedJobs = selected ? scheduleJobs(jobs, selected.id) : []

  const handleRunNow = (schedule: ScheduleDto) => {
    setRunningId(schedule.id)
    runNow.mutate(schedule.id, {
      onSuccess: (result) => {
        // `run-now` legitimately answers `{job: null, detail: "already up to
        // date"}` when there is nothing new to fetch. That is a normal outcome,
        // not a failure, so it is surfaced verbatim rather than dressed up.
        if (result.job === null) {
          push(result.detail, 'neutral')
          return
        }
        push(`Queued a run of ${schedule.name}`, 'success')
        openJob(result.job.id)
      },
      onError: (mutationError: Error) => push(mutationError.message, 'danger'),
      onSettled: () => setRunningId(null),
    })
  }

  const handleToggle = (schedule: ScheduleDto) => {
    update.mutate(
      { id: schedule.id, body: { enabled: !schedule.enabled } },
      {
        onError: (mutationError: Error) =>
          push(`Could not update: ${mutationError.message}`, 'danger'),
      },
    )
  }

  const confirmDelete = () => {
    const target = pendingDelete
    if (!target) return
    remove.mutate(target.id, {
      onSuccess: () => {
        push(`Deleted ${target.name}`, 'neutral')
        if (selectedScheduleId === target.id) selectSchedule(null)
      },
      onError: (mutationError: Error) =>
        push(`Could not delete: ${mutationError.message}`, 'danger'),
    })
    setPendingDelete(null)
  }

  return (
    <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_344px]">
      <main className="bg-page flex min-h-0 flex-col">
        <SectionHeader>
          <SectionTitle>Schedules</SectionTitle>
          <Chip>{String(rows.length)}</Chip>
          <span className="text-105 text-t3">recurring rules · fetch only what is new</span>
          <div className="flex-1" />
          <Button size="sm" onClick={() => setEditor({ schedule: null })}>
            <Plus size={12} strokeWidth={2.6} />
            New schedule
          </Button>
        </SectionHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-[14px] pt-[12px] pb-[20px]">
          {error && (
            <EmptyState
              title="Could not load schedules"
              body={error.message}
              icon={<CalendarClock size={26} className="text-danger mx-auto" />}
            />
          )}

          {!error && rows.length === 0 && !isLoading && (
            <EmptyState
              icon={<CalendarClock size={26} strokeWidth={1.6} className="text-accent mx-auto" />}
              title="No schedules yet"
              body="A schedule runs on a cron expression and fetches only data newer than its last successful run — ideal for nightly incremental pulls of bars, trades, or L1 quotes."
              action={
                <Button size="md" onClick={() => setEditor({ schedule: null })}>
                  Create your first schedule
                </Button>
              }
            />
          )}

          <div className="flex flex-col gap-[9px]">
            {rows.map((schedule) => (
              <ScheduleCard
                key={schedule.id}
                schedule={schedule}
                jobs={scheduleJobs(jobs, schedule.id)}
                symbols={symbolsForConIds(schedule.template.con_ids, instruments)}
                selected={schedule.id === selectedScheduleId}
                busy={runningId === schedule.id}
                onSelect={() => selectSchedule(schedule.id)}
                onToggle={() => handleToggle(schedule)}
                onRunNow={() => handleRunNow(schedule)}
                onEdit={() => setEditor({ schedule })}
                onDelete={() => setPendingDelete(schedule)}
              />
            ))}
          </div>
        </div>
      </main>

      <ScheduleDetailAside
        schedule={selected}
        jobs={selectedJobs}
        symbols={selected ? symbolsForConIds(selected.template.con_ids, instruments) : []}
        busy={runningId === selected?.id}
        onRunNow={() => selected && handleRunNow(selected)}
        onEdit={() => selected && setEditor({ schedule: selected })}
        onOpenJob={openJob}
      />

      {editor && (
        <ScheduleEditorModal
          schedule={editor.schedule}
          picked={
            editor.schedule
              ? editor.schedule.template.con_ids.map((conId, index) => ({
                  conId,
                  symbol:
                    symbolsForConIds(editor.schedule!.template.con_ids, instruments)[index] ??
                    String(conId),
                }))
              : []
          }
          onClose={() => setEditor(null)}
        />
      )}

      {/* The mockup has no confirmation. This destroys a recurring rule and the
          DELETE is not undoable, so one is added deliberately. */}
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete this schedule?"
        body={
          <>
            <span className="text-t1b font-mono">{pendingDelete?.name}</span> will stop running.
            Jobs it already created are kept, along with everything they downloaded.
          </>
        }
        confirmLabel="Delete schedule"
        tone="danger"
        onConfirm={confirmDelete}
      />
    </div>
  )
}
