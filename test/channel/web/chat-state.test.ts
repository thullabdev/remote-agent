import { expect, test } from 'bun:test'
import { chatState } from '../../../src/channel/web/chat-state.ts'
import type { Chat } from '../../../src/channel/web/protocol.ts'

const base: Chat = {
  id: 'c1', title: 'app', project: 'app', cwd: '/app', status: 'active', spawned: false, archived: false,
  busy: false, unread: 0, lastMessage: null, draft: null, pinned: false, tmuxName: null, pendingPrompt: null,
}
const waiting: Chat['pendingPrompt'] = { promptId: 'p1', kind: 'permission', summary: 'Bash: ls', at: 1, count: 1 }

test('a quiet active chat is idle and a busy one is working', () => {
  expect(chatState(base)).toBe('idle')
  expect(chatState({ ...base, busy: true })).toBe('working')
})

test('a pending prompt wins over busy, because the turn is open while it waits', () => {
  expect(chatState({ ...base, busy: true, pendingPrompt: waiting })).toBe('needs_you')
  expect(chatState({ ...base, busy: false, pendingPrompt: waiting })).toBe('needs_you')
})

test('an ended chat is ended whatever else is set', () => {
  expect(chatState({ ...base, status: 'ended', busy: true, pendingPrompt: waiting })).toBe('ended')
})
