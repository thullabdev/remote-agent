import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat, PinView } from '../../src/channel/web/protocol.ts'
import { ChatInfo } from '../../src/ui/components/chat-info.tsx'

const chat: Chat = {
  id: 'c1', title: 'Billing fix', project: 'api', cwd: '/home/u/api', status: 'active', spawned: false, archived: false,
  busy: false, unread: 0, lastMessage: null, pinned: false, tmuxName: null,
}

function render(pins: PinView[]): string {
  return renderToStaticMarkup(createElement(ChatInfo, {
    chat,
    messageCount: 4,
    usage: { accounts: [], chats: {} } as never,
    onClose: () => {},
    onEnd: async () => {},
    onArchive: async () => {},
    onUnarchive: async () => {},
    onRename: async () => {},
    onClear: async () => {},
    onFork: async () => {},
    onResume: async () => {},
    pins,
    onUnpin: async () => {},
    onJump: () => {},
    onRefreshPins: () => {},
  }))
}

test('the details list shows an empty hint when nothing is pinned', () => {
  const markup = render([])
  expect(markup).toContain('Pinned messages · 0')
  expect(markup).toContain('Pin a message in the chat to keep it here.')
})

test('the details list shows each pin with its author, preview and actions', () => {
  const markup = render([
    { id: 'm_1', seq: 3, at: Date.UTC(2026, 10, 8, 9, 0), kind: 'agent_text', preview: 'Plan: split the migration' },
    { id: 'm_2', seq: 5, at: Date.UTC(2026, 10, 8, 9, 5), kind: 'user_text', preview: 'Use staging' },
  ])
  expect(markup).toContain('Pinned messages · 2')
  expect(markup).toContain('Plan: split the migration')
  expect(markup).toContain('Agent')
  expect(markup).toContain('Use staging')
  expect(markup).toContain('Show in chat')
  expect(markup).toContain('Unpin')
  expect(markup).toContain('aria-label="Refresh pinned messages"')
})
