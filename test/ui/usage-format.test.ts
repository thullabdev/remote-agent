import { expect, test } from 'bun:test'
import { barWidth, formatResetClock, liveWindows, formatContextText, formatDuration, formatLimitText, formatResetLocal, limitTone } from '../../src/ui/usage-format.ts'

const now = Date.UTC(2026, 10, 9, 10, 0, 0) // Mon 10:00 UTC
const hour = 3_600_000
const five = { kind: 'five_hour', label: '5h', windowMinutes: 300, usedPercent: 0, resetsAtMs: 0 }
const seven = { kind: 'seven_day', label: '7d', windowMinutes: 10080, usedPercent: 0, resetsAtMs: 0 }

test('formatResetClock shows the weekday only for windows longer than a day', () => {
  expect(formatResetClock(now + 28 * hour, 300, 'UTC')).toBe('14:00')
  expect(formatResetClock(now + 28 * hour, 1440, 'UTC')).toBe('14:00')
  expect(formatResetClock(now + 28 * hour, 10080, 'UTC')).toBe('Tue 14:00')
})

test('limit text uses the limit own label and length', () => {
  expect(formatLimitText({ kind: 'monthly', label: '30d', windowMinutes: 43200, usedPercent: 10, resetsAtMs: now + 28 * hour }, now, 'UTC')).toBe('10% · resets Tue 14:00 (in 1d 4h)')
})

test('liveWindows drops a window resetting exactly now', () => {
  const account = { source: 'claude-code', measuredAt: now, windows: [{ ...five, resetsAtMs: now }] }
  expect(liveWindows(account, now)).toBeNull()
})

test('liveWindows keeps live windows only and is null when none remain', () => {
  const account = { source: 'claude-code', measuredAt: now, windows: [{ ...five, resetsAtMs: now + hour }, { ...seven, resetsAtMs: now - 1 }] }
  expect(liveWindows(account, now)?.windows.map(window => window.label)).toEqual(['5h'])
  expect(liveWindows(account, now + 2 * hour)).toBeNull()
})

test('formats a 5h limit with clock and remaining time in a pinned zone', () => {
  expect(formatLimitText({ ...five, usedPercent: 2, resetsAtMs: now + 4 * hour }, now, 'UTC')).toBe('2% · resets 14:00 (in 4h 0m)')
})

test('formats a 7d limit with weekday', () => {
  expect(formatLimitText({ ...seven, usedPercent: 58.4, resetsAtMs: now + 28 * hour }, now, 'UTC')).toBe('58% · resets Tue 14:00 (in 1d 4h)')
})

test('pins zone: same instant differs between zones', () => {
  expect(formatLimitText({ ...five, usedPercent: 1, resetsAtMs: now + hour }, now, 'Asia/Jakarta')).toBe('1% · resets 18:00 (in 1h 0m)')
})

test('formatDuration', () => {
  expect(formatDuration(0)).toBe('now')
  expect(formatDuration(10_000)).toBe('1m')
  expect(formatDuration(45 * 60_000)).toBe('45m')
})

test('context text is null without a percent', () => {
  const base = { measuredAt: 1, contextPercent: 42.4, contextTokens: 1000, contextWindow: 200000, costUsd: null }
  expect(formatContextText(base)).toBe('ctx 42%')
  expect(formatContextText({ ...base, contextPercent: null })).toBeNull()
})

test('tone thresholds: green under 50, yellow under 80, red otherwise', () => {
  expect(limitTone(49.9)).toBe('green')
  expect(limitTone(50)).toBe('yellow')
  expect(limitTone(79.9)).toBe('yellow')
  expect(limitTone(80)).toBe('red')
})

test('barWidth clamps to 0..100', () => {
  expect(barWidth(-5)).toBe(0)
  expect(barWidth(42.6)).toBe(43)
  expect(barWidth(140)).toBe(100)
})

test('formatResetLocal: same local day reads "today", pinned zone', () => {
  expect(formatResetLocal(now + 4 * hour, now, 'UTC')).toBe('today 14:00')
})

test('formatResetLocal: later day reads weekday and clock', () => {
  expect(formatResetLocal(now + 22 * hour, now, 'UTC')).toBe('Tue 08:00')
})

test('formatResetLocal: calendar day is compared in the pinned zone', () => {
  // 10:00 UTC is 17:00 Jakarta; +8h is 01:00 next day in Jakarta but still same day in UTC.
  expect(formatResetLocal(now + 8 * hour, now, 'UTC')).toBe('today 18:00')
  expect(formatResetLocal(now + 8 * hour, now, 'Asia/Jakarta')).toBe('Tue 01:00')
})
