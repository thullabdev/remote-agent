import { expect, test } from 'bun:test'
import { liveAccount } from '../../src/ui/usage-format.ts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { UsageButton, UsagePanel } from '../../src/ui/components/usage-panel.tsx'
import { AccountLimitsSection, AccountUsageStrip, ContextPill } from '../../src/ui/components/usage-meters.tsx'

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

test('account limits section shows an empty state without live data, and the strip with it', () => {
  const empty = renderToStaticMarkup(createElement(AccountLimitsSection, { account: null, now, timeZone: 'UTC' }))
  expect(empty).toContain('Account limits')
  expect(empty).toContain('No limit data yet. It appears after a session&#x27;s next turn.')
  const expired = renderToStaticMarkup(createElement(AccountLimitsSection, { account, now: now + 30 * 3_600_000, timeZone: 'UTC' }))
  expect(expired).toContain('No limit data yet')
  const live = renderToStaticMarkup(createElement(AccountLimitsSection, { account, now, timeZone: 'UTC' }))
  expect(live).toContain('Account limits')
  expect(live).toContain('2% · resets 14:00 (in 4h 0m)')
  expect(live).not.toContain('No limit data yet')
})

const session = { measuredAt: now - 120_000, contextPercent: 2.5, contextTokens: 25230, contextWindow: 1_000_000, costUsd: 0 }

test('usage button is collapsed by default and wired to the panel', () => {
  const html = renderToStaticMarkup(createElement(UsageButton, { open: false, onToggle: () => {} }))
  expect(html).toContain('Usage')
  expect(html).toContain('aria-expanded="false"')
  expect(html).toContain('aria-controls="chat-usage-panel"')
  expect(renderToStaticMarkup(createElement(UsageButton, { open: true, onToggle: () => {} }))).toContain('aria-expanded="true"')
})

test('usage panel renders nothing when closed', () => {
  const html = renderToStaticMarkup(createElement(UsagePanel, { open: false, account, session, now, timeZone: 'UTC' }))
  expect(html).toBe('')
})

test('open usage panel shows windows, percentages, local reset times, context and cost', () => {
  const html = renderToStaticMarkup(createElement(UsagePanel, { open: true, account: { ...account, measuredAt: now - 120_000 }, session, now, timeZone: 'UTC' }))
  expect(html).toContain('id="chat-usage-panel"')
  expect(html).toContain('>5h<')
  expect(html).toContain('>7d<')
  expect(html).toContain('2%')
  expect(html).toContain('85%')
  expect(html).toContain('Resets today 14:00')
  expect(html).toContain('Resets Tue 14:00')
  expect(html).toContain('in 4h 0m')
  expect(html).toContain('Updated 2m ago')
  expect(html).toContain('bg-emerald-500')
  expect(html).toContain('bg-red-500')
  expect(html).toContain('>Context<')
  expect(html).toContain('3%')
  expect(html).toContain('25,230 / 1,000,000 tokens')
  expect(html).toContain('Session cost $0.00')
})

test('usage panel omits context and cost rows when unknown', () => {
  const bare = { ...session, contextPercent: null, contextTokens: null, costUsd: null }
  const html = renderToStaticMarkup(createElement(UsagePanel, { open: true, account, session: bare, now, timeZone: 'UTC' }))
  expect(html).not.toContain('Context')
  expect(html).not.toContain('Session cost')
  expect(html).toContain('>5h<')
})

test('usage panel shows an empty state when there is nothing to show', () => {
  const html = renderToStaticMarkup(createElement(UsagePanel, { open: true, account: null, session: undefined, now, timeZone: 'UTC' }))
  expect(html).toContain('No usage reported yet.')
  expect(html).not.toContain('Updated')
})
