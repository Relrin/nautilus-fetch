import { useMemo } from 'react'

import { useRetryFailed } from '@/api/mutations'
import { useFailures } from '@/api/queries'
import type { JobDto } from '@/api/types'
import { Panel } from '@/components/ndm/Panel'
import { Button } from '@/components/ui/button'
import { fmtInt } from '@/lib/format'
import { useToasts } from '@/state/toastsContext'

const SHOWN = 4

/** Red-tinted panel listing the most recent failed chunks, with a bulk retry. */
export function FailuresPanel({ job }: { job: JobDto }) {
  const { data, isLoading } = useFailures(job.id, job.failed_chunks)
  const retry = useRetryFailed()
  const { push } = useToasts()

  // The endpoint does not promise an order, so sort explicitly rather than
  // labelling whatever arrives first as "the latest".
  const sorted = useMemo(() => [...(data ?? [])].sort((a, b) => b.seq - a.seq), [data])
  const shown = sorted.slice(0, SHOWN)
  const hidden = Math.max(0, sorted.length - shown.length)

  return (
    <Panel tone="danger" title={`FAILURES (${fmtInt(job.failed_chunks)})`}>
      {isLoading && shown.length === 0 ? (
        <div className="text-t3 text-98 font-mono">loading…</div>
      ) : (
        <ul className="flex flex-col gap-[3px]">
          {shown.map((failure) => (
            <li
              key={failure.chunk_id}
              className="text-98 text-t1b truncate font-mono"
              title={failure.error ?? undefined}
            >
              <span className="text-t3">{`#${failure.seq} `}</span>
              {failure.instrument_id}
              <span className="text-t3">{` · ${failure.attempts}× · `}</span>
              <span className="text-danger">
                {failure.error_code !== null ? `[${failure.error_code}] ` : ''}
                {failure.error ?? 'unknown error'}
              </span>
            </li>
          ))}
        </ul>
      )}

      {hidden > 0 && (
        <div className="text-t3 text-98 mt-[5px] font-mono">{`+ ${hidden} more…`}</div>
      )}

      <Button
        variant="danger"
        size="blockSm"
        className="mt-[9px]"
        disabled={retry.isPending}
        title="Return every failed chunk on this job to the queue"
        onClick={() =>
          retry.mutate(job.id, {
            onSuccess: () => push(`${fmtInt(job.failed_chunks)} chunks returned to the queue`),
            onError: (error) => push(`Could not retry: ${error.message}`, 'danger'),
          })
        }
      >
        {retry.isPending ? 'Requeueing…' : 'Retry failed chunks'}
      </Button>
    </Panel>
  )
}
