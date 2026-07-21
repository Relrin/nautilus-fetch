/** Display formatters, matching the mockup's output exactly. */

/** `3.92 GB` / `641 MB` / `12.0 MB` / `812 KB` — 0 decimals at >=100MB. */
export function fmtBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—'
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(bytes >= 1e8 ? 0 : 1)} MB`
  return `${Math.max(0, bytes / 1e3).toFixed(0)} KB`
}

export function fmtRate(bytesPerSec: number | null | undefined): string {
  if (!bytesPerSec) return '—'
  if (bytesPerSec >= 1e6) return `${(bytesPerSec / 1e6).toFixed(1)} MB/s`
  return `${(bytesPerSec / 1e3).toFixed(0)} KB/s`
}

/** `3.4k` / `1.8M` — the mockup's compact row counts. */
export function fmtRows(rows: number | null | undefined): string {
  if (rows === null || rows === undefined) return '—'
  if (rows >= 1e6) return `${(rows / 1e6).toFixed(1)}M`
  if (rows >= 1e3) return `${(rows / 1e3).toFixed(1)}k`
  return String(Math.round(rows))
}

export const fmtInt = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : Math.round(value).toLocaleString('en-US')

/** `45s` / `4m 12s` / `1h 05m`. */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds < 0) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    return `${minutes}m ${String(Math.round(seconds % 60)).padStart(2, '0')}s`
  }
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${String(minutes).padStart(2, '0')}m`
}

/** Elapsed clock for DEPTH recorders: `2:14:07`. */
export function fmtClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function fmtAgo(date: Date | null, now: number = Date.now()): string {
  if (!date) return 'never'
  const seconds = Math.max(0, (now - date.getTime()) / 1000)
  if (seconds < 75) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86_400)}d ago`
}

export function fmtAhead(date: Date | null, now: number = Date.now()): string {
  if (!date) return '—'
  const seconds = (date.getTime() - now) / 1000
  if (seconds < 0) return 'due now'
  if (seconds < 3600) return `in ${Math.round(seconds / 60)}m`
  if (seconds < 86_400) return `in ${Math.round(seconds / 3600)}h`
  return `in ${Math.round(seconds / 86_400)}d`
}

/** `Mon 14:30` — weekday plus 24h time, for schedule run stamps. */
export function fmtWeekdayClock(date: Date | null): string {
  if (!date) return '—'
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()]
  return `${day} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** `2023-01-02` in UTC — job ranges are UTC and must not shift by locale. */
export function fmtDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : '—'
}

export function fmtDateTime(date: Date | null): string {
  return date ? date.toISOString().slice(0, 16).replace('T', ' ') : '—'
}

/** `64.3%` */
export const fmtPct = (fraction: number, digits = 1): string =>
  `${(fraction * 100).toFixed(digits)}%`
