import type { ActivityDay } from './protocol.ts'

// The daily numbers behind the dashboard's Today card. Rows are what the ChatLog recorded as it happened.

/** What the ChatLog records: a session appearing, a turn starting or ending (with how long it ran), a session ending. */
export type ActivityKind = 'started' | 'turn_start' | 'turn_end' | 'ended'

export type ActivityRow = { at: number; kind: ActivityKind; ms: number }

const DAY_MS = 86_400_000
/** A turn longer than this is a missed end, not work: it is counted as the cap. */
export const MAX_TURN_MS = 12 * 3_600_000
/** How long rows are kept. */
export const ACTIVITY_KEEP_DAYS = 30

/** The calendar day (YYYY-MM-DD) of a moment for someone `offsetMinutes` east of UTC. */
export function dayKey(at: number, offsetMinutes: number): string {
  return new Date(at + offsetMinutes * 60_000).toISOString().slice(0, 10)
}

/** One entry per day ending today, oldest first, with days that had nothing as zeros. */
export function buildDays(rows: ActivityRow[], now: number, days: number, offsetMinutes: number): ActivityDay[] {
  const buckets = new Map<string, ActivityDay>()
  for (let back = days - 1; back >= 0; back -= 1) {
    const date = dayKey(now - back * DAY_MS, offsetMinutes)
    buckets.set(date, { date, sessionsStarted: 0, turnsCompleted: 0, workedMs: 0 })
  }
  for (const row of rows) {
    const bucket = buckets.get(dayKey(row.at, offsetMinutes))
    if (bucket === undefined) {
      continue
    }
    if (row.kind === 'started') {
      bucket.sessionsStarted += 1
    } else if (row.kind === 'turn_end') {
      bucket.turnsCompleted += 1
      bucket.workedMs += Math.min(row.ms, MAX_TURN_MS)
    }
  }
  return [...buckets.values()]
}
