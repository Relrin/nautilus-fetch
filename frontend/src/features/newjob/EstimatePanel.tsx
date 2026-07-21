import { Clock } from 'lucide-react'

import { cronFor, humanCron, type JobFormState } from '@/domain/jobForm'
import { kindLabel } from '@/domain/kind'

const DAY_MS = 86_400_000

/**
 * What is actually about to happen — never a fabricated chunk count.
 *
 * The server plans chunks with a paced IB round-trip per instrument, so the
 * real number is unknowable here. Saying so is more useful than a guess that
 * turns out wrong once the modal closes.
 */
export function EstimatePanel({ state }: { state: JobFormState }) {
  const count = state.conIds.length
  const instruments = `${count} instrument${count === 1 ? '' : 's'}`
  const kind = kindLabel(state.dataType, state.barSize)

  let detail: string
  if (state.dataType === 'DEPTH') {
    detail = `${instruments} · ${kind} · records until stopped, ~1 segment every 5 min`
  } else if (state.cadence === 'once') {
    const days = Math.max(
      0,
      Math.round((Date.parse(state.to) - Date.parse(state.from)) / DAY_MS) + 1,
    )
    detail = `${instruments} · ${kind} · ${days} day${days === 1 ? '' : 's'} · chunk plan is computed server-side`
  } else {
    // These two are sent explicitly, so stating them here is not a guess.
    detail = `${instruments} · ${kind} · ${humanCron(cronFor(state))} · lag 15 min · 7-day lookback on first run`
  }

  return (
    <div className="bg-panel border-b1 rounded-8 flex items-center gap-[8px] border px-[12px] py-[9px]">
      <Clock size={12} strokeWidth={2} className="text-accent flex-none" />
      <span className="text-105 text-t1b font-mono">{detail}</span>
    </div>
  )
}
