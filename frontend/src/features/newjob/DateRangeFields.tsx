import { Field, TextInput } from './Field'
import { presetRange, RANGE_PRESETS, type JobFormState } from '@/domain/jobForm'

interface DateRangeFieldsProps {
  state: JobFormState
  patch: (next: Partial<JobFormState>) => void
}

export function DateRangeFields({ state, patch }: DateRangeFieldsProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-[10px]">
        <Field label="From">
          <TextInput
            type="date"
            value={state.from}
            max={state.to || undefined}
            onChange={(event) => patch({ from: event.target.value })}
          />
        </Field>
        <Field label="To">
          <TextInput
            type="date"
            value={state.to}
            min={state.from || undefined}
            onChange={(event) => patch({ to: event.target.value })}
          />
        </Field>
      </div>

      <div className="mt-[-6px] flex gap-[5px]">
        {RANGE_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => patch(presetRange(preset.months))}
            className="bg-panel border-b2 text-95 text-t1b rounded-5 hover:border-b3 hover:text-t1 cursor-pointer border px-[8px] py-[3px] font-mono"
          >
            {preset.label}
          </button>
        ))}
      </div>
    </>
  )
}
