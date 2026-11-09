import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat } from '../../src/channel/web/protocol.ts'
import { ChatHeader } from '../../src/ui/components/chat-header.tsx'
import { ChatInfo } from '../../src/ui/components/chat-info.tsx'
import { ChatList } from '../../src/ui/components/chat-list.tsx'
import { ChatRowContent } from '../../src/ui/components/chat-row.tsx'
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
  const markup = list({ ...blocked, draft: { preview: 'half a reply', at: 1 } })
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

test('the filter bar opens on All, first, and shows Needs you and Working only while they hold something', () => {
  const quiet = listOf([{ ...base, id: 'g', title: 'General', pinned: true }, base])
  expect(quiet.indexOf('>All')).toBeGreaterThan(-1)
  expect(quiet.indexOf('>All')).toBeLessThan(quiet.indexOf('>Ended'))
  expect(quiet.indexOf('>Ended')).toBeLessThan(quiet.indexOf('>Archived'))
  expect(quiet).toMatch(/aria-pressed="true"[^>]*>All/)
  expect(quiet).not.toContain('>Needs you')
  expect(quiet).not.toContain('>Working<')

  const busy = listOf([blocked, { ...base, id: 'w', busy: true }])
  expect(busy.indexOf('>All')).toBeLessThan(busy.indexOf('>Needs you'))
  expect(busy.indexOf('>Needs you')).toBeLessThan(busy.indexOf('>Working'))
  expect(busy).toMatch(/Needs you<span[^>]*>1</)
  expect(busy).toMatch(/Working<span[^>]*>1</)
})

test('the Ended tab shows a dot when an ended session has something unread', () => {
  expect(listOf([{ ...base, status: 'ended', unread: 2 }])).toContain('data-unread="true"')
  expect(listOf([{ ...base, status: 'ended', unread: 0 }])).not.toContain('data-unread')
  expect(listOf([{ ...base, unread: 2 }])).not.toContain('data-unread')
})

test('ended sessions are not in the All list', () => {
  const markup = listOf([base, { ...base, id: 'e', title: 'Old ended one', status: 'ended' }])
  expect(markup).toContain('Billing fix')
  expect(markup).not.toContain('Old ended one')
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
  const markup = renderToStaticMarkup(createElement(ChatRowContent, { chat: { ...base, status: 'ended' }, selection: null }))
  expect(markup).toContain('Ended · ')
  expect(markup).toContain('opacity-70')
})

test('a working row keeps the last message visible next to the state', () => {
  const markup = row({ ...base, busy: true })
  expect(markup).toContain('Working · ')
  expect(markup).toContain('Done with the migration')
})

test('a row shows its draft text on a third line, without a project line or a pencil', () => {
  const markup = row({ ...base, draft: { preview: 'half a reply', at: 1 } })
  expect(markup).toContain('Draft')
  expect(markup).toContain('half a reply')
  expect(markup).toContain('Done with the migration')
  expect(markup).not.toContain('>api<')
  expect(markup).not.toContain('lucide-pencil')
  expect(markup).toContain('has a draft')
  expect(row(base)).not.toContain('Draft')
})

test('a row says where its session runs: laptop or spawned', () => {
  const laptopRow = row({ ...base, spawned: false })
  const spawnedRow = row({ ...base, spawned: true })
  expect(laptopRow).toContain('data-origin="laptop"')
  expect(laptopRow).toContain('Started on your laptop')
  expect(spawnedRow).toContain('data-origin="spawned"')
  expect(spawnedRow).toContain('Spawned from Remote Agent')
  expect(spawnedRow).not.toContain('data-origin="laptop"')
})

test('the tile letter is the project initial, so the letter and the color name the same thing', () => {
  const tile = (chat: Chat): string => renderToStaticMarkup(createElement(ChatRowContent, { chat, selection: null })).match(/aria-hidden="true">([^<]+)<\/span>/)?.[1] ?? ''
  expect(tile({ ...base, project: 'api' })).toBe('A')
  expect(tile({ ...base, project: null })).toBe('B')
})

test('General has no preview or origin, but its draft text and unread still show', () => {
  const general: Chat = { ...base, id: 'general', title: 'General', project: null, pinned: true, lastMessage: { seq: 1, at: Date.now(), preview: 'Bridge started. Away mode is on.' } }
  const markup = row(general)
  expect(markup).toContain('General')
  expect(markup).not.toContain('Bridge started')
  expect(markup).not.toContain('data-origin')
  const drafting = row({ ...general, draft: { preview: '/new -m sonnet', at: 1 } })
  expect(drafting).toContain('Draft')
  expect(drafting).toContain('/new -m sonnet')
  expect(row({ ...general, unread: 1 })).toContain('rounded-full bg-primary')
})

test('the header offers a source filter that narrows the list and shows when it is on', () => {
  const spawnedChat: Chat = { ...base, id: 's1', title: 'Spawned one', spawned: true }
  const laptopChat: Chat = { ...base, id: 'l1', title: 'Laptop one', spawned: false }
  const render = (origin?: 'all' | 'laptop' | 'spawned'): string =>
    renderToStaticMarkup(
      createElement(ChatList, {
        chats: [spawnedChat, laptopChat], activeId: null, status: 'connected', onOpen: () => {}, onNew: () => {}, onSettings: () => {},
        onArchiveSelected: async () => {}, onActionError: () => {}, ...(origin === undefined ? {} : { initialOrigin: origin }),
      }),
    )
  const everything = render()
  expect(everything).toContain('aria-label="Filter by source"')
  expect(everything).toContain('Spawned one')
  expect(everything).toContain('Laptop one')
  expect(everything).not.toContain('data-active')

  const onlySpawned = render('spawned')
  expect(onlySpawned).toContain('Spawned one')
  expect(onlySpawned).not.toContain('Laptop one')
  expect(onlySpawned).toContain('data-active="true"')
  expect(render('laptop')).not.toContain('Spawned one')
})

test('the Ended tab says how to archive, since selection is a press and hold', () => {
  const ended = { ...base, status: 'ended' as const }
  const render = (filter: 'all' | 'ended', chats: Chat[]): string =>
    renderToStaticMarkup(
      createElement(ChatList, {
        chats, activeId: null, status: 'connected', onOpen: () => {}, onNew: () => {}, onSettings: () => {},
        onArchiveSelected: async () => {}, onActionError: () => {}, initialFilter: filter,
      }),
    )
  expect(render('ended', [ended])).toContain('Press and hold a session to select it')
  expect(render('ended', [])).not.toContain('Press and hold')
  expect(render('all', [base, ended])).not.toContain('Press and hold')
})

test('unread is a dot, and the count is spoken in the label instead of shown', () => {
  const markup = row({ ...base, unread: 7 })
  expect(markup).toContain('7 unread')
  expect(markup).not.toContain('>7<')
})

test('the row has a state-first accessible name and a machine-readable time', () => {
  const markup = row(blocked)
  expect(markup).toContain('aria-label="Needs you, permission: Bash: bun test, Billing fix, laptop session, api, just now"')
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
  expect(row(base)).not.toContain('data-state="needs_you"')
  expect(row(base)).not.toContain('data-state="working"')
})

function listWith(chats: Chat[], props: { status?: 'connected' | 'reconnecting' | 'resyncing' | 'error' | 'loading'; activeId?: string | null } = {}): string {
  return renderToStaticMarkup(
    createElement(ChatList, {
      chats, activeId: props.activeId ?? null, status: props.status ?? 'connected', onOpen: () => {}, onNew: () => {}, onSettings: () => {},
      onArchiveSelected: async () => {}, onActionError: () => {},
    }),
  )
}

test('there is no separate strip: a blocked session is announced by its tab and its row', () => {
  const markup = listWith([blocked, { ...blocked, id: 'c2', title: 'Second' }])
  expect(markup).not.toContain('sessions need you')
  expect(markup).not.toContain('session needs you')
})

test('the footer is silent while connected, and plain-spoken when the connection is not fine', () => {
  expect(listWith([base])).not.toContain('Connected to your Bridge')
  expect(listWith([base])).not.toContain('role="status"')
  expect(listWith([base], { status: 'reconnecting' })).toContain('Can&#x27;t reach your computer. Reconnecting')
  expect(listWith([base], { status: 'error' })).toContain('Can&#x27;t reach your computer')
  expect(listWith([base], { status: 'resyncing' })).toContain('Syncing recent activity')
  expect(listWith([base], { status: 'loading' })).toContain('Connecting')
  expect(listWith([base], { status: 'error' })).toContain('role="status"')
})

test('the list is hidden from keyboard and screen readers while a chat covers it on a phone', () => {
  expect(listWith([base], { activeId: 'c1' })).toContain('max-md:invisible')
  expect(listWith([base], { activeId: null })).not.toContain('max-md:invisible')
})

test('on a phone the new-session button sits at the bottom right, and the header keeps one for larger screens', () => {
  const markup = listWith([base])
  expect(markup.match(/aria-label="Start a new session"/g)).toHaveLength(2)
  expect(markup).toContain('md:hidden')
  expect(markup).toMatch(/fixed|absolute bottom-/)
  expect(markup).toContain('size-14 rounded-full')
})

test('the list uses no text smaller than 12px', () => {
  const markup = listWith([{ ...base, unread: 3, draft: { preview: 'x', at: 1 }, status: 'ended' }, blocked], { status: 'error' })
  expect(markup).not.toMatch(/text-\[(?:9|10|11)px\]/)
})
