import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat } from '../../src/channel/web/protocol.ts'
import { ChatList } from '../../src/ui/components/chat-list.tsx'

const noop = () => {}
const chat = { id: 'chat-1', title: 'Fix billing export', project: 'api', cwd: '/work/api', status: 'active', spawned: false, archived: false, busy: false, unread: 0, lastMessage: null, draft: null, pendingPrompt: null } as unknown as Chat

/** The Terminals section only, so chat rows with the same title do not count. */
function terminalsSection(html: string): string {
  return html.split('aria-labelledby="list-terminals"')[1]?.split('</section>')[0] ?? ''
}

function render(terminals: Parameters<typeof ChatList>[0]['terminals']): string {
  return renderToStaticMarkup(
    createElement(ChatList, {
      chats: [chat],
      activeId: null,
      status: 'connected',
      onOpen: noop,
      onNew: noop,
      onSettings: noop,
      onArchiveSelected: async () => {},
      onPinSelected: async () => {},
      onActionError: noop,
      terminals,
    }),
  )
}

test('a terminal row names its shell by start time and shows the chat it belongs to', () => {
  const html = render([{ id: 'term-abc', cwd: '/work/api', login: '', connected: false, createdAt: new Date(2026, 10, 15, 14, 32).getTime(), chatId: 'chat-1' }])

  const section = terminalsSection(html)

  expect(section).toContain('Shell · ')
  expect(section).toContain('Fix billing export')
  expect(section).toContain('detached')
  expect(section).not.toContain('>term-abc<')
})

test('a terminal row says attached while a browser has it open', () => {
  const html = render([{ id: 'term-abc', cwd: '/work/api', login: '', connected: true, chatId: null }])

  const section = terminalsSection(html)

  expect(section).toContain('attached')
  expect(section).not.toContain('Fix billing export')
})
