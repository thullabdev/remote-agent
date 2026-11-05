import { describe, expect, test } from 'bun:test'
import type { Chat, Message, ServerEvent } from '../../src/channel/web/protocol.ts'
import { applyServerEvent, createRealtimeState, mergeHistory } from '../../src/ui/realtime.ts'

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

const first: Message = { id: 'm_1', chatId: 'general', seq: 1, at: 10, kind: 'agent_text', markdown: 'hello' }

describe('Web Channel event state', () => {
  test('applies each event once and replaces updated messages by id', () => {
    const initial = createRealtimeState({ seq: 2, away: true, chats: [general] })
    const created: ServerEvent = { type: 'message.created', seq: 3, message: first }
    const answered: Message = { ...first, kind: 'agent_text', markdown: 'complete' }
    const updated: ServerEvent = { type: 'message.updated', seq: 4, message: answered }

    const afterCreate = applyServerEvent(initial, created)
    const afterDuplicate = applyServerEvent(afterCreate, created)
    const afterUpdate = applyServerEvent(afterDuplicate, updated)

    expect(afterDuplicate).toBe(afterCreate)
    expect(afterUpdate.eventSeq).toBe(4)
    expect(afterUpdate.messages.general).toEqual([answered])
  })

  test('a clear event removes only messages at or before the server cutoff', () => {
    const withMessages = {
      ...createRealtimeState({ seq: 5, away: false, chats: [general] }),
      loadedChats: new Set(['general']),
      messages: {
        general: [
          first,
          { ...first, id: 'm_2', seq: 2 },
          { ...first, id: 'm_3', seq: 3 },
        ],
      },
    }

    const cleared = applyServerEvent(withMessages, { type: 'chat.cleared', seq: 6, chatId: 'general', beforeSeq: 2 })

    expect(cleared.messages.general?.map(message => message.id)).toEqual(['m_3'])
  })

  test('a history request racing with clear cannot restore hidden messages', () => {
    const initial = createRealtimeState({ seq: 5, away: false, chats: [general] })
    const cleared = applyServerEvent(initial, { type: 'chat.cleared', seq: 6, chatId: 'general', beforeSeq: 2 })
    const lateHistory = mergeHistory(cleared, 'general', { messages: [first, { ...first, seq: 3 }], hasMore: false })

    expect(lateHistory.messages.general?.map(message => message.seq)).toEqual([3])
  })

  test('keeps the Bridge ordering when a chat receives an update', () => {
    const second: Chat = { ...general, id: 'c_2', title: 'Second', pinned: false, lastMessage: { seq: 1, at: 100, preview: 'new' } }
    const initial = createRealtimeState({ seq: 1, away: false, chats: [general, second] })

    const moved = applyServerEvent(initial, {
      type: 'chat.updated',
      seq: 2,
      chat: { ...general, unread: 2, lastMessage: { seq: 2, at: 200, preview: 'latest' } },
    })

    expect(moved.chats.map(chat => chat.id)).toEqual(['general', 'c_2'])
  })
})
