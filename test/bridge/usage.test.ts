import { describe, expect, test } from 'bun:test'
import { accountLimits, sessionUsage } from '../../src/bridge/usage.ts'

const now = Date.parse('2026-11-07T10:00:00Z')

describe('accountLimits', () => {
  test('keeps five_hour and seven_day, converting ISO resets to epoch ms', () => {
    const limits = accountLimits(
      [
        { kind: 'five_hour', percentUsed: 2, resetsAt: '2026-11-07T14:00:00.000Z' },
        { kind: 'seven_day', percentUsed: 64, resetsAt: '2026-11-08T12:00:00.000Z' },
      ],
      now,
    )
    expect(limits).toEqual({
      fiveHour: { usedPercent: 2, resetsAtMs: Date.parse('2026-11-07T14:00:00.000Z') },
      sevenDay: { usedPercent: 64, resetsAtMs: Date.parse('2026-11-08T12:00:00.000Z') },
    })
  })

  test('empty rateLimits means no account view (no subscription)', () => {
    expect(accountLimits([], now)).toBeNull()
  })

  test('drops a window whose reset has passed, and ignores other kinds', () => {
    const limits = accountLimits(
      [
        { kind: 'five_hour', percentUsed: 80, resetsAt: '2026-11-07T09:00:00.000Z' },
        { kind: 'spend_limit', percentUsed: 140, resetsAt: '2026-11-08T00:00:00.000Z' },
      ],
      now,
    )
    expect(limits).toBeNull()
  })

  test('a window with no resetsAt is dropped', () => {
    expect(accountLimits([{ kind: 'seven_day', percentUsed: 10 }], now)).toBeNull()
  })
})

describe('sessionUsage', () => {
  test('maps the context fill and cost', () => {
    const view = sessionUsage(
      { context: { tokens: 25230, window: 1000000, percent: 3 }, rateLimits: [], cost: { usd: 0.00025 } },
      now,
    )
    expect(view).toEqual({ measuredAt: now, contextPercent: 3, contextTokens: 25230, contextWindow: 1000000, costUsd: 0.00025 })
  })

  test('uses null for context before the first response', () => {
    const view = sessionUsage({ context: { window: 200000 }, rateLimits: [] }, now)
    expect(view.contextPercent).toBeNull()
    expect(view.contextTokens).toBeNull()
    expect(view.costUsd).toBeNull()
  })
})
