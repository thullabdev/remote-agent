import { expect, test } from 'bun:test'
import { buildDays, dayKey, MAX_TURN_MS, type ActivityRow } from '../../../src/channel/web/activity.ts'

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
