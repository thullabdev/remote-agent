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

/** Finished turns of one session this close together (by their ends) are one burst, shown as one line. */
export const BURST_MS = 30 * 60_000

export type RecentRow = { id: number; at: number; chatId: string; kind: ActivityKind; name: string }

/** A line of recent activity. `turns` counts finished turns (0 for started and ended); `firstAt` is the burst's oldest end. */
export type RecentEvent = {
  id: number
  at: number
  firstAt: number
  chatId: string
  kind: 'started' | 'finished' | 'ended'
  name: string
  turns: number
  preview: string | null
}

/**
 * Newest first in, newest first out. A started or ended session breaks its own burst; finished turns join the open burst of
 * their session while they stay within BURST_MS of its oldest end. The result stops at `limit` lines.
 */
export function groupRecent(rows: RecentRow[], limit: number): RecentEvent[] {
  const events: RecentEvent[] = []
  const open = new Map<string, RecentEvent>()
  for (const row of rows) {
    if (row.kind === 'turn_end') {
      const burst = open.get(row.chatId)
      if (burst !== undefined && burst.firstAt - row.at <= BURST_MS) {
        burst.turns += 1
        burst.firstAt = row.at
        continue
      }
      if (events.length >= limit) {
        break
      }
      const event: RecentEvent = { id: row.id, at: row.at, firstAt: row.at, chatId: row.chatId, kind: 'finished', name: row.name, turns: 1, preview: null }
      events.push(event)
      open.set(row.chatId, event)
      continue
    }
    open.delete(row.chatId)
    if (events.length >= limit) {
      break
    }
    events.push({ id: row.id, at: row.at, firstAt: row.at, chatId: row.chatId, kind: row.kind === 'started' ? 'started' : 'ended', name: row.name, turns: 0, preview: null })
  }
  return events
}
