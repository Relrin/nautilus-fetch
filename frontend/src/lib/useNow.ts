import { useEffect, useState } from 'react'

/**
 * A clock that re-renders its caller on an interval.
 *
 * Elapsed time and ETA are derived from `Date.now()`, not from anything on the
 * wire, so without a local tick they only advance when some *other* update
 * happens to re-render. That matters most for DEPTH recorders: the backend
 * sends nothing between five-minute buffer flushes, so a frozen clock would
 * read as a hung job for minutes at a stretch.
 *
 * Pass `enabled: false` for terminal jobs — their elapsed time is pinned to
 * `finished_at` and re-rendering once a second would be pure waste.
 */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs, enabled])

  return now
}
