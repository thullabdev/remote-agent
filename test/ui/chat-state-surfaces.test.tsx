import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat } from '../../src/channel/web/protocol.ts'
import { ChatHeader } from '../../src/ui/components/chat-header.tsx'
import { ChatInfo } from '../../src/ui/components/chat-info.tsx'
import { ChatList } from '../../src/ui/components/chat-list.tsx'
import { MessageFeed } from '../../src/ui/components/message-feed.tsx'

const base: Chat = {
  id: 'c1', title: 'Billing fix', project: 'api', cwd: '/home/u/api', status: 'active', spawned: false, archived: false,
  busy: false, unread: 0, lastMessage: { seq: 1, at: Date.now(), preview: 'Done with the migration' }, draft: null, pinned: false, tmuxName: null, pendingPrompt: null,
}
const blocked: Chat = {
  ...base,
  busy: true,
  pendingPrompt: { promptId: 'p1', kind: 'permission', summary: 'Bash: bun test', at: Date.now(), count: 1 },
}
const asking: Chat = { ...blocked, pendingPrompt: { promptId: 'p2', kind: 'question', summary: 'Which database?', at: Date.now(), count: 1 } }

function list(chat: Chat): string {
  return renderToStaticMarkup(
    createElement(ChatList, {
      chats: [chat], activeId: null, status: 'connected', onOpen: () => {}, onNew: () => {}, onSettings: () => {},
      onArchiveSelected: async () => {}, onActionError: () => {},
    }),
  )
}

function header(chat: Chat): string {
  return renderToStaticMarkup(createElement(ChatHeader, { chat, status: 'connected', onBack: () => {}, onInfo: () => {}, infoOpen: false }))
}

function info(chat: Chat): string {
  return renderToStaticMarkup(
    createElement(ChatInfo, {
      chat, messageCount: 2, usage: { accounts: [], chats: {} } as never, onClose: () => {}, onEnd: async () => {}, onArchive: async () => {},
      onUnarchive: async () => {}, onRename: async () => {}, onClear: async () => {}, onFork: async () => {}, onResume: async () => {},
      pins: [], onUnpin: async () => {}, onJump: () => {}, onRefreshPins: () => {},
    }),
  )
}

function feed(chat: Chat): string {
  return renderToStaticMarkup(
    createElement(MessageFeed, {
      chat, messages: [], hasMore: false, loadingEarlier: false, onLoadEarlier: () => {},
      onPromptAction: async () => {}, onPromptReply: async () => {}, onPickerAction: async () => {},
    }),
  )
}

test('the list says what a blocked session waits for, not Working', () => {
  const markup = list(blocked)
  expect(markup).toContain('Needs you')
  expect(markup).toContain('Permission')
  expect(markup).toContain('Bash: bun test')
  expect(markup).not.toContain('Working…')
  expect(list(asking)).toContain('Question')
})

test('the list still says Working for a session that is working, and the last message when idle', () => {
  expect(list({ ...base, busy: true })).toContain('Working…')
  const idle = list(base)
  expect(idle).toContain('Done with the migration')
  expect(idle).not.toContain('Needs you')
})

test('a pending prompt is shown even when the chat has an unsent draft', () => {
  const markup = list({ ...blocked, draft: { preview: 'half a reply' } })
  expect(markup).toContain('Needs you')
  expect(markup).toContain('Bash: bun test')
})

test('the header says the session is waiting for an answer, not working', () => {
  const markup = header(blocked)
  expect(markup).toContain('Waiting for your answer')
  expect(markup).not.toContain('Working on your instruction')
  expect(markup).not.toContain('Active')
  expect(header({ ...base, busy: true })).toContain('Working on your instruction')
})

test('the details panel badges Needs you instead of Working', () => {
  const markup = info(blocked)
  expect(markup).toContain('Needs you')
  expect(markup).not.toContain('>Working<')
  expect(info({ ...base, busy: true })).toContain('>Working<')
})

test('the feed shows the working indicator only while the session is working', () => {
  expect(feed({ ...base, busy: true })).toContain('Session is working')
  expect(feed(blocked)).not.toContain('Session is working')
  expect(feed(base)).not.toContain('Session is working')
})
