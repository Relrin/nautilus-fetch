import { Layers } from 'lucide-react'
import { useState } from 'react'

import { useConsolidate } from '@/api/mutations'
import type { ConsolidateBody } from '@/api/types'
import { Button } from '@/components/ui/button'
import { estimateAfterConsolidation } from '@/domain/catalogView'
import { fmtInt } from '@/lib/format'
import { useToasts } from '@/state/toastsContext'

export interface ConsolidateTarget {
  /** Human label for the scope, e.g. `Bars` or `AAPL.NASDAQ`. */
  label: string
  files: number
  body: ConsolidateBody
}

/**
 * Confirm, then run a blocking merge.
 *
 * **Honest deviation:** the mockup animates a percentage. There is none to
 * animate — `POST /api/catalog/consolidate` blocks and returns `{status:"ok"}`
 * with no progress stream, so the running phase is INDETERMINATE. Counting up a
 * fake percentage would be inventing data about someone's disk being rewritten.
 *
 * Not dismissible while running, and no close X: the request cannot be
 * cancelled, so offering a button that only hides it would be a lie.
 */
export function ConsolidateModal({
  target,
  onClose,
}: {
  target: ConsolidateTarget
  onClose: () => void
}) {
  const [running, setRunning] = useState(false)
  const consolidate = useConsolidate()
  const { push } = useToasts()

  const start = () => {
    setRunning(true)
    consolidate.mutate(target.body, {
      onSuccess: () => {
        push(`Consolidation complete · ${target.label}`, 'success')
        onClose()
      },
      onError: (error: Error) => {
        push(`Consolidation failed: ${error.message}`, 'danger')
        onClose()
      },
    })
  }

  return (
    <div
      // Backdrop-dismiss is deliberately absent even before starting, matching
      // the mockup: this is a disk-rewriting action, so it gets an explicit no.
      className="animate-ndm-fade fixed inset-0 z-[55] flex items-center justify-center bg-[rgba(3,12,16,.7)] backdrop-blur-[3px]"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Consolidate Parquet files"
        className="bg-card border-b3 rounded-13 animate-ndm-pop w-[440px] max-w-[calc(100vw-48px)] border p-[18px_20px] shadow-[0_24px_70px_rgba(0,0,0,.6)]"
      >
        <div className="mb-[12px] flex items-center gap-[9px]">
          <Layers size={16} strokeWidth={2} className="text-accent" />
          <span className="text-14 font-semibold">Consolidate Parquet files</span>
        </div>

        {running ? (
          <>
            <div className="text-115 text-t1b mb-[12px]">
              Merging <span className="text-t1 font-semibold">{target.label}</span> —{' '}
              {fmtInt(target.files)} files. Please keep this running.
            </div>
            <div className="mb-[6px] flex items-baseline justify-between">
              <span className="text-115 text-t2 font-mono">working…</span>
              <span className="text-10 text-t3 font-mono">rewriting row groups…</span>
            </div>
            {/* Indeterminate on purpose — see the note above. */}
            <div className="bg-track rounded-5 h-[8px] overflow-hidden">
              <div className="bg-accent animate-ndm-sweep rounded-5 h-full w-1/3" />
            </div>
            <div className="text-95 text-t3 mt-[8px]">
              The server does not report progress for this operation, so there is no percentage to
              show.
            </div>
          </>
        ) : (
          <>
            <div className="text-115 text-t1b mb-[12px] leading-[1.55]">
              Merge the many small Parquet files in{' '}
              <span className="text-t1 font-semibold">{target.label}</span> into fewer, larger
              files. This rewrites data on disk and can take a while — it should not be interrupted.
            </div>

            <div className="mb-[16px] flex items-center gap-[10px]">
              <Stat label="BEFORE" value={fileCount(target.files)} />
              <span className="text-t3">→</span>
              <Stat
                label="AFTER (EST.)"
                value={`~${fileCount(estimateAfterConsolidation(target.files))}`}
                accent
              />
            </div>

            <div className="flex justify-end gap-[8px]">
              <Button variant="outline" size="md" className="px-[13px]" onClick={onClose}>
                Cancel
              </Button>
              <Button size="md" onClick={start}>
                Start consolidation
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** A 25:1 estimate lands on 1 often enough that "~1 files" would show. */
const fileCount = (n: number): string => `${fmtInt(n)} file${n === 1 ? '' : 's'}`

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className="bg-panel border-b1 rounded-8 flex-1 border px-[12px] py-[10px]">
      <div className="text-t3 text-85 mb-[3px] font-semibold tracking-[1px]">{label}</div>
      <div className={`text-14 font-mono font-semibold ${accent ? 'text-accent' : 'text-t1'}`}>
        {value}
      </div>
    </div>
  )
}
