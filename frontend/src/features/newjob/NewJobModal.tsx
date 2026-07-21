import { X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { useCreateJob, useCreateSchedule } from '@/api/mutations'
import { useCatalogSummary } from '@/api/queries'
import type { JobDto } from '@/api/types'
import { Stepper } from '@/components/ndm/Stepper'
import { Button } from '@/components/ui/button'
import {
  buildJobBody,
  buildScheduleBody,
  initialJobForm,
  validateJobForm,
  type JobFormState,
} from '@/domain/jobForm'
import { kindLabel, kindValueOf, parseKindValue } from '@/domain/kind'
import {
  CATALOG_FILE_PATTERN,
  MAX_DEPTH_SUBSCRIPTIONS,
  MAX_RETRIES,
  MAX_WORKERS,
} from '@/lib/constants'
import { useSelection } from '@/state/selectionContext'
import { useToasts } from '@/state/toastsContext'

import { CadenceControl } from './CadenceControl'
import { DataKindSelect } from './DataKindSelect'
import { DateRangeFields } from './DateRangeFields'
import { DepthFields } from './DepthFields'
import { EstimatePanel } from './EstimatePanel'
import { Field, TextInput } from './Field'
import { InstrumentMultiSelect, type PickedInstrument } from './InstrumentMultiSelect'

export interface NewJobPrefill {
  picked: PickedInstrument[]
  state: Partial<JobFormState>
}

interface NewJobModalProps {
  onClose: () => void
  prefill?: NewJobPrefill | null
}

/**
 * Rendered only while open, so it mounts fresh every time.
 *
 * That is what resets the draft — no effect syncing props into state, and no
 * chance of a cancelled draft leaking into the next job.
 */
export function NewJobModal({ onClose, prefill }: NewJobModalProps) {
  const [form, setForm] = useState<JobFormState>(() => ({
    ...initialJobForm(),
    ...prefill?.state,
  }))
  const [picked, setPicked] = useState<PickedInstrument[]>(() => prefill?.picked ?? [])
  const [submitted, setSubmitted] = useState(false)

  const createJob = useCreateJob()
  const createSchedule = useCreateSchedule()
  const catalog = useCatalogSummary()
  const { push } = useToasts()
  const { openJob } = useSelection()

  const patch = (next: Partial<JobFormState>) => setForm((current) => ({ ...current, ...next }))

  const setPickedAndIds = (next: PickedInstrument[]) => {
    setPicked(next)
    patch({ conIds: next.map((row) => row.conId) })
  }

  const errors = useMemo(() => validateJobForm(form), [form])
  const recorder = form.dataType === 'DEPTH'
  const pending = createJob.isPending || createSchedule.isPending

  // The server counts *active* recorders too and 422s, so this is a warning
  // rather than a hard block — its message is the authoritative one.
  const depthOverLimit = recorder && form.conIds.length > MAX_DEPTH_SUBSCRIPTIONS

  const jobName = useMemo(
    () => (picked.length > 0 ? picked.map((row) => row.symbol).join(' · ') : 'dataset job'),
    [picked],
  )

  const submit = () => {
    setSubmitted(true)
    if (errors.length > 0) return

    if (form.cadence === 'once') {
      createJob.mutate(buildJobBody(form, jobName), {
        onSuccess: (job: JobDto & { warnings: string[] }) => {
          push(`Queued ${jobName} · ${kindLabel(form.dataType, form.barSize)}`, 'success')
          // Planner clamp messages are the ONLY signal that the range actually
          // fetched differs from the one requested — never swallow them.
          if (job.warnings?.length) push(job.warnings.join(' · '), 'warning')
          openJob(job.id)
          onClose()
        },
        onError: (error: Error) => push(error.message, 'danger'),
      })
      return
    }

    createSchedule.mutate(buildScheduleBody(form, jobName), {
      onSuccess: () => {
        push(`Schedule created for ${jobName}`, 'success')
        onClose()
      },
      onError: (error: Error) => push(error.message, 'danger'),
    })
  }

  return (
    <div
      onClick={onClose}
      className="animate-ndm-fade fixed inset-0 z-50 flex items-center justify-center bg-[rgba(3,12,16,.7)] backdrop-blur-[3px]"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="New dataset job"
        className="bg-card border-b3 rounded-13 animate-ndm-pop max-h-[88vh] w-[568px] max-w-[calc(100vw-48px)] overflow-y-auto border shadow-[0_24px_70px_rgba(0,0,0,.6)]"
      >
        <div className="flex items-start px-[18px] pt-[16px]">
          <div>
            <div className="text-14 mb-[3px] font-semibold">New dataset job</div>
            <div className="text-11 text-t2">
              Fetched from IB Gateway chunk by chunk into the Nautilus parquet catalog.
            </div>
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="text-t2 hover:bg-b1 hover:text-t1 rounded-7 h-[26px] w-[26px] cursor-pointer border-none bg-transparent"
          >
            <X size={13} strokeWidth={2.4} className="mx-auto" />
          </button>
        </div>

        <div className="flex flex-col gap-[13px] px-[18px] pt-[14px] pb-[18px]">
          <Field label="Instruments">
            <InstrumentMultiSelect picked={picked} onChange={setPickedAndIds} />
          </Field>

          <div className="grid grid-cols-2 gap-[10px]">
            <Field label="Data kind">
              <DataKindSelect
                value={kindValueOf(form.dataType, form.barSize)}
                onChange={(value) => patch(parseKindValue(value))}
              />
            </Field>
            <Field label="Format">
              <div className="bg-panel border-b2 rounded-8 flex h-[32px] items-center gap-[8px] border px-[10px]">
                <span className="text-11 text-accent font-mono font-bold">parquet</span>
                <span className="text-95 text-t3">nautilus catalog · polars / pyarrow ready</span>
              </div>
            </Field>
          </div>

          {depthOverLimit && (
            <div className="text-105 mt-[-7px] text-[#e8a33d]">
              {`⚠ The server allows ${MAX_DEPTH_SUBSCRIPTIONS} concurrent depth subscriptions, counting recorders already running.`}
            </div>
          )}

          {recorder ? (
            <DepthFields state={form} patch={patch} />
          ) : (
            <DateRangeFields state={form} patch={patch} />
          )}

          <Field label="Cadence">
            <CadenceControl state={form} patch={patch} />
          </Field>

          {/* Read-only: both are server configuration with no per-job override,
              so editable inputs here would silently do nothing. */}
          <div className="grid grid-cols-[180px_1fr] gap-[10px]">
            {/* Both are longer than their fields, and a read-only input cannot
                be selected-and-scrolled as naturally as an editable one. */}
            <Field label="Output folder">
              <TextInput
                readOnly
                value={catalog.data?.path ?? '—'}
                title={catalog.data?.path ?? undefined}
                className="text-t2"
              />
            </Field>
            <Field label="Naming pattern">
              <TextInput
                readOnly
                value={CATALOG_FILE_PATTERN}
                title={CATALOG_FILE_PATTERN}
                className="text-t2"
              />
            </Field>
          </div>

          <div className="flex items-center gap-[16px]">
            <div className="flex items-center gap-[8px]">
              <span className="text-105 text-t1b">Retries</span>
              <Stepper
                value={form.maxRetries}
                onChange={(maxRetries) => patch({ maxRetries })}
                min={0}
                max={MAX_RETRIES}
              />
            </div>
            <div className="flex items-center gap-[8px]">
              <span className="text-105 text-t1b">Workers</span>
              {/* Capped at config.max_workers, not the schema's 16 — the engine
                  clamps silently, so a stepper going higher would misreport. */}
              <Stepper
                value={form.workers}
                onChange={(workers) => patch({ workers })}
                min={1}
                max={MAX_WORKERS}
                disabled={recorder}
                incrementTitle={`Server caps concurrency at ${MAX_WORKERS}`}
              />
            </div>
            <div className="flex-1" />
            <span className="text-95 text-t3">per-job · IB pacing enforced globally</span>
          </div>

          <EstimatePanel state={form} />

          {submitted && errors.length > 0 && (
            <div className="text-105 mt-[-7px] text-[#f0524d]">
              {errors.map((error) => error.message).join(' ')}
            </div>
          )}

          <div className="flex justify-end gap-[8px] pt-[2px]">
            <Button variant="outline" size="md" className="px-[13px]" onClick={onClose}>
              Cancel
            </Button>
            <Button size="md" disabled={pending} onClick={submit}>
              {/* Planning does a paced IB round-trip per instrument and can take
                  30–60s. A button that just sits there reads as a hang. */}
              {pending
                ? 'Planning chunks…'
                : form.cadence === 'once'
                  ? 'Queue job'
                  : 'Create schedule'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
