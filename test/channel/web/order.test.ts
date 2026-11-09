import { expect, test } from 'bun:test'
import { orderChats } from '../../../src/channel/web/order.ts'
import type { Chat } from '../../../src/channel/web/protocol.ts'

function chat(id: string, patch: Partial<Chat> = {}): Chat {
  return {
    id,
    title: id,
    project: null,
    cwd: null,
    status: 'active',
    spawned: false,
    archived: false,
    busy: false,
    unread: 0,
    lastMessage: null,
    draft: null,
    pinned: false,
    tmuxName: null,
    pendingPrompt: null,
    ...patch,
  }
}

const said = (at: number): Chat['lastMessage'] => ({ seq: at, at, preview: '' })
const waiting = (at: number): Chat['pendingPrompt'] => ({ promptId: `p${at}`, kind: 'permission', summary: 'Bash: ls', at, count: 1 })
const ids = (chats: Chat[]): string[] => chats.map(item => item.id)

test('General stays first, then newest message first', () => {
  const ordered = orderChats([chat('old', { lastMessage: said(10) }), chat('general', { pinned: true }), chat('new', { lastMessage: said(50) })])
  expect(ids(ordered)).toEqual(['general', 'new', 'old'])
})

test('a session that needs you comes before newer chats, the one waiting longest first', () => {
  const ordered = orderChats([
    chat('chatty', { lastMessage: said(900) }),
    chat('blocked-late', { lastMessage: said(100), pendingPrompt: waiting(300) }),
    chat('blocked-early', { lastMessage: said(50), pendingPrompt: waiting(200) }),
    chat('general', { pinned: true }),
  ])
  expect(ids(ordered)).toEqual(['general', 'blocked-early', 'blocked-late', 'chatty'])
})

test('working sessions come after the ones that need you and before the rest', () => {
  const ordered = orderChats([
    chat('idle-new', { lastMessage: said(800) }),
    chat('working', { busy: true, lastMessage: said(100) }),
    chat('blocked', { busy: true, lastMessage: said(50), pendingPrompt: waiting(60) }),
  ])
  expect(ids(ordered)).toEqual(['blocked', 'working', 'idle-new'])
})

test('an ended chat is never ranked as needing you or working', () => {
  const ordered = orderChats([
    chat('idle', { lastMessage: said(10) }),
    chat('ended', { status: 'ended', busy: true, pendingPrompt: waiting(5), lastMessage: said(500) }),
  ])
  expect(ids(ordered)).toEqual(['ended', 'idle'])
})

test('equal chats keep a stable order by id and the input is not mutated', () => {
  const input = [chat('b'), chat('a')]
  expect(ids(orderChats(input))).toEqual(['a', 'b'])
  expect(ids(input)).toEqual(['b', 'a'])
})

const drafted = (at: number): Chat['draft'] => ({ preview: 'half a reply', at })

test('drafts come after sessions that need you and before working ones, the most recently edited draft first', () => {
  const ordered = orderChats([
    chat('plain', { lastMessage: said(900) }),
    chat('working', { busy: true, lastMessage: said(800) }),
    chat('draft-old', { draft: drafted(100), lastMessage: said(10) }),
    chat('blocked', { pendingPrompt: waiting(5), lastMessage: said(1) }),
    chat('general', { pinned: true }),
    chat('draft-new', { draft: drafted(300), lastMessage: said(5) }),
  ])
  expect(ids(ordered)).toEqual(['general', 'blocked', 'draft-new', 'draft-old', 'working', 'plain'])
})

test('General stays first even when it has a draft', () => {
  const ordered = orderChats([chat('a', { draft: drafted(900) }), chat('general', { pinned: true, draft: drafted(1) }), chat('b')])
  expect(ids(ordered)).toEqual(['general', 'a', 'b'])
})

test('a draft never pushes a session that needs you down, and a blocked session with a draft stays blocked', () => {
  const ordered = orderChats([
    chat('drafting', { draft: drafted(900) }),
    chat('blocked-with-draft', { pendingPrompt: waiting(50), draft: drafted(1) }),
    chat('blocked', { pendingPrompt: waiting(5) }),
  ])
  expect(ids(ordered)).toEqual(['blocked', 'blocked-with-draft', 'drafting'])
})

test('a working session with a draft is ranked as a draft', () => {
  const ordered = orderChats([chat('working', { busy: true, lastMessage: said(900) }), chat('both', { busy: true, draft: drafted(1), lastMessage: said(1) })])
  expect(ids(ordered)).toEqual(['both', 'working'])
})

test('deleting a draft puts the chat back where its latest message puts it', () => {
  const chats = [chat('older', { lastMessage: said(10) }), chat('newer', { lastMessage: said(50) }), chat('general', { pinned: true })]
  const withDraft = chats.map(item => (item.id === 'older' ? { ...item, draft: drafted(1) } : item))
  expect(ids(orderChats(withDraft))).toEqual(['general', 'older', 'newer'])
  expect(ids(orderChats(chats))).toEqual(['general', 'newer', 'older'])
})

test('an ended chat with a draft is not ranked as a draft', () => {
  const ordered = orderChats([chat('idle', { lastMessage: said(10) }), chat('ended', { status: 'ended', draft: drafted(500), lastMessage: said(50) })])
  expect(ids(ordered)).toEqual(['ended', 'idle'])
})

test('a draft from an older server without a time sorts last among drafts', () => {
  const legacy = { preview: 'x' } as unknown as Chat['draft']
  const ordered = orderChats([chat('legacy', { draft: legacy }), chat('dated', { draft: drafted(5) })])
  expect(ids(ordered)).toEqual(['dated', 'legacy'])
})

test('pinned sessions come after the ones that need you and before drafts, working and the rest, newest message first', () => {
  const ordered = orderChats([
    chat('plain', { lastMessage: said(900) }),
    chat('working', { busy: true, lastMessage: said(800) }),
    chat('draft', { draft: drafted(300), lastMessage: said(700) }),
    chat('pinned-old', { pinned: true, lastMessage: said(10) }),
    chat('blocked', { pendingPrompt: waiting(5), lastMessage: said(1) }),
    chat('general', { pinned: true }),
    chat('pinned-new', { pinned: true, lastMessage: said(50) }),
  ])
  expect(ids(ordered)).toEqual(['general', 'blocked', 'pinned-new', 'pinned-old', 'draft', 'working', 'plain'])
})

test('a pinned session that needs you is ranked as needing you, and a pinned one that ended is not ranked as pinned', () => {
  const ordered = orderChats([
    chat('pinned', { pinned: true, lastMessage: said(10) }),
    chat('pinned-blocked', { pinned: true, pendingPrompt: waiting(5), lastMessage: said(1) }),
    chat('pinned-ended', { pinned: true, status: 'ended', lastMessage: said(999) }),
    chat('general', { pinned: true }),
  ])
  expect(ids(ordered)).toEqual(['general', 'pinned-blocked', 'pinned', 'pinned-ended'])
})
