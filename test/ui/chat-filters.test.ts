import { expect, test } from 'bun:test'
import type { Chat } from '../../src/channel/web/protocol.ts'
import { filterChats, filterCounts, LIST_FILTERS, visibleFilters } from '../../src/ui/chat-filters.ts'

const general: Chat = {
  id: 'general', title: 'General', project: null, cwd: null, status: 'active', spawned: false, archived: false, busy: false, unread: 0,
  lastMessage: null, draft: null, pinned: true, tmuxName: null, pendingPrompt: null,
}
const idle: Chat = { ...general, id: 'idle', title: 'Idle session', pinned: false }
const working: Chat = { ...idle, id: 'working', title: 'Working session', busy: true }
const waiting: Chat = {
  ...idle, id: 'waiting', title: 'Waiting session', busy: true,
  pendingPrompt: { promptId: 'p', kind: 'permission', summary: 'Bash: ls', at: 1, count: 1 },
}
const ended: Chat = { ...idle, id: 'ended', title: 'Ended session', status: 'ended' }
const endedWithStalePrompt: Chat = { ...ended, id: 'ended-stale', pendingPrompt: waiting.pendingPrompt, busy: true }
const archived: Chat = { ...ended, id: 'archived', title: 'Archived session', archived: true }
const everything = [general, idle, working, waiting, ended, archived]
const ids = (chats: Chat[]): string[] => chats.map(chat => chat.id)

test('the filters are named after what the user is looking for, with All first because it opens by default', () => {
  expect(LIST_FILTERS.map(([, label]) => label)).toEqual(['All', 'Needs you', 'Working', 'Ended', 'Archived'])
})

test('All shows General and every live session, and leaves ended ones to the Ended tab', () => {
  expect(ids(filterChats(everything, '', 'all'))).toEqual(['general', 'idle', 'working', 'waiting'])
})

test('searching from All also finds ended sessions, so one is never unfindable from the default tab', () => {
  expect(ids(filterChats(everything, 'session', 'all'))).toEqual(['idle', 'working', 'waiting', 'ended'])
  expect(ids(filterChats(everything, 'ended', 'all'))).toEqual(['ended'])
})

test('Needs you and Working show only that state, and never General', () => {
  expect(ids(filterChats(everything, '', 'needs_you'))).toEqual(['waiting'])
  expect(ids(filterChats(everything, '', 'working'))).toEqual(['working'])
})

test('an ended chat is never listed as needing you or working', () => {
  expect(ids(filterChats([endedWithStalePrompt], '', 'needs_you'))).toEqual([])
  expect(ids(filterChats([endedWithStalePrompt], '', 'working'))).toEqual([])
  expect(ids(filterChats([endedWithStalePrompt], '', 'ended'))).toEqual(['ended-stale'])
})

test('Ended lists ended sessions that are not archived, and Archived lists archived ones', () => {
  expect(ids(filterChats(everything, '', 'ended'))).toEqual(['ended'])
  expect(ids(filterChats(everything, '', 'archived'))).toEqual(['archived'])
})

test('search narrows every filter by title, ignoring case', () => {
  expect(ids(filterChats(everything, 'SESSION', 'all'))).toEqual(['idle', 'working', 'waiting', 'ended'])
  expect(ids(filterChats(everything, 'SESSION', 'ended'))).toEqual(['ended'])
  expect(ids(filterChats(everything, 'wait', 'needs_you'))).toEqual(['waiting'])
  expect(ids(filterChats(everything, 'idle', 'needs_you'))).toEqual([])
  expect(ids(filterChats(everything, 'archived', 'archived'))).toEqual(['archived'])
})

test('counts ignore the search so a chip does not change while typing', () => {
  expect(filterCounts(everything)).toEqual({ needs_you: 1, working: 1, all: 4, ended: 1, archived: 1 })
})

test('Needs you and Working are offered only while they hold something, All is always first', () => {
  const none = { needs_you: 0, working: 0, all: 4, ended: 1, archived: 0 }
  expect(visibleFilters(none, 'all').map(([filter]) => filter)).toEqual(['all', 'ended', 'archived'])
  expect(visibleFilters({ ...none, needs_you: 2 }, 'all').map(([filter]) => filter)).toEqual(['all', 'needs_you', 'ended', 'archived'])
  expect(visibleFilters({ ...none, needs_you: 1, working: 1 }, 'all').map(([filter]) => filter)).toEqual(['all', 'needs_you', 'working', 'ended', 'archived'])
})

test('a tab stays while it is selected, even when it has just emptied, so the user sees it clear', () => {
  const none = { needs_you: 0, working: 0, all: 4, ended: 1, archived: 0 }
  expect(visibleFilters(none, 'needs_you').map(([filter]) => filter)).toEqual(['all', 'needs_you', 'ended', 'archived'])
})
