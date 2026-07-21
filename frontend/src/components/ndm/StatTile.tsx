import { cn } from '@/lib/cn'

interface StatTileProps {
  /** Authored in caps: CHUNKS, FAILED, DOWNLOADED, ... */
  label: string
  value: string
  /** Failed counts turn red once non-zero. */
  tone?: 'default' | 'danger'
  title?: string
}

export function StatTile({ label, value, tone = 'default', title }: StatTileProps) {
  return (
    <div className="border-b1 bg-panel rounded-8 border px-[10px] py-[8px]" title={title}>
      <div className="text-t3 text-8 mb-[3px] font-semibold tracking-[1px]">{label}</div>
      <div className={cn('text-115 font-mono', tone === 'danger' ? 'text-danger' : 'text-t1')}>
        {value}
      </div>
    </div>
  )
}
