import { CalendarClock } from 'lucide-react'
import type { ReactNode } from 'react'

import { msToDateOrNull } from '@/api/normalize'
import { useCatalogSummary } from '@/api/queries'
import type { JobDto, ScheduleDto } from '@/api/types'
import { NdmBadge } from '@/components/ndm/Badge'
import { Chip } from '@/components/ndm/Chip'
import { PaneEmptyState } from '@/components/ndm/EmptyState'
import { DividerLabel, Eyebrow } from '@/components/ndm/Eyebrow'
import { SectionHeader } from '@/components/ndm/SectionHeader'
import { Button } from '@/components/ui/button'
import { humanCron } from '@/domain/jobForm'
import { kindLabel } from '@/domain/kind'
import { scheduleBadge, symbolSummary } from '@/domain/scheduleView'
import { fmtAgo, fmtAhead } from '@/lib/format'

import { RunHistoryList } from './RunHistoryList'

interface ScheduleDetailAsideProps {
  schedule: ScheduleDto | undefined
  jobs: JobDto[]
  symbols: string[]
  busy: boolean
  onRunNow: () => void
  onEdit: () => void
  onOpenJob: (jobId: string) => void
}

export function ScheduleDetailAside({
  schedule,
  jobs,
  symbols,
  busy,
  onRunNow,
  onEdit,
  onOpenJob,
}: ScheduleDetailAsideProps) {
  const catalog = useCatalogSummary()

  return (
    <aside className="border-b1 bg-bar flex min-h-0 flex-col border-l">
      <SectionHeader className="gap-[8px]">
        <Eyebrow variant="pane">SCHEDULE</Eyebrow>
      </SectionHeader>

      {!schedule ? (
        <PaneEmptyState
          icon={<CalendarClock size={22} strokeWidth={1.8} className="text-b3" />}
          title="Select a schedule"
          body="Its template, timing and run history show up here."
        />
      ) : (
        <div className="animate-ndm-fade flex min-h-0 flex-1 flex-col gap-[12px] overflow-y-auto px-[14px] pt-[13px] pb-[20px]">
          <div>
            <div className="mb-[5px] flex items-center gap-[8px]">
              <span className="text-13 text-t1 min-w-0 flex-1 truncate font-bold">
                {schedule.name}
              </span>
              <NdmBadge
                label={scheduleBadge(schedule, jobs).label}
                className={scheduleBadge(schedule, jobs).className}
                size="schedule"
              />
            </div>
            <div className="text-105 text-t2 font-mono">
              {`${humanCron(schedule.cron)} · ${schedule.cron}`}
            </div>
          </div>

          <div className="flex flex-wrap gap-[5px]">
            <Chip tone="config">
              {kindLabel(schedule.template.data_type, schedule.template.bar_size)}
            </Chip>
            {schedule.template.what_to_show && (
              <Chip tone="config">{schedule.template.what_to_show}</Chip>
            )}
            <Chip tone="config">{schedule.template.use_rth ? 'RTH only' : 'all hours'}</Chip>
            {/* Spelled out here, unlike the card's terse `6w · 3r · lag 30m`:
                the aside has the width and this is where someone reads config. */}
            <Chip tone="config" title="Parallel workers">
              {`${schedule.template.workers ?? 4} workers`}
            </Chip>
            <Chip tone="config" title="Max retries per chunk">
              {`retries ${schedule.template.max_retries}`}
            </Chip>
            <Chip tone="config" title="Stay this far behind real time so data settles">
              {`lag ${schedule.template.lag_minutes}m`}
            </Chip>
            <Chip tone="config" title="Days fetched on a first run or for a newly added instrument">
              {`lookback ${schedule.template.lookback_days}d`}
            </Chip>
            {/* Always shown, both ways: "no catch-up chip" is ambiguous between
                off and not-applicable, and this decides whether a restart
                replays missed runs. */}
            <Chip tone="config" title="Whether missed runs are replayed when the server restarts">
              {schedule.catchup ? 'catchup on' : 'catchup off'}
            </Chip>
          </div>

          <div className="border-b1 bg-panel rounded-8 flex flex-col gap-[8px] border px-[12px] py-[10px]">
            <Row label="instruments" value={symbolSummary(symbols)} />
            <Row label="last run" value={fmtAgo(msToDateOrNull(schedule.last_run_at))} />
            <Row
              label="next run"
              value={
                schedule.enabled
                  ? fmtAhead(msToDateOrNull(schedule.next_run_at))
                  : 'paused — will not fire'
              }
            />
            <Row label="output" value={catalog.data?.path ?? '—'} />
          </div>

          <div className="flex gap-[8px]">
            <Button size="md" className="flex-1" disabled={busy} onClick={onRunNow}>
              {busy ? 'Running…' : 'Run now'}
            </Button>
            <Button variant="outline" size="md" className="flex-1" onClick={onEdit}>
              Edit
            </Button>
          </div>

          <DividerLabel className="mt-[2px]">RUN HISTORY</DividerLabel>
          <RunHistoryList jobs={jobs} onOpenJob={onOpenJob} />
        </div>
      )}
    </aside>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="text-105 flex justify-between gap-[10px] font-mono">
      <span className="text-t3 flex-none">{label}</span>
      <span className="text-t1 text-right break-all">{value}</span>
    </div>
  )
}
