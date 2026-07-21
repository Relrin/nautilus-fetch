/** Wire enums, verbatim from the backend. Changing a string here breaks the API. */

export const JOB_STATES = [
  'queued',
  'running',
  'paused',
  'completed',
  'completed_with_failures',
  'canceled',
  'failed',
] as const
export type JobState = (typeof JOB_STATES)[number]

/** Jobs the queue pane shows; everything else is history. */
export const ACTIVE_JOB_STATES: readonly JobState[] = ['queued', 'running', 'paused']
export const TERMINAL_JOB_STATES: readonly JobState[] = [
  'completed',
  'completed_with_failures',
  'canceled',
  'failed',
]

export const CHUNK_STATES = ['pending', 'active', 'done', 'empty', 'failed'] as const
export type ChunkState = (typeof CHUNK_STATES)[number]

/** api/ws.py CHUNK_STATE_CODES — the wire encoding for chunk cells. */
export const CHUNK_CODE = {
  pending: 0,
  active: 1,
  done: 2,
  empty: 3,
  failed: 4,
} as const satisfies Record<ChunkState, number>

export const DATA_TYPES = ['BARS', 'TRADE_TICKS', 'QUOTE_TICKS', 'DEPTH'] as const
export type DataType = (typeof DATA_TYPES)[number]

/** BARS only — the backend forces TRADES/BID_ASK for tick types. */
export const WHAT_TO_SHOW = ['TRADES', 'MIDPOINT', 'BID', 'ASK'] as const
export type WhatToShow = (typeof WHAT_TO_SHOW)[number]

export const CONN_STATES = ['disconnected', 'connecting', 'connected', 'degraded'] as const
export type ConnState = (typeof CONN_STATES)[number]

/**
 * All 21 IB bar sizes, in engine/barsize.py order. The mockup exposes only four;
 * hiding the other 17 supported timeframes behind no UI would be a defect.
 */
export const BAR_SIZES = [
  '1 secs',
  '5 secs',
  '10 secs',
  '15 secs',
  '30 secs',
  '1 min',
  '2 mins',
  '3 mins',
  '5 mins',
  '10 mins',
  '15 mins',
  '20 mins',
  '30 mins',
  '1 hour',
  '2 hours',
  '3 hours',
  '4 hours',
  '8 hours',
  '1 day',
  '1 week',
  '1 month',
] as const
export type BarSize = (typeof BAR_SIZES)[number]

/** Catalog data-type directories, in the order the type rail lists them. */
export const CATALOG_TYPES = ['bar', 'trade_tick', 'quote_tick', 'order_book_depth10'] as const
export type CatalogType = (typeof CATALOG_TYPES)[number]

export const CATALOG_TYPE_LABEL: Record<CatalogType, string> = {
  bar: 'Bars',
  trade_tick: 'Trade ticks',
  quote_tick: 'Quote ticks',
  order_book_depth10: 'Order book (depth-10)',
}
