import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat, ForkView } from '../../src/channel/web/protocol.ts'
import { ChatInfo } from '../../src/ui/components/chat-info.tsx'

const chat: Chat = {
  id: 'c1', title: 'Billing fix', project: 'api', cwd: '/home/u/api', status: 'active', spawned: false, archived: false,
  busy: false, unread: 0, lastMessage: null, draft: null, pinned: false, tmuxName: null, pendingPrompt: null, activity: null,
}

const fork = (overrides: Partial<ForkView> = {}): ForkView => ({
  chatId: 'c2',
  title: 'Fork of the plan',
  status: 'active',
  createdAt: 1_000,
  pointMessageId: 'm1',
  pointSeq: 4,
  pointPreview: 'Done.',
  pointVisible: true,
  ...overrides,
})

function render(forks: ForkView[]): string {
  return renderToStaticMarkup(createElement(ChatInfo, {
    chat,
    onClose: () => {},
    api: { subagentActivity: async () => ({ items: [], nextCursor: null }) },
    subagent: null,
    onCloseSubagent: () => {},
    onNotify: () => {},
    onEnd: async () => {},
    onArchive: async () => {},
    onUnarchive: async () => {},
    onRename: async () => {},
    onPin: async () => {},
    onClear: async () => {},
    onFork: async () => {},
    onResume: async () => {},
    pins: [],
    onUnpin: async () => {},
    onJump: () => {},
    forks,
    onRefreshForks: () => {},
    onShowFork: () => {},
    onOpenFork: () => {},
    openPanel: () => {},
    density: 'comfortable' as const,
  }))
}

/** Renders with the given accordions remembered as open, as a previous visit would leave them. */
function withOpen(ids: string[], build: () => string): string {
  const stored = JSON.stringify(Object.fromEntries(ids.map(id => [id, true])))
  Object.assign(globalThis, { window: { localStorage: { getItem: () => stored, setItem: () => {} } } })
  try {
    return build()
  } finally {
    delete (globalThis as { window?: unknown }).window
  }
}

test('the details panel lists each fork with the reply it was made from, and a refresh button', () => {
  const html = render([fork()])
  expect(html).toContain('Forks · 1')
  expect(html).toContain('aria-label="Refresh forks"')
  expect(html).toContain('Fork of the plan')
  expect(html).toContain('Done.')
  expect(html).toContain('Show in chat')
  expect(html).toContain('Open fork')
})

test('an empty forks section says how to start a fork', () => {
  const html = withOpen(['forks'], () => render([]))
  expect(html).toContain('Forks · 0')
  expect(html).toContain('Fork from a reply to start one')
})

test('a fork whose reply is no longer shown cannot be jumped to', () => {
  const html = render([fork({ pointVisible: false })])
  expect(html).toContain('Fork point no longer shown')
  expect(html).not.toContain('Show in chat')
})

test('an ended fork is marked as ended', () => {
  expect(render([fork({ status: 'ended' })])).toContain('Ended')
})
