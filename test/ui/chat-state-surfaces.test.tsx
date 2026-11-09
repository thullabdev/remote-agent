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
  expect(list({ ...base, busy: true })).toContain('Working · ')
  const idle = list(base)
  expect(idle).toContain('Done with the migration')
  expect(idle).not.toContain('Needs you ·')
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

function listOf(chats: Chat[]): string {
  return renderToStaticMarkup(
    createElement(ChatList, {
      chats, activeId: null, status: 'connected', onOpen: () => {}, onNew: () => {}, onSettings: () => {},
      onArchiveSelected: async () => {}, onActionError: () => {},
    }),
  )
}

test('the filter bar offers states, with a count on the ones that need attention', () => {
  const markup = listOf([{ ...base, id: 'g', title: 'General', pinned: true }, blocked, { ...base, id: 'w', busy: true }])
  for (const label of ['Needs you', 'Working', 'All', 'Ended', 'Archived']) {
    expect(markup).toContain(`>${label}`)
  }
  expect(markup).toMatch(/aria-pressed="true"[^>]*>All/)
  expect(markup).toMatch(/Needs you<span[^>]*>1</)
  expect(markup).toMatch(/Working<span[^>]*>1</)
})

test('the origin tabs and the Chats counter are gone from the list', () => {
  const markup = listOf([base])
  expect(markup).not.toContain('aria-pressed="false">Active Session')
  expect(markup).not.toContain('aria-pressed="false">Spawned')
  expect(markup).not.toContain('Chats <')
})

test('the filter bar sits outside the scrolling list, so it stays in view', () => {
  const markup = listOf([base])
  expect(markup.indexOf('aria-label="Filter sessions"')).toBeGreaterThan(-1)
  expect(markup.indexOf('aria-label="Filter sessions"')).toBeLessThan(markup.indexOf('overflow-y-auto'))
})

const row = (chat: Chat): string => listOf([chat])

test('the row drops the origin and Ended badges and the pin icon', () => {
  const markup = listOf([{ ...base, spawned: true }, { ...base, id: 'c2', spawned: false, status: 'ended' }, { ...base, id: 'g', pinned: true }])
  expect(markup).not.toContain('>Spawned<')
  expect(markup).not.toContain('>Active Session<')
  expect(markup).not.toContain('uppercase tracking-wide')
  expect(markup).not.toContain('aria-label="Pinned"')
})

test('an ended row says Ended in its preview and is dimmed', () => {
  const markup = row({ ...base, status: 'ended' })
  expect(markup).toContain('Ended · ')
  expect(markup).toContain('opacity-70')
})

test('a working row keeps the last message visible next to the state', () => {
  const markup = row({ ...base, busy: true })
  expect(markup).toContain('Working · ')
  expect(markup).toContain('Done with the migration')
})

test('the project shows on its own line, and a draft stays a marker that does not hide the preview', () => {
  const markup = row({ ...base, draft: { preview: 'half a reply' } })
  expect(markup).toContain('>api<')
  expect(markup).toContain('Draft')
  expect(markup).toContain('half a reply')
  expect(markup).toContain('Done with the migration')
})

test('unread is a dot, and the count is spoken in the label instead of shown', () => {
  const markup = row({ ...base, unread: 7 })
  expect(markup).toContain('7 unread')
  expect(markup).not.toContain('>7<')
})

test('the row has a state-first accessible name and a machine-readable time', () => {
  const markup = row(blocked)
  expect(markup).toContain('aria-label="Needs you, permission: Bash: bun test, Billing fix, api, just now"')
  expect(markup).toMatch(/<time dateTime="[^"]+"/)
})

test('a row is a toggle only while selecting, so a screen reader does not announce a switch on a plain row', () => {
  expect(row({ ...base, status: 'ended' })).not.toContain('aria-pressed="false" aria-disabled')
  expect(row({ ...base, status: 'ended' })).not.toMatch(/<button[^>]*aria-disabled[^>]*aria-pressed/)
})

test('the avatar takes its color from the project and carries a state badge', () => {
  const markup = row(blocked)
  expect(markup).toContain('--avatar-hue')
  expect(markup).toContain('data-state="needs_you"')
  expect(row({ ...base, busy: true })).toContain('data-state="working"')
  expect(row(base)).not.toContain('data-state=')
})
