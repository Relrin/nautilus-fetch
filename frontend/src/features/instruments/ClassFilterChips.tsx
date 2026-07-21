import { cn } from '@/lib/cn'
import { CLASS_FILTERS, type InstrumentClass } from '@/domain/instrumentClass'

interface ClassFilterChipsProps {
  value: InstrumentClass | null
  onChange: (next: InstrumentClass | null) => void
}

export function ClassFilterChips({ value, onChange }: ClassFilterChipsProps) {
  return (
    <div className="flex flex-wrap gap-[4px]">
      <Chip label="ALL" active={value === null} onClick={() => onChange(null)} />
      {CLASS_FILTERS.map((cls) => (
        <Chip
          key={cls}
          label={cls}
          active={value === cls}
          onClick={() => onChange(value === cls ? null : cls)}
          title={
            cls === 'ETF'
              ? 'ETF detection needs contract details; select a stock to load them'
              : undefined
          }
        />
      ))}
    </div>
  )
}

function Chip({
  label,
  active,
  onClick,
  title,
}: {
  label: string
  active: boolean
  onClick: () => void
  title?: string | undefined
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'text-10 rounded-6 hover:border-b3 cursor-pointer border px-[8px] py-[3.5px] font-mono font-medium',
        active ? 'bg-acc-12 text-accent border-acc-40' : 'bg-card text-t2 border-b2',
      )}
    >
      {label}
    </button>
  )
}
