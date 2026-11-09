import { expect, test } from 'bun:test'
import type { Chat } from '../../src/channel/web/protocol.ts'
import { isSelectableChat } from '../../src/ui/components/chat-list.tsx'

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
  lastMessage: null, draft: null,
  pinned: true,
  tmuxName: null,
  pendingPrompt: null,
}

const laptop: Chat = { ...general, id: 'laptop-chat', title: 'Laptop session', pinned: false }
const spawned: Chat = { ...general, id: 'spawned-chat', title: 'Spawned session', spawned: true, pinned: false }
const endedSpawned: Chat = { ...spawned, id: 'ended-spawned-chat', title: 'Ended spawned session', status: 'ended' }
const endedLaptop: Chat = { ...laptop, id: 'ended-laptop-chat', title: 'Ended active session', status: 'ended' }
const archivedSpawned: Chat = { ...endedSpawned, id: 'archived-spawned-chat', title: 'Archived spawned session', archived: true }
const archivedLaptop: Chat = { ...endedLaptop, id: 'archived-laptop-chat', title: 'Archived active session', archived: true }

test('only ended unarchived sessions can be selected for archive', () => {
  expect(isSelectableChat(endedLaptop)).toBe(true)
  expect(isSelectableChat(endedSpawned)).toBe(true)
  expect(isSelectableChat(laptop)).toBe(false)
  expect(isSelectableChat(archivedLaptop)).toBe(false)
  expect(isSelectableChat(general)).toBe(false)
})
