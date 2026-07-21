import { ChevronDown, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { BAR_SIZES, type BarSize, type DataType } from '@/api/enums'
import { useCreateSchedule, useUpdateSchedule } from '@/api/mutations'
import { useCatalogSummary } from '@/api/queries'
import type { ScheduleCreateBody, ScheduleDto } from '@/api/types'
import { Stepper } from '@/components/ndm/Stepper'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { humanCron } from '@/domain/jobForm'
import { kindLabel } from '@/domain/kind'
import { MAX_RETRIES, MAX_WORKERS } from '@/lib/constants'
import { Field, TextInput } from '@/features/newjob/Field'
import {
  InstrumentMultiSelect,
  type PickedInstrument,
} from '@/features/newjob/InstrumentMultiSelect'
import { useToasts } from '@/state/toastsContext'

/** Backend clamps, from `ScheduleTemplate`. */
const MAX_LAG_MINUTES = 1440
const MAX_LOOKBACK_DAYS = 365
const MIN_CRON_LENGTH = 9

/** `ScheduleTemplate.data_type` excludes DEPTH — recorders run continuously. */
type TemplateDataType = Exclude<DataType, 'DEPTH'>

interface ScheduleEditorModalProps {
  /** Null creates a new schedule; a schedule edits it in place. */
  schedule: ScheduleDto | null
  picked: PickedInstrument[]
  onClose: () => void
}

export function ScheduleEditorModal({ schedule, picked, onClose }: ScheduleEditorModalProps) {
  const [name, setName] = useState(schedule?.name ?? '')
  const [cron, setCron] = useState(schedule?.cron ?? '30 2 * * 1-5')
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true)
  const [catchup, setCatchup] = useState(schedule?.catchup ?? false)
  const [instruments, setInstruments] = useState<PickedInstrument[]>(picked)
  // `ScheduleTemplate.data_type` is already narrowed to exclude DEPTH.
  const [dataType, setDataType] = useState<TemplateDataType>(schedule?.template.data_type ?? 'BARS')
  const [barSize, setBarSize] = useState<BarSize | null>(
    (schedule?.template.bar_size as BarSize | null | undefined) ?? '1 min',
  )
  const [workers, setWorkers] = useState(schedule?.template.workers ?? 4)
  const [retries, setRetries] = useState(schedule?.template.max_retries ?? 3)
  const [lagMinutes, setLagMinutes] = useState(schedule?.template.lag_minutes ?? 15)
  const [lookbackDays, setLookbackDays] = useState(schedule?.template.lookback_days ?? 7)
  const [submitted, setSubmitted] = useState(false)

  const catalog = useCatalogSummary()
  const create = useCreateSchedule()
  const update = useUpdateSchedule()
  const { push } = useToasts()
  const pending = create.isPending || update.isPending

  const errors = useMemo(() => {
    const found: string[] = []
    if (name.trim().length === 0) found.push('Name is required.')
    if (instruments.length === 0) found.push('Pick at least one instrument.')
    // `cron` is `min_length=9` server-side, so a truncated paste 422s.
    if (cron.trim().length < MIN_CRON_LENGTH) {
      found.push('Cron needs all five fields, e.g. `30 2 * * 1-5`.')
    }
    if (dataType === 'BARS' && !barSize) found.push('Bar size is required for bar schedules.')
    return found
  }, [name, instruments, cron, dataType, barSize])

  const submit = () => {
    setSubmitted(true)
    if (errors.length > 0) return

    const body: ScheduleCreateBody = {
      name: name.trim(),
      cron: cron.trim(),
      enabled,
      catchup,
      template: {
        con_ids: instruments.map((row) => row.conId),
        data_type: dataType,
        bar_size: dataType === 'BARS' ? barSize : null,
        what_to_show: dataType === 'BARS' ? 'TRADES' : null,
        use_rth: true,
        workers,
        max_retries: retries,
        lag_minutes: lagMinutes,
        lookback_days: lookbackDays,
      },
    }

    const onError = (error: Error) => push(error.message, 'danger')

    if (schedule) {
      update.mutate(
        { id: schedule.id, body },
        {
          onSuccess: () => {
            push(`Saved ${body.name}`, 'success')
            onClose()
          },
          onError,
        },
      )
      return
    }

    create.mutate(body, {
      onSuccess: () => {
        push(`Schedule created for ${body.name}`, 'success')
        onClose()
      },
      onError,
    })
  }

  const kindValue = dataType === 'BARS' ? `bars:${barSize ?? '1 min'}` : dataType

  return (
    <div
      onClick={onClose}
      className="animate-ndm-fade fixed inset-0 z-50 flex items-center justify-center bg-[rgba(3,12,16,.7)] backdrop-blur-[3px]"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={schedule ? 'Edit schedule' : 'New schedule'}
        className="bg-card border-b3 rounded-13 animate-ndm-pop max-h-[90vh] w-[568px] max-w-[calc(100vw-48px)] overflow-y-auto border shadow-[0_24px_70px_rgba(0,0,0,.6)]"
      >
        <div className="flex items-start px-[18px] pt-[16px]">
          <div>
            <div className="text-14 mb-[3px] font-semibold">
              {schedule ? 'Edit schedule' : 'New schedule'}
            </div>
            <div className="text-11 text-t2">
              Runs on a cron schedule and fetches only data newer than the last successful run.
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
          <Field label="Name">
            <TextInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. US equities — 1-min bars"
              maxLength={200}
              className="py-[8px] pr-[11px] pl-[11px]"
            />
          </Field>

          <Field label="Instruments">
            <InstrumentMultiSelect picked={instruments} onChange={setInstruments} />
          </Field>

          <div className="grid grid-cols-2 gap-[10px]">
            <Field label="Data kind">
              <div className="relative">
                <select
                  value={kindValue}
                  onChange={(event) => {
                    const value = event.target.value
                    if (value.startsWith('bars:')) {
                      setDataType('BARS')
                      setBarSize(value.slice('bars:'.length) as BarSize)
                    } else {
                      setDataType(value as TemplateDataType)
                      setBarSize(null)
                    }
                  }}
                  className="bg-panel border-b2 rounded-8 text-11 text-t1 focus:border-b3 h-[32px] w-full cursor-pointer appearance-none border px-[10px] font-mono outline-none"
                >
                  {/* No DEPTH option at all: ScheduleTemplate has no variant for
                      it, so offering one would only produce a 422. */}
                  <option value="TRADE_TICKS">trade ticks</option>
                  <option value="QUOTE_TICKS">quotes (L1 bid/ask)</option>
                  <optgroup label="bars">
                    {BAR_SIZES.map((size) => (
                      <option key={size} value={`bars:${size}`}>
                        {kindLabel('BARS', size)}
                      </option>
                    ))}
                  </optgroup>
                </select>
                <ChevronDown
                  size={11}
                  strokeWidth={2.4}
                  className="text-t2 pointer-events-none absolute top-[11px] right-[10px]"
                />
              </div>
            </Field>
            <Field label="Cron expression">
              <TextInput
                value={cron}
                spellCheck={false}
                onChange={(event) => setCron(event.target.value)}
                className="text-12 py-[8px] pr-[11px] pl-[11px]"
              />
            </Field>
          </div>

          <div className="text-105 text-t2 mt-[-7px] font-mono">
            {`↳ ${humanCron(cron)} · no L2 depth (recorders run continuously)`}
          </div>

          <div className="flex flex-wrap items-center gap-[22px]">
            <label className="flex cursor-pointer items-center gap-[8px]">
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                className="data-[size=default]:h-[19px] data-[size=default]:w-[34px]"
              />
              <span className="text-11 text-t1b">Enabled</span>
            </label>
            <label className="flex cursor-pointer items-center gap-[8px]">
              <Switch
                checked={catchup}
                onCheckedChange={setCatchup}
                className="data-[size=default]:h-[19px] data-[size=default]:w-[34px]"
              />
              <span className="text-11 text-t1b">Catch up missed runs on restart</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-[16px]">
            <StepperField label="Workers" title={`The engine caps concurrency at ${MAX_WORKERS}`}>
              <Stepper value={workers} onChange={setWorkers} min={1} max={MAX_WORKERS} />
            </StepperField>
            <StepperField label="Retries">
              <Stepper value={retries} onChange={setRetries} min={0} max={MAX_RETRIES} />
            </StepperField>
            <StepperField label="Lag min" title="Stay this far behind real time so data settles">
              <Stepper
                value={lagMinutes}
                onChange={setLagMinutes}
                min={0}
                max={MAX_LAG_MINUTES}
                step={5}
                wide
              />
            </StepperField>
            <StepperField
              label="Lookback d"
              title="Days fetched on a first run or for a newly added instrument"
            >
              <Stepper
                value={lookbackDays}
                onChange={setLookbackDays}
                min={1}
                max={MAX_LOOKBACK_DAYS}
                wide
              />
            </StepperField>
          </div>

          {/* Read-only, matching the new-job modal: the catalog root is server
              configuration and there is no per-schedule override, so an
              editable field here would silently do nothing. */}
          <Field label="Output folder">
            <TextInput
              readOnly
              value={catalog.data?.path ?? '—'}
              className="text-t2 py-[8px] pr-[11px] pl-[11px]"
            />
          </Field>

          {submitted && errors.length > 0 && (
            <div className="text-105 mt-[-7px] text-[#f0524d]">{errors.join(' ')}</div>
          )}

          <div className="flex justify-end gap-[8px] pt-[2px]">
            <Button variant="outline" size="md" className="px-[13px]" onClick={onClose}>
              Cancel
            </Button>
            <Button size="md" disabled={pending} onClick={submit}>
              {pending ? 'Saving…' : schedule ? 'Save schedule' : 'Create schedule'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function StepperField({
  label,
  title,
  children,
}: {
  label: string
  title?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-[8px]">
      <span className="text-105 text-t1b" title={title}>
        {label}
      </span>
      {children}
    </div>
  )
}
