import { cn } from '@/lib/cn'

interface StepperProps {
  value: number
  onChange: (next: number) => void
  min: number
  max: number
  step?: number
  /** Wider cell for 2-3 digit values like lag minutes. */
  wide?: boolean
  disabled?: boolean
  decrementTitle?: string
  incrementTitle?: string
}

/** Segmented −/value/+ control. The minus is U+2212, not a hyphen. */
export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  wide = false,
  disabled = false,
  decrementTitle,
  incrementTitle,
}: StepperProps) {
  const clamp = (next: number) => Math.max(min, Math.min(max, next))

  return (
    <div
      className={cn(
        'border-b2 rounded-7 flex items-center overflow-hidden border',
        disabled && 'opacity-45',
      )}
    >
      <button
        type="button"
        title={decrementTitle}
        disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - step))}
        className="bg-panel text-t1b hover:bg-b1 hover:text-t1 h-[24px] w-[22px] cursor-pointer leading-none disabled:pointer-events-none disabled:opacity-40"
      >
        −
      </button>
      <span
        className={cn(
          'text-11 text-t1 text-center font-mono font-semibold',
          wide ? 'w-[28px]' : 'w-[24px]',
        )}
      >
        {value}
      </span>
      <button
        type="button"
        title={incrementTitle}
        disabled={disabled || value >= max}
        onClick={() => onChange(clamp(value + step))}
        className="bg-panel text-t1b hover:bg-b1 hover:text-t1 h-[24px] w-[22px] cursor-pointer leading-none disabled:pointer-events-none disabled:opacity-40"
      >
        +
      </button>
    </div>
  )
}
