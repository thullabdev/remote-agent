import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Message } from '../../src/channel/web/protocol.ts'
import { SessionStatusCard } from '../../src/ui/components/session-status-card.tsx'

type Card = Extract<Message, { kind: 'session_status' }>
const card = (over: Partial<Card>): Card => ({ id: 'm', chatId: 'c', seq: 1, at: Date.UTC(2026, 10, 10, 9, 53), kind: 'session_status', state: 'starting', cwd: '/home/u/api', message: null, detail: null, ...over })
const render = (over: Partial<Card>): string => renderToStaticMarkup(createElement(SessionStatusCard, { message: card(over) }))

test('starting and resuming show a spinner, and the folder is a quiet secondary line', () => {
  const starting = render({ state: 'starting' })
  expect(starting).toContain('Starting the session…')
  expect(starting).toContain('animate-spin')
  expect(starting).toContain('/home/u/api')
  expect(render({ state: 'resuming' })).toContain('Resuming the session…')
})

test('ready says what to do next and shows a check, not a spinner', () => {
  const ready = render({ state: 'ready' })
  expect(ready).toContain('Ready. Send your first task below.')
  expect(ready).not.toContain('animate-spin')
  expect(ready).toContain('data-state="ready"')
})

test('a failure is an alert with the reason, collapsible details and the way forward', () => {
  const failed = render({ state: 'failed', message: 'The session did not start within 30s', detail: 'Please run /login' })
  expect(failed).toContain('role="alert"')
  expect(failed).toContain('The session did not start within 30s')
  expect(failed).toContain('<details')
  expect(failed).toContain('Please run /login')
  expect(failed).toContain('resume this one from its details')
})

test('no tmux command or emoji clutters the card', () => {
  const markup = render({ state: 'starting' })
  expect(markup).not.toContain('tmux')
  expect(markup).not.toContain('⏳')
})
