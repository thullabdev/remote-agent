import { describe, it, expect, beforeEach } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat } from '../../../src/channel/web/protocol.ts'
import { TerminalChatAction, TerminalsDashboardCard } from './surfaces.tsx'
import { resetSessionsForTesting, type TerminalSession } from './store.ts'

const noop = () => {}
const chat = { id: 'chat-1', title: 'Fix billing export', project: 'api', cwd: '/work/api', launchCwd: '/work/api' } as unknown as Chat
const started = new Date(2026, 10, 15, 14, 32).getTime()

function session(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return { id: 'term-abc', cwd: '/work/api', login: '', connected: false, createdAt: started, chatId: 'chat-1', ...overrides }
}

describe('terminal dashboard card', () => {
  beforeEach(() => {
    resetSessionsForTesting()
  })

  it('lists each shell by label and folder name, without a login or a connection label', () => {
    resetSessionsForTesting([session({ cwd: '/tmp/api' })])
    const html = renderToStaticMarkup(createElement(TerminalsDashboardCard, { online: true, openPanel: noop, openSideTab: noop, notify: noop }))

    expect(html).toContain('Terminals')
    expect(html).toContain('Shell · ')
    expect(html).toContain('api')
    expect(html).not.toContain('disconnected')
  })
})

describe('terminal chat action', () => {
  it('is a button that opens a terminal for the chat', () => {
    const html = renderToStaticMarkup(createElement(TerminalChatAction, { chat, openPanel: noop, openSideTab: noop, notify: noop }))

    expect(html).toContain('Open a terminal in this session')
  })
})
