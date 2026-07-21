import { Stepper } from '@/components/ndm/Stepper'
import type { JobFormState } from '@/domain/jobForm'
import { cn } from '@/lib/cn'
import { MAX_DEPTH_LEVELS, MAX_SNAPSHOT_INTERVAL_MS } from '@/lib/constants'

import { Field, TextInput } from './Field'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface DepthFieldsProps {
  state: JobFormState
  patch: (next: Partial<JobFormState>) => void
}

/**
 * The DEPTH branch, which replaces From/To entirely.
 *
 * `check_data_type_params` rejects `end` on a recorder and rejects these
 * options on everything else, so the two shapes are mutually exclusive rather
 * than merely different — showing both at once would guarantee a 422.
 */
export function DepthFields({ state, patch }: DepthFieldsProps) {
  const window = state.captureWindow

  const toggleDay = (day: number) => {
    const days = window.days.includes(day)
      ? window.days.filter((value) => value !== day)
      : [...window.days, day].sort((a, b) => a - b)
    patch({ captureWindow: { ...window, days } })
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-[10px]">
        <Field label="Depth levels" hint={`1–${MAX_DEPTH_LEVELS}`}>
          <Stepper
            value={state.depthLevels}
            onChange={(depthLevels) => patch({ depthLevels })}
            min={1}
            max={MAX_DEPTH_LEVELS}
          />
        </Field>
        <Field label="Snapshot interval" hint="ms · 0 streams every change">
          <TextInput
            type="number"
            min={0}
            max={MAX_SNAPSHOT_INTERVAL_MS}
            step={100}
            value={state.snapshotIntervalMs}
            onChange={(event) => patch({ snapshotIntervalMs: Number(event.target.value) })}
          />
        </Field>
      </div>

      <Field label="Stop capturing on" hint="optional — runs until stopped otherwise">
        <TextInput
          type="date"
          value={state.captureUntil}
          onChange={(event) => patch({ captureUntil: event.target.value })}
        />
      </Field>

      <div className="border-b1 bg-panel rounded-8 border p-[10px_12px]">
        <label className="mb-[8px] flex cursor-pointer items-center gap-[8px]">
          <input
            type="checkbox"
            checked={state.captureWindowEnabled}
            onChange={(event) => patch({ captureWindowEnabled: event.target.checked })}
            className="accent-accent h-[13px] w-[13px] cursor-pointer"
          />
          <span className="text-105 text-t1b font-medium">Only record during a daily window</span>
        </label>

        <div
          className={cn(
            'flex flex-wrap items-center gap-[8px]',
            !state.captureWindowEnabled && 'pointer-events-none opacity-45',
          )}
        >
          <TextInput
            type="time"
            value={window.start}
            onChange={(event) => patch({ captureWindow: { ...window, start: event.target.value } })}
            className="w-[92px]"
          />
          <span className="text-105 text-t2">to</span>
          <TextInput
            type="time"
            value={window.end}
            onChange={(event) => patch({ captureWindow: { ...window, end: event.target.value } })}
            className="w-[92px]"
          />
          <TextInput
            value={window.tz}
            spellCheck={false}
            onChange={(event) => patch({ captureWindow: { ...window, tz: event.target.value } })}
            title="IANA time zone, e.g. America/New_York"
            className="w-[168px]"
          />

          <div className="flex w-full gap-[4px]">
            {DAY_LABELS.map((label, day) => (
              <button
                key={label}
                type="button"
                onClick={() => toggleDay(day)}
                className={cn(
                  'text-95 rounded-5 flex-1 cursor-pointer border py-[4px] font-mono',
                  window.days.includes(day)
                    ? 'bg-acc-10 border-acc-30 text-accent'
                    : 'bg-card border-b2 text-t3 hover:text-t1b',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
