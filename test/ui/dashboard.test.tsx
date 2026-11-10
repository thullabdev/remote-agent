import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat, UsageView } from '../../src/channel/web/protocol.ts'
import { ChatHeader } from '../../src/ui/components/chat-header.tsx'
import { Dashboard, type DashboardProps } from '../../src/ui/components/dashboard.tsx'

function chat(id: string, patch: Partial<Chat> = {}): Chat {
  return {
    id, title: `Title ${id}`, project: null, cwd: null, status: 'active', spawned: false, archived: false, busy: false, unread: 0,
    lastMessage: null, draft: null, pinned: false, tmuxName: null, pendingPrompt: null, ...patch,
  }
}

const usage: UsageView = { accounts: [], chats: {} }
const noop = async () => {}

function render(chats: Chat[], patch: Partial<DashboardProps> = {}): string {
  return renderToStaticMarkup(
    createElement(Dashboard, {
      chats, usage, away: false, online: true, onOpenChat: () => {}, onPromptAction: noop, onToggleAway: () => {}, onNewSession: () => {},
      onStartProject: noop, onResume: noop, ...patch,
    }),
  )
}

const permission = { promptId: 'p1', kind: 'permission' as const, summary: 'Bash: rm -rf build', at: Date.now() - 4 * 60_000, count: 1 }

test('a permission request shows its full command with Allow and Deny', () => {
  const html = render([chat('a', { project: 'api', busy: true, pendingPrompt: permission })])
  expect(html).toContain('data-needs-you="a"')
  expect(html).toContain('Bash: rm -rf build')
  expect(html).toContain('>Allow<')
  expect(html).toContain('>Deny<')
  expect(html).toContain('waiting 4m')
  expect(html).toContain('1 needs you')
})

test('a question opens the chat instead of offering quick answers', () => {
  const html = render([chat('a', { busy: true, pendingPrompt: { ...permission, kind: 'question', summary: 'Which database?' } })])
  expect(html).toContain('Which database?')
  expect(html).toContain('>Answer<')
  expect(html).not.toContain('>Allow<')
})

test('answers are disabled while offline', () => {
  const html = render([chat('a', { busy: true, pendingPrompt: permission })], { online: false })
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Deny</)
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Allow</)
})

test('working sessions show their latest step, and sections hide when empty', () => {
  const working = render([chat('b', { project: 'web', busy: true, lastMessage: { seq: 1, at: Date.now(), preview: 'Running tests' } })])
  expect(working).toContain('data-working="b"')
  expect(working).toContain('Running tests')
  expect(working).not.toContain('Needs you')

  const quiet = render([chat('c')])
  expect(quiet).not.toContain('Working now')
  expect(quiet).not.toContain('data-needs-you')
  expect(quiet).toContain('All quiet · 1 live session')
  expect(quiet).toContain('New session')
})

test('quick actions offer recent projects and the last ended session', () => {
  const html = render([
    chat('a', { cwd: '/w/api', project: 'api', lastMessage: { seq: 1, at: 5, preview: 'x' } }),
    chat('z', { status: 'ended', project: 'web', cwd: '/w/web', lastMessage: { seq: 1, at: 4, preview: 'y' } }),
  ])
  expect(html).toContain('title="/w/api"')
  expect(html).toContain('Resume web')
})

test('away mode is announced and the toggle reflects it', () => {
  const html = render([], { away: true })
  expect(html).toContain('Away mode on')
  expect(html).toContain('aria-pressed="true"')
})

test('budget says so when there is no usage yet', () => {
  expect(render([])).toContain('No limit data yet')
})

test('General offers the Dashboard and Chat switch with the summary under its name', () => {
  const html = renderToStaticMarkup(
    createElement(ChatHeader, {
      chat: chat('general', { title: 'General' }), status: 'connected', onBack: () => {}, onInfo: () => {}, infoOpen: false, onRename: async () => {},
      view: 'dashboard', onView: () => {}, summary: '2 need you · 3 working',
    }),
  )
  expect(html).toContain('aria-label="General view"')
  expect(html).toMatch(/aria-pressed="true"[^>]*>dashboard</)
  expect(html).toContain('2 need you · 3 working')

  const session = renderToStaticMarkup(
    createElement(ChatHeader, { chat: chat('s'), status: 'connected', onBack: () => {}, onInfo: () => {}, infoOpen: false, onRename: async () => {} }),
  )
  expect(session).not.toContain('General view')
})
