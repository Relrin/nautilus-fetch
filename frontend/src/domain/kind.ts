/**
 * The single bidirectional map between the mockup's `kind` and the backend's
 * `data_type` + `bar_size`. Everything that needs to name a data kind goes
 * through here.
 */
import { BAR_SIZES, type BarSize, type DataType } from '@/api/enums'
import type { JobParams } from '@/api/types'

export type Kind = 'ticks' | 'quotes' | 'depth' | 'm1' | 'm5' | 'h1' | 'd1'

interface KindSpec {
  data_type: DataType
  bar_size: BarSize | null
  label: string
}

const TABLE: Record<Kind, KindSpec> = {
  ticks: { data_type: 'TRADE_TICKS', bar_size: null, label: 'trade ticks' },
  quotes: { data_type: 'QUOTE_TICKS', bar_size: null, label: 'quotes L1' },
  depth: { data_type: 'DEPTH', bar_size: null, label: 'depth L2' },
  m1: { data_type: 'BARS', bar_size: '1 min', label: 'bars M1' },
  m5: { data_type: 'BARS', bar_size: '5 mins', label: 'bars M5' },
  h1: { data_type: 'BARS', bar_size: '1 hour', label: 'bars H1' },
  d1: { data_type: 'BARS', bar_size: '1 day', label: 'bars D1' },
}

export const toBackend = (kind: Kind): { data_type: DataType; bar_size: BarSize | null } => ({
  data_type: TABLE[kind].data_type,
  bar_size: TABLE[kind].bar_size,
})

/**
 * Human label for a job's data kind.
 *
 * 17 of the 21 supported bar sizes have no mockup `kind`. Those render their
 * raw IB string (`15 mins`, `4 hours`) rather than being collapsed into the
 * nearest shorthand, which would misreport what was actually fetched.
 */
export function kindLabel(dataType: DataType, barSize?: string | null): string {
  if (dataType !== 'BARS') {
    const match = Object.values(TABLE).find((spec) => spec.data_type === dataType)
    return match?.label ?? dataType.toLowerCase()
  }
  if (!barSize) return 'bars'
  const shorthand = Object.values(TABLE).find(
    (spec) => spec.data_type === 'BARS' && spec.bar_size === barSize,
  )
  return shorthand?.label ?? `bars ${barSize}`
}

/** The chip on a job card: `parquet / bars M1`. */
export const formatChipLabel = (dataType: DataType, params: JobParams): string =>
  `parquet / ${kindLabel(dataType, params.bar_size)}`

/**
 * The data-kind select's value encoding: `ticks` | `quotes` | `depth` |
 * `bars:<size>`. One string keeps `data_type` and `bar_size` from drifting
 * apart in form state.
 */
export type KindValue = string

export const kindValueOf = (dataType: DataType, barSize: BarSize | null): KindValue => {
  if (dataType === 'TRADE_TICKS') return 'ticks'
  if (dataType === 'QUOTE_TICKS') return 'quotes'
  if (dataType === 'DEPTH') return 'depth'
  return `bars:${barSize ?? '1 min'}`
}

export function parseKindValue(value: KindValue): { dataType: DataType; barSize: BarSize | null } {
  if (value === 'ticks') return { dataType: 'TRADE_TICKS', barSize: null }
  if (value === 'quotes') return { dataType: 'QUOTE_TICKS', barSize: null }
  if (value === 'depth') return { dataType: 'DEPTH', barSize: null }
  return { dataType: 'BARS', barSize: value.slice('bars:'.length) as BarSize }
}

export const isBarSize = (value: string): value is BarSize =>
  (BAR_SIZES as readonly string[]).includes(value)

/** Options for the data-kind select: all 21 bar sizes, not just the mockup's four. */
export const BAR_SIZE_OPTIONS: readonly BarSize[] = BAR_SIZES
