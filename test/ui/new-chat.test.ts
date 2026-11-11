import { expect, test } from 'bun:test'
import type { Chat } from '../../src/channel/web/protocol.ts'
import { newChatToOpen } from '../../src/ui/new-chat.ts'

function chat(id: string, patch: Partial<Chat> = {}): Chat {
  return {
    id, title: id, project: null, cwd: null, status: 'active', spawned: true, archived: false, busy: false, unread: 0,
    lastMessage: null, draft: null, pinned: false, tmuxName: null, pendingPrompt: null, activity: null, ...patch,
  }
}

test('opens the first new active chat, never General or one already active when asked', () => {
  const known = new Map<string, 'active' | 'ended'>([['general', 'active'], ['old', 'active']])
  const chats = [chat('general'), chat('old'), chat('fresh')]
  expect(newChatToOpen(chats, known, 100, 50)?.id).toBe('fresh')
})

test('opens an ended chat once it is active again, which is what a resume does', () => {
  const known = new Map<string, 'active' | 'ended'>([['general', 'active'], ['history', 'ended']])
  expect(newChatToOpen([chat('general'), chat('history')], known, 100, 50)?.id).toBe('history')
})

test('a new chat that has ended is not opened, and nothing opens after the wait', () => {
  const known = new Map<string, 'active' | 'ended'>([['general', 'active']])
  expect(newChatToOpen([chat('gone', { status: 'ended' })], known, 100, 50)).toBeUndefined()
  expect(newChatToOpen([chat('late')], known, 100, 101)).toBeUndefined()
})
