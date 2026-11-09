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
