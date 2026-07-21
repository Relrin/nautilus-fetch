import { ChevronDown } from 'lucide-react'

import { BAR_SIZES, type BarSize } from '@/api/enums'
import { kindLabel, type KindValue } from '@/domain/kind'

/** The four the mockup exposes, listed first so the common cases stay one click away. */
const LEAD_BAR_SIZES: readonly BarSize[] = ['1 min', '5 mins', '1 hour', '1 day']
const REST_BAR_SIZES = BAR_SIZES.filter((size) => !LEAD_BAR_SIZES.includes(size))

/**
 * Native `<select>`, deliberately.
 *
 * The mockup specifies one down to the chevron position, and it lives inside a
 * scrolling dialog where a portalled listbox is a liability. Native also gets
 * type-ahead and platform keyboard behaviour for the 24 options for free.
 */
export function DataKindSelect({
  value,
  onChange,
}: {
  value: KindValue
  onChange: (next: KindValue) => void
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-panel border-b2 rounded-8 text-11 text-t1 focus:border-b3 h-[32px] w-full cursor-pointer appearance-none border px-[10px] font-mono outline-none"
      >
        <option value="ticks">trade ticks</option>
        <option value="quotes">quotes (L1 bid/ask)</option>
        <option value="depth">market depth (L2)</option>
        {/* All 21 IB bar sizes: hiding 17 supported timeframes behind no UI
            would be a defect, not a simplification. */}
        <optgroup label="bars">
          {LEAD_BAR_SIZES.map((size) => (
            <option key={size} value={`bars:${size}`}>
              {kindLabel('BARS', size)}
            </option>
          ))}
        </optgroup>
        <optgroup label="bars — all timeframes">
          {REST_BAR_SIZES.map((size) => (
            <option key={size} value={`bars:${size}`}>
              {`bars ${size}`}
            </option>
          ))}
        </optgroup>
      </select>
      <ChevronDown
        size={11}
        strokeWidth={2.4}
        className="text-t2 pointer-events-none absolute top-[11px] right-[10px]"
      />
    </div>
  )
}
