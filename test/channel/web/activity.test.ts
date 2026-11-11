import { expect, test } from 'bun:test'
import { BURST_MS, buildDays, dayKey, groupRecent, MAX_TURN_MS, type ActivityRow, type RecentRow } from '../../../src/channel/web/activity.ts'

const HOUR = 3_600_000
const noon = Date.UTC(2026, 10, 10, 12)

test('a day is the viewer\'s day: the same moment falls on different dates east and west of UTC', () => {
  const lateEvening = Date.UTC(2026, 10, 10, 23, 30)
  expect(dayKey(lateEvening, 0)).toBe('2026-11-10')
  expect(dayKey(lateEvening, 7 * 60)).toBe('2026-11-11')
  expect(dayKey(lateEvening, -8 * 60)).toBe('2026-11-10')
  expect(dayKey(Date.UTC(2026, 10, 10, 3), -8 * 60)).toBe('2026-11-09')
})

test('days run oldest first, ending today, with empty days as zeros', () => {
  const days = buildDays([], noon, 3, 0)
  expect(days.map(day => day.date)).toEqual(['2026-11-08', '2026-11-09', '2026-11-10'])
  expect(days.every(day => day.sessionsStarted === 0 && day.turnsCompleted === 0 && day.workedMs === 0)).toBe(true)
})

test('rows land on their day, and starts and turn ends are counted separately', () => {
  const rows: ActivityRow[] = [
    { at: noon - 24 * HOUR, kind: 'started', ms: 0 },
    { at: noon - 24 * HOUR, kind: 'turn_end', ms: 5 * 60_000 },
    { at: noon, kind: 'turn_start', ms: 0 },
    { at: noon, kind: 'turn_end', ms: 60_000 },
    { at: noon, kind: 'turn_end', ms: 30_000 },
    { at: noon, kind: 'ended', ms: 0 },
    { at: noon - 10 * 24 * HOUR, kind: 'started', ms: 0 },
  ]
  const [yesterday, today] = buildDays(rows, noon, 2, 0)
  expect(yesterday).toMatchObject({ sessionsStarted: 1, turnsCompleted: 1, workedMs: 300_000 })
  expect(today).toMatchObject({ sessionsStarted: 0, turnsCompleted: 2, workedMs: 90_000 })
})

test('a turn longer than the cap counts as the cap', () => {
  const [today] = buildDays([{ at: noon, kind: 'turn_end', ms: 100 * HOUR }], noon, 1, 0)
  expect(today?.workedMs).toBe(MAX_TURN_MS)
})

const row = (id: number, at: number, kind: RecentRow['kind'], chatId = 'a', name = 'api'): RecentRow => ({ id, at, chatId, kind, name })

test('finished turns of one session within the burst window are one line, newest first', () => {
  const rows = [row(5, 3_000, 'turn_end'), row(4, 2_000, 'turn_end'), row(3, 1_000, 'turn_end')]
  expect(groupRecent(rows, 8)).toEqual([
    { id: 5, at: 3_000, firstAt: 1_000, chatId: 'a', kind: 'finished', name: 'api', turns: 3, preview: null },
  ])
})

test('a turn long after the burst starts a new line, and a start or end breaks the burst', () => {
  const gap = BURST_MS + 1
  const rows = [row(4, 3_000 + gap, 'turn_end'), row(3, 3_000, 'turn_end'), row(2, 2_000, 'started'), row(1, 1_000, 'turn_end')]
  const lines = groupRecent(rows, 8)
  expect(lines.map(line => [line.kind, line.turns])).toEqual([['finished', 1], ['finished', 1], ['started', 0], ['finished', 1]])
})

test('bursts of different sessions do not merge, and the limit counts lines', () => {
  const rows = [row(3, 3_000, 'turn_end', 'a'), row(2, 2_000, 'turn_end', 'b'), row(1, 1_000, 'turn_end', 'a')]
  // Session a's two ends merge into one line even though session b's end falls between them.
  expect(groupRecent(rows, 8).map(line => [line.chatId, line.turns])).toEqual([['a', 2], ['b', 1]])
  expect(groupRecent(rows, 1)).toHaveLength(1)
})
