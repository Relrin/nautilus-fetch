/**
 * Derived catalog state.
 *
 * `/api/catalog/summary` reports, per identifier, only a file count, a byte
 * total and the OUTER date bounds parsed from filenames. It says nothing about
 * what lies between them, which constrains everything here: the coverage strip
 * can honestly show extent, never continuity.
 */
import type { CatalogIdentifierDto, CatalogSummaryDto } from '@/api/types'

export type CatalogSort = 'size' | 'date'

export interface CatalogRowView extends CatalogIdentifierDto {
  /** Left offset 0..1 on the shared axis. */
  offset: number
  /** Width 0..1 on the shared axis. */
  width: number
}

export interface CatalogAxis {
  minMs: number
  maxMs: number
  /** Year labels under the detail strip. */
  ticks: string[]
}

/** Bars narrower than this vanish; a single-day file still deserves a mark. */
const MIN_WIDTH = 0.012

/**
 * The calendar day inside a catalog file timestamp.
 *
 * Nautilus names files `2023-10-26T07-30-50-123456789Z_<end>.parquet` — an ISO
 * date, then a time whose separators are HYPHENS. `_summary_sync` takes that
 * stem verbatim as `start`/`end`, and `Date.parse` rejects the hyphenated time
 * outright, yielding NaN. Everything here therefore works from the date part
 * only, which is also the precision the strip and row labels display.
 *
 * Tolerates a bare `YYYY-MM-DD` too, which is what older files and fixtures
 * look like.
 */
export function catalogDay(value: string | null | undefined): string | null {
  if (!value) return null
  const [day] = value.split('T')
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

const parse = (value: string | null): number | null => {
  const day = catalogDay(value)
  if (!day) return null
  // Anchored to UTC so a catalog date never shifts by the viewer's locale.
  const ms = Date.parse(`${day}T00:00:00Z`)
  return Number.isNaN(ms) ? null : ms
}

/**
 * Bounds spanning every identifier in the given rows.
 *
 * Derived from the data rather than hardcoded, so bars stay comparable to each
 * other. The mockup's fixed 2004–2026 axis would squash a catalog that only
 * holds one recent month into an invisible sliver at the right edge.
 */
export function catalogAxis(rows: CatalogIdentifierDto[]): CatalogAxis | null {
  const starts = rows.map((row) => parse(row.start)).filter((ms): ms is number => ms !== null)
  const ends = rows.map((row) => parse(row.end)).filter((ms): ms is number => ms !== null)
  if (starts.length === 0 || ends.length === 0) return null

  const minMs = Math.min(...starts)
  const maxMs = Math.max(...ends)
  return { minMs, maxMs, ticks: axisTicks(minMs, maxMs) }
}

/** Up to five evenly spaced year labels. */
function axisTicks(minMs: number, maxMs: number, count = 5): string[] {
  const startYear = new Date(minMs).getUTCFullYear()
  const endYear = new Date(maxMs).getUTCFullYear()
  if (endYear <= startYear) return [String(startYear)]

  const span = endYear - startYear
  const step = Math.max(1, Math.round(span / (count - 1)))
  const ticks: string[] = []
  for (let year = startYear; year <= endYear; year += step) ticks.push(String(year))
  if (ticks.at(-1) !== String(endYear)) ticks.push(String(endYear))
  return ticks
}

/** Place one identifier on the shared axis. */
export function coverageBar(
  row: CatalogIdentifierDto,
  axis: CatalogAxis | null,
): { offset: number; width: number } {
  const start = parse(row.start)
  const end = parse(row.end)
  if (!axis || start === null || end === null) return { offset: 0, width: 0 }

  const total = axis.maxMs - axis.minMs
  // A catalog holding a single day has no span; showing a full-width bar is
  // the honest answer, not a divide-by-zero.
  if (total <= 0) return { offset: 0, width: 1 }

  // Width first, floor included — then pull the offset back so the bar always
  // fits. Flooring the width *after* clamping to `1 - offset` overflows the
  // track for anything ending at the axis maximum, which is the common case for
  // the most recently written instrument.
  const width = Math.min(1, Math.max(MIN_WIDTH, (end - start) / total))
  const offset = Math.max(0, Math.min((start - axis.minMs) / total, 1 - width))
  return { offset, width }
}

/**
 * Rows for one data type, sorted and placed on the shared axis.
 *
 * `size` is bytes descending — the question it answers is "what is eating the
 * disk". `date` is earliest-start ascending, which reads as a history.
 */
export function catalogRows(
  summary: CatalogSummaryDto | undefined,
  dataType: string,
  sort: CatalogSort,
): { rows: CatalogRowView[]; axis: CatalogAxis | null } {
  const identifiers =
    summary?.classes.find((entry) => entry.data_type === dataType)?.identifiers ?? []
  const axis = catalogAxis(identifiers)

  const sorted = [...identifiers].sort((a, b) => {
    if (sort === 'size') return b.bytes - a.bytes
    return (parse(a.start) ?? 0) - (parse(b.start) ?? 0)
  })

  return {
    rows: sorted.map((row) => ({ ...row, ...coverageBar(row, axis) })),
    axis,
  }
}

export interface CatalogTypeTotals {
  identifiers: number
  files: number
  bytes: number
}

/** Per-type aggregates for the rail. Types with no data still report zeroes. */
export function typeTotals(
  summary: CatalogSummaryDto | undefined,
  dataType: string,
): CatalogTypeTotals {
  const identifiers =
    summary?.classes.find((entry) => entry.data_type === dataType)?.identifiers ?? []
  return {
    identifiers: identifiers.length,
    files: identifiers.reduce((sum, row) => sum + row.files, 0),
    bytes: identifiers.reduce((sum, row) => sum + row.bytes, 0),
  }
}

/**
 * Rough post-consolidation file count.
 *
 * `CatalogWriter` merges per-chunk files into far fewer row groups; 25:1 is the
 * mockup's stated ratio and is labelled EST. in the UI. It is a hint about
 * magnitude, not a promise — the real number depends on row-group sizing.
 */
export const estimateAfterConsolidation = (files: number): number =>
  Math.max(1, Math.ceil(files / 25))

/** Average bytes per file, for the detail aside. */
export const averageFileBytes = (row: CatalogIdentifierDto): number =>
  row.files > 0 ? row.bytes / row.files : 0
