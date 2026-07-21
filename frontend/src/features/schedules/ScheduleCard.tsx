import { Pencil, Play, Trash2 } from 'lucide-react'

import type { JobDto, ScheduleDto } from '@/api/types'
import { NdmBadge } from '@/components/ndm/Badge'
import { Chip } from '@/components/ndm/Chip'
import { StatusDot } from '@/components/ndm/StatusDot'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { humanCron } from '@/domain/jobForm'
import { kindLabel } from '@/domain/kind'
import { lastRunTone, scheduleBadge, symbolSummary, templateSummary } from '@/domain/scheduleView'
import { cn } from '@/lib/cn'
import { fmtAgo, fmtAhead } from '@/lib/format'
import { msToDateOrNull } from '@/api/normalize'

interface ScheduleCardProps {
  schedule: ScheduleDto
  jobs: JobDto[]
  symbols: string[]
  selected: boolean
  busy: boolean
  onSelect: () => void
  onToggle: () => void
  onRunNow: () => void
  onEdit: () => void
  onDelete: () => void
}

export function ScheduleCard({
  schedule,
  jobs,
  symbols,
  selected,
  busy,
  onSelect,
  onToggle,
  onRunNow,
  onEdit,
  onDelete,
}: ScheduleCardProps) {
  const badge = scheduleBadge(schedule, jobs)
  const tone = lastRunTone(jobs)

  const stop = (handler: () => void) => (event: React.MouseEvent) => {
    event.stopPropagation()
    handler()
  }

  return (
    <div
      onClick={onSelect}
      className={cn(
        'bg-card rounded-10 hover:border-b3 flex cursor-pointer flex-col gap-[10px] border p-[11px_13px]',
        selected ? 'border-acc-45' : 'border-b1',
      )}
      // The semantic edge: disabled greys out, a broken run turns it red.
      style={{ borderLeft: `3px solid ${badge.edge}` }}
    >
      <div className="flex items-center gap-[10px]">
        <span onClick={(event) => event.stopPropagation()}>
          {/* The vendored switch is sized in rem; the mockup specifies 34x19.
              Overriding on the same data-variant key lets tailwind-merge win. */}
          <Switch
            checked={schedule.enabled}
            onCheckedChange={onToggle}
            title={schedule.enabled ? 'Disable this schedule' : 'Enable this schedule'}
            className="data-[size=default]:h-[19px] data-[size=default]:w-[34px]"
          />
        </span>
        {/* Names are user-entered and the backend allows 200 characters, so
            this genuinely can be long enough to push the whole row apart. */}
        <span className="text-125 text-t1 min-w-0 truncate font-semibold" title={schedule.name}>
          {schedule.name}
        </span>
        <NdmBadge label={badge.label} className={badge.className} size="schedule" />

        <div className="flex-1" />

        <span className="text-105 text-t2 hidden max-w-[220px] min-w-0 truncate font-mono xl:block">
          {humanCron(schedule.cron)}
        </span>
        <Chip tone="track" className="text-95">
          {schedule.cron}
        </Chip>

        <Button
          variant="outline"
          size="xs"
          disabled={busy}
          title="Run this schedule immediately"
          onClick={stop(onRunNow)}
        >
          <Play size={10} fill="currentColor" strokeWidth={0} />
          {busy ? 'Running…' : 'Run now'}
        </Button>
        <Button variant="ghost" size="icon" title="Edit" onClick={stop(onEdit)}>
          <Pencil size={12} strokeWidth={2} />
        </Button>
        <Button variant="ghostDanger" size="icon" title="Delete" onClick={stop(onDelete)}>
          <Trash2 size={12} strokeWidth={2} />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-[8px]">
        <Chip tone="accent" className="text-95 px-[7px]">
          {kindLabel(schedule.template.data_type, schedule.template.bar_size)}
        </Chip>
        <Chip tone="track" className="text-95 px-[7px]">
          {symbolSummary(symbols)}
        </Chip>
        <Chip tone="track" className="text-t2 text-95 px-[7px]">
          {templateSummary(schedule)}
        </Chip>

        <div className="flex-1" />

        <span className="text-10 text-t2 flex items-center gap-[5px] font-mono">
          {tone && <StatusDot color={tone} size={6} />}
          {`last ${fmtAgo(msToDateOrNull(schedule.last_run_at))}`}
        </span>
        <span className="text-10 text-t2 font-mono">
          {/* A disabled schedule has a stale next_run_at; saying "in 14h" about
              a rule that will not fire is worse than saying nothing. */}
          {schedule.enabled ? `next ${fmtAhead(msToDateOrNull(schedule.next_run_at))}` : 'paused'}
        </span>
      </div>
    </div>
  )
}
