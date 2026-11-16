import { describe, it, expect, beforeEach } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat } from '../../../src/channel/web/protocol.ts'
import type { ActivePanel } from '../../../src/ui/extension-slots.ts'
import { TerminalChatAction, TerminalsDashboardCard, TerminalsSidebarSection } from './surfaces.tsx'
import { resetSessionsForTesting, type TerminalSession } from './store.ts'

const noop = () => {}
const chat = { id: 'chat-1', title: 'Fix billing export', project: 'api', cwd: '/work/api', launchCwd: '/work/api' } as unknown as Chat
const started = new Date(2026, 10, 15, 14, 32).getTime()

function session(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return { id: 'term-abc', cwd: '/work/api', login: '', connected: false, createdAt: started, chatId: 'chat-1', ...overrides }
}

function sidebar(activePanel: ActivePanel | null = null): string {
  return renderToStaticMarkup(createElement(TerminalsSidebarSection, { chats: [chat], activePanel, openPanel: noop, notify: noop }))
}

describe('terminal sidebar section', () => {
  beforeEach(() => {
    resetSessionsForTesting()
  })

  it('renders nothing when no shell is open', () => {
    expect(sidebar()).toBe('')
  })

  it('names each shell by its start time and shows the chat it belongs to', () => {
    resetSessionsForTesting([session()])
    const html = sidebar()

    expect(html).toContain('Shell · ')
    expect(html).toContain('Fix billing export')
    expect(html).toContain('detached')
    expect(html).not.toContain('>term-abc<')
  })

  it('says attached while a browser has the shell open', () => {
    resetSessionsForTesting([session({ connected: true, chatId: null })])
    const html = sidebar()

    expect(html).toContain('attached')
    expect(html).not.toContain('Fix billing export')
  })

  it('highlights the shell whose panel is open, and no other', () => {
    resetSessionsForTesting([session({ id: 'term-a' }), session({ id: 'term-b', createdAt: started + 60_000 })])
    const html = sidebar({ id: 'terminal', params: { sid: 'term-b' } })

    const rowOf = (sid: string) => html.match(new RegExp(`<button[^>]*title="${sid}"[^>]*>`))?.[0] ?? ''

    expect(rowOf('term-b')).toContain('bg-muted"')
    expect(rowOf('term-a')).not.toContain('bg-muted"')
  })
})

describe('terminal dashboard card', () => {
  beforeEach(() => {
    resetSessionsForTesting()
  })

  it('lists each shell by label and folder name, without a login or a connection label', () => {
    resetSessionsForTesting([session({ cwd: '/tmp/api' })])
    const html = renderToStaticMarkup(createElement(TerminalsDashboardCard, { online: true, openPanel: noop, notify: noop }))

    expect(html).toContain('Terminals')
    expect(html).toContain('Shell · ')
    expect(html).toContain('api')
    expect(html).not.toContain('disconnected')
  })
})

describe('terminal chat action', () => {
  it('is a button that opens a terminal for the chat', () => {
    const html = renderToStaticMarkup(createElement(TerminalChatAction, { chat, openPanel: noop, notify: noop }))

    expect(html).toContain('Open a terminal in this session')
  })
})
