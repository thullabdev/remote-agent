import { expect, test } from 'bun:test'
import type { Chat } from '../../src/channel/web/protocol.ts'
import { filterChats, isSelectableChat } from '../../src/ui/components/chat-list.tsx'

const general: Chat = {
  id: 'general',
  title: 'General',
  project: null,
  cwd: null,
  status: 'active',
  spawned: false,
  archived: false,
  busy: false,
  unread: 0,
  lastMessage: null,
  pinned: true,
  tmuxName: null,
}

const laptop: Chat = { ...general, id: 'laptop-chat', title: 'Laptop session', pinned: false }
const spawned: Chat = { ...general, id: 'spawned-chat', title: 'Spawned session', spawned: true, pinned: false }
const endedSpawned: Chat = { ...spawned, id: 'ended-spawned-chat', title: 'Ended spawned session', status: 'ended' }
const endedLaptop: Chat = { ...laptop, id: 'ended-laptop-chat', title: 'Ended active session', status: 'ended' }
const archivedSpawned: Chat = { ...endedSpawned, id: 'archived-spawned-chat', title: 'Archived spawned session', archived: true }
const archivedLaptop: Chat = { ...endedLaptop, id: 'archived-laptop-chat', title: 'Archived active session', archived: true }

test('filters sessions by origin and keeps General in the All view only', () => {
  const chats = [general, laptop, spawned]

  expect(filterChats(chats, '', 'all').map(chat => chat.id)).toEqual(['general', 'laptop-chat', 'spawned-chat'])
  expect(filterChats(chats, '', 'laptop').map(chat => chat.id)).toEqual(['laptop-chat'])
  expect(filterChats(chats, '', 'spawned').map(chat => chat.id)).toEqual(['spawned-chat'])
})

test('combines the origin filter with title search', () => {
  expect(filterChats([laptop, spawned], 'SPAWNED', 'spawned').map(chat => chat.id)).toEqual(['spawned-chat'])
  expect(filterChats([laptop, spawned], 'laptop', 'spawned')).toEqual([])
})

test('shows ended sessions until archived and lists archived sessions in their own filter', () => {
  const chats = [spawned, endedSpawned, endedLaptop, archivedSpawned, archivedLaptop]

  expect(filterChats(chats, '', 'all').map(chat => chat.id)).toEqual(['spawned-chat', 'ended-spawned-chat', 'ended-laptop-chat'])
  expect(filterChats(chats, '', 'spawned').map(chat => chat.id)).toEqual(['spawned-chat', 'ended-spawned-chat'])
  expect(filterChats(chats, '', 'archived').map(chat => chat.id)).toEqual(['archived-spawned-chat', 'archived-laptop-chat'])
})

test('only ended unarchived sessions can be selected for archive', () => {
  expect(isSelectableChat(endedLaptop)).toBe(true)
  expect(isSelectableChat(endedSpawned)).toBe(true)
  expect(isSelectableChat(laptop)).toBe(false)
  expect(isSelectableChat(archivedLaptop)).toBe(false)
  expect(isSelectableChat(general)).toBe(false)
})
