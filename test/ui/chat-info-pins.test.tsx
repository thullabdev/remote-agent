import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat, PinView } from '../../src/channel/web/protocol.ts'
import { ChatInfo } from '../../src/ui/components/chat-info.tsx'

const chat: Chat = {
  id: 'c1', title: 'Billing fix', project: 'api', cwd: '/home/u/api', status: 'active', spawned: false, archived: false,
  busy: false, unread: 0, lastMessage: null, draft: null, pinned: false, tmuxName: null, pendingPrompt: null,
}

function render(pins: PinView[], shown: Chat = chat): string {
  return renderToStaticMarkup(createElement(ChatInfo, {
    chat: shown,
    messageCount: 4,
    usage: { accounts: [], chats: {} } as never,
    onClose: () => {},
    onEnd: async () => {},
    onArchive: async () => {},
    onUnarchive: async () => {},
    onRename: async () => {},
    onPin: async () => {},
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

test('the details offer to pin a session to the top, and to unpin a pinned one', () => {
  expect(render([])).toContain('Pin to top')
  expect(render([])).not.toContain('Unpin Session')
  const pinned = render([], { ...chat, pinned: true })
  expect(pinned).toContain('Unpin Session')
  expect(pinned).not.toContain('Pin to top')
})

test('General and archived sessions have no pin action', () => {
  expect(render([], { ...chat, id: 'general', title: 'General', project: null, pinned: true })).not.toMatch(/Pin to top|Unpin Session/)
  expect(render([], { ...chat, status: 'ended', archived: true })).not.toMatch(/Pin to top|Unpin Session/)
})
