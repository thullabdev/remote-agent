import { expect, test } from 'bun:test'
import { barWidth, formatContextText, formatDuration, formatLimitText, limitTone } from '../../src/ui/usage-format.ts'

const now = Date.UTC(2026, 10, 9, 10, 0, 0) // Mon 10:00 UTC
const hour = 3_600_000

test('formats a 5h limit with clock and remaining time in a pinned zone', () => {
  expect(formatLimitText({ usedPercent: 2, resetsAtMs: now + 4 * hour }, now, '5h', 'UTC')).toBe('2% · resets 14:00 (in 4h 0m)')
})

test('formats a 7d limit with weekday', () => {
  expect(formatLimitText({ usedPercent: 58.4, resetsAtMs: now + 28 * hour }, now, '7d', 'UTC')).toBe('58% · resets Tue 14:00 (in 1d 4h)')
})

test('pins zone: same instant differs between zones', () => {
  expect(formatLimitText({ usedPercent: 1, resetsAtMs: now + hour }, now, '5h', 'Asia/Jakarta')).toBe('1% · resets 18:00 (in 1h 0m)')
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
