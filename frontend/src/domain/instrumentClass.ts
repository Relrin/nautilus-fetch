/**
 * Asset-class classification for the sidebar filter chips.
 *
 * IB's `secType` is the raw wire value; `FX` is `CASH`, and `ETF` is not a
 * secType at all — it needs `details.stockType`, which `/search` does not
 * return. So the ETF chip is only accurate for instruments whose details have
 * already been fetched. That is a real limitation, surfaced in the UI rather
 * than papered over.
 */
export const INSTRUMENT_CLASSES = [
  'FX',
  'STOCK',
  'ETF',
  'FUTURES',
  'OPTIONS',
  'CRYPTO',
  'OTHER',
] as const
export type InstrumentClass = (typeof INSTRUMENT_CLASSES)[number]

/** Chip order in the sidebar. `ALL` is rendered separately. */
export const CLASS_FILTERS: readonly InstrumentClass[] = [
  'FX',
  'STOCK',
  'ETF',
  'FUTURES',
  'OPTIONS',
  'CRYPTO',
]

export const CLASS_COLOR: Record<InstrumentClass, { fg: string; bg: string }> = {
  FX: { fg: 'text-info', bg: 'bg-info/10' },
  STOCK: { fg: 'text-t1b', bg: 'bg-t1b/10' },
  ETF: { fg: 'text-success', bg: 'bg-success/10' },
  FUTURES: { fg: 'text-warning', bg: 'bg-warning/10' },
  OPTIONS: { fg: 'text-options', bg: 'bg-options/10' },
  CRYPTO: { fg: 'text-crypto', bg: 'bg-crypto/10' },
  OTHER: { fg: 'text-t3', bg: 'bg-track' },
}

export function classifyInstrument(secType: string, stockType?: string | null): InstrumentClass {
  switch (secType) {
    case 'CASH':
      return 'FX'
    case 'STK':
      return stockType?.toUpperCase() === 'ETF' ? 'ETF' : 'STOCK'
    case 'FUT':
    case 'FOP':
    case 'CONTFUT':
      return 'FUTURES'
    case 'OPT':
      return 'OPTIONS'
    case 'CRYPTO':
      return 'CRYPTO'
    default:
      return 'OTHER'
  }
}

/**
 * Whether L2 depth is even offered for this instrument type.
 *
 * IB reports depth *entitlement* only by attempting a subscription, so this is
 * a capability hint, never a guarantee. The mockup's `L2✕` badge would be
 * confidently wrong about the exact thing users pay for, so it is not rendered.
 */
export const maySupportDepth = (secType: string): boolean =>
  ['STK', 'FUT', 'CASH', 'FOP', 'CONTFUT'].includes(secType)
