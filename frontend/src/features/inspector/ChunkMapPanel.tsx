import { Panel } from '@/components/ndm/Panel'
import type { CellState, ChunkBuffer } from '@/domain/chunkMap'
import { cn } from '@/lib/cn'

const CELL_CLASS: Record<CellState, string> = {
  done: 'bg-chunk-done',
  active: 'bg-accent animate-ndm-cell',
  failed: 'bg-danger',
  pending: 'bg-track',
}

const LEGEND: { state: CellState; label: string }[] = [
  { state: 'done', label: 'done' },
  { state: 'active', label: 'active' },
  { state: 'failed', label: 'failed' },
  { state: 'pending', label: 'pending' },
]

interface ChunkMapPanelProps {
  buffer: ChunkBuffer | undefined
  /** Recorders grow segments instead of burning down a plan; caption differs. */
  recorder: boolean
}

/**
 * The folded chunk grid.
 *
 * Kept for DEPTH recorders too: a recorder's segments *are* chunks, and a
 * steadily growing green grid is the clearest signal that a live capture is
 * healthy — which is otherwise hard to see, since a recorder has no percentage.
 */
export function ChunkMapPanel({ buffer, recorder }: ChunkMapPanelProps) {
  const cells = buffer?.fold() ?? []
  const caption = recorder ? '1 cell = 1 segment (~5 min)' : (buffer?.scaleLabel() ?? '')

  return (
    <Panel title="CHUNK MAP" caption={caption}>
      {cells.length === 0 ? (
        <div className="text-t3 text-95 mb-[9px] py-[6px] font-mono">
          {recorder ? 'no segments flushed yet' : 'no chunks planned yet'}
        </div>
      ) : (
        <div className="mb-[9px] flex flex-wrap gap-[3px]">
          {cells.map((state, index) => (
            <span
              key={index}
              className={cn('rounded-[3px]', CELL_CLASS[state])}
              style={{ width: 13, height: 13 }}
            />
          ))}
        </div>
      )}

      <div className="text-t2 text-95 flex flex-wrap items-center gap-[12px]">
        {LEGEND.map(({ state, label }) => (
          <span key={state} className="flex items-center gap-[5px]">
            <span
              className={cn('rounded-[2px]', CELL_CLASS[state])}
              style={{ width: 8, height: 8 }}
            />
            {label}
          </span>
        ))}
      </div>
    </Panel>
  )
}
