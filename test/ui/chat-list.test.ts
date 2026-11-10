import { expect, test } from 'bun:test'
import type { Chat } from '../../src/channel/web/protocol.ts'
import { isPinnableChat, isSelectableChat, selectionGroupOf } from '../../src/ui/components/chat-list.tsx'

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
  pendingPrompt: null, activity: null,
}

const computer: Chat = { ...general, id: 'computer-chat', title: 'Computer session', pinned: false }
const spawned: Chat = { ...general, id: 'spawned-chat', title: 'Spawned session', spawned: true, pinned: false }
const endedSpawned: Chat = { ...spawned, id: 'ended-spawned-chat', title: 'Ended spawned session', status: 'ended' }
const endedComputer: Chat = { ...computer, id: 'ended-computer-chat', title: 'Ended active session', status: 'ended' }
const archivedSpawned: Chat = { ...endedSpawned, id: 'archived-spawned-chat', title: 'Archived spawned session', archived: true }
const archivedComputer: Chat = { ...endedComputer, id: 'archived-computer-chat', title: 'Archived active session', archived: true }

test('only ended unarchived sessions can be selected for archive', () => {
  expect(isSelectableChat(endedComputer)).toBe(true)
  expect(isSelectableChat(endedSpawned)).toBe(true)
  expect(isSelectableChat(computer)).toBe(false)
  expect(isSelectableChat(archivedComputer)).toBe(false)
  expect(isSelectableChat(general)).toBe(false)
})

test('long press groups sessions: ended ones archive, live ones pin, General and archived do neither', () => {
  expect(selectionGroupOf(endedComputer)).toBe('ended')
  expect(selectionGroupOf(computer)).toBe('live')
  expect(selectionGroupOf(spawned)).toBe('live')
  expect(selectionGroupOf(general)).toBeNull()
  expect(selectionGroupOf(archivedComputer)).toBeNull()
  expect(isPinnableChat(endedComputer)).toBe(false)
})
