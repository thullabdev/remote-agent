import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { liveAccount } from '../../src/ui/usage-format.ts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AccountUsageStrip, ContextPill } from '../../src/ui/components/usage-meters.tsx'

const now = Date.UTC(2026, 10, 9, 10, 0, 0)
const account = {
  fiveHour: { usedPercent: 2, resetsAtMs: now + 4 * 3_600_000 },
  sevenDay: { usedPercent: 85, resetsAtMs: now + 28 * 3_600_000 },
  measuredAt: now,
}

test('account strip renders both windows with tone colours, hidden when null', () => {
  const html = renderToStaticMarkup(createElement(AccountUsageStrip, { account, now, timeZone: 'UTC' }))
  expect(html).toContain('5h')
  expect(html).toContain('2% · resets 14:00 (in 4h 0m)')
  expect(html).toContain('bg-emerald-500')
  expect(html).toContain('bg-red-500')
  expect(renderToStaticMarkup(createElement(AccountUsageStrip, { account: null, now }))).toBe('')
})

test('context pill hidden when percent is null', () => {
  const view = { measuredAt: 1, contextPercent: 42, contextTokens: null, contextWindow: 200000, costUsd: null }
  expect(renderToStaticMarkup(createElement(ContextPill, { view }))).toContain('ctx 42%')
  expect(renderToStaticMarkup(createElement(ContextPill, { view: { ...view, contextPercent: null } }))).toBe('')
  expect(renderToStaticMarkup(createElement(ContextPill, { view: undefined }))).toBe('')
})

test('expired windows are hidden; strip empty when both are gone', () => {
  const later = now + 30 * 3_600_000
  expect(renderToStaticMarkup(createElement(AccountUsageStrip, { account, now: later, timeZone: 'UTC' }))).toBe('')
  const half = renderToStaticMarkup(createElement(AccountUsageStrip, { account, now: now + 5 * 3_600_000, timeZone: 'UTC' }))
  expect(half).not.toContain('5h')
  expect(half).toContain('7d')
  expect(liveAccount(account, later)).toBeNull()
})

test('info section uses the same liveness test', () => {
  const info = readFileSync('src/ui/components/chat-info.tsx', 'utf8')
  expect(info).toContain('liveAccount(usage.account, now)')
  expect(info).toContain('liveLimits !== null')
})
