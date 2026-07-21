import { humanCron, type Cadence, type JobFormState } from '@/domain/jobForm'
import { cn } from '@/lib/cn'

import { TextInput } from './Field'

const OPTIONS: { value: Cadence; label: string }[] = [
  { value: 'once', label: 'once' },
  { value: 'nightly', label: 'nightly' },
  { value: 'cron', label: 'cron' },
]

interface CadenceControlProps {
  state: JobFormState
  patch: (next: Partial<JobFormState>) => void
}

export function CadenceControl({ state, patch }: CadenceControlProps) {
  // `ScheduleTemplate` has no DEPTH variant: recorders run continuously, so
  // there is nothing for a cron trigger to do.
  const disabled = state.dataType === 'DEPTH'

  return (
    <div className={cn('flex flex-wrap items-center gap-[10px]', disabled && 'opacity-45')}>
      <div className="border-b2 rounded-8 flex flex-none overflow-hidden border">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => patch({ cadence: option.value })}
            className={cn(
              'border-b1 text-11 h-[32px] cursor-pointer border-r px-[14px] font-mono font-semibold last:border-r-0 disabled:cursor-not-allowed',
              state.cadence === option.value
                ? 'bg-accent text-accent-ink'
                : 'bg-panel text-t2 hover:text-t1',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {!disabled && state.cadence === 'nightly' && (
        <>
          <span className="text-105 text-t2">at</span>
          <TextInput
            type="time"
            value={state.nightlyTime}
            onChange={(event) => patch({ nightlyTime: event.target.value })}
            className="w-[96px] py-[6px]"
          />
          <span className="text-95 text-t3">incremental — only new sessions</span>
        </>
      )}

      {!disabled && state.cadence === 'cron' && (
        <>
          <TextInput
            value={state.cron}
            spellCheck={false}
            onChange={(event) => patch({ cron: event.target.value })}
            className="w-[140px] py-[6px]"
          />
          <span className="text-95 text-t3">{humanCron(state.cron)}</span>
        </>
      )}

      {disabled && (
        <span className="text-95 text-t3">
          depth recorders run continuously — nothing to schedule
        </span>
      )}
    </div>
  )
}
