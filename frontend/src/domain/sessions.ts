/**
 * Trading-session parsing from IB `ContractDetails`.
 *
 * IB serialises hours as semicolon-separated day entries in one of two shapes:
 *
 *   20260721:0930-20260721:1600;20260722:CLOSED     (current)
 *   20090507:0700-1830,1830-2330;20090508:CLOSED    (legacy)
 *
 * We surface the first open day's outer bounds, which is what the sidebar's
 * SESSIONS field shows.
 */
export interface SessionSummary {
  /** e.g. "09:30–16:00" */
  hours: string
  /** IANA-ish zone straight from IB, e.g. "US/Eastern". */
  timezone: string | null
}

const asTime = (value: string): string | null => {
  const digits = value.match(/(\d{4})$/)?.[1]
  if (!digits) return null
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

export function parseSessions(
  hours: string | null | undefined,
  timezone?: string | null,
): SessionSummary | null {
  if (!hours) return null

  for (const day of hours.split(';')) {
    if (!day || day.includes('CLOSED')) continue

    // Ranges within a day are comma-separated; take the whole span.
    const ranges = day.split(':').slice(1).join(':').split(',')
    const first = ranges[0]
    const last = ranges[ranges.length - 1]
    if (!first || !last) continue

    const start = asTime(first.split('-')[0] ?? '')
    const end = asTime(last.split('-').pop() ?? '')
    if (!start || !end) continue

    return { hours: `${start}–${end}`, timezone: timezone ?? null }
  }
  return null
}

/** The single line rendered under SESSIONS. */
export function formatSessions(hours: string | null | undefined, timezone?: string | null): string {
  const parsed = parseSessions(hours, timezone)
  if (!parsed) return '—'
  return parsed.timezone ? `${parsed.hours} ${parsed.timezone}` : parsed.hours
}
