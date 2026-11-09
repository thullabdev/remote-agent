import { describe, expect, test } from 'bun:test'
import type { Chat, Message, ServerEvent } from '../../src/channel/web/protocol.ts'
import { applyServerEvent, createRealtimeState, mergeHistory } from '../../src/ui/realtime.ts'
import { parseServerEvent } from '../../src/ui/use-web-channel.ts'
import type { UsageView } from '../../src/channel/web/protocol.ts'

const noUsage: UsageView = { accounts: [], chats: {} }

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
}

const first: Message = { id: 'm_1', chatId: 'general', seq: 1, at: 10, kind: 'agent_text', markdown: 'hello' }

describe('Web Channel event state', () => {
  test('applies each event once and replaces updated messages by id', () => {
    const initial = createRealtimeState({ seq: 2, away: true, chats: [general], usage: noUsage })
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
      ...createRealtimeState({ seq: 5, away: false, chats: [general], usage: noUsage }),
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
    const initial = createRealtimeState({ seq: 5, away: false, chats: [general], usage: noUsage })
    const cleared = applyServerEvent(initial, { type: 'chat.cleared', seq: 6, chatId: 'general', beforeSeq: 2 })
    const lateHistory = mergeHistory(cleared, 'general', { messages: [first, { ...first, seq: 3 }], hasMore: false })

    expect(lateHistory.messages.general?.map(message => message.seq)).toEqual([3])
  })

  test('keeps the Bridge ordering when a chat receives an update', () => {
    const second: Chat = { ...general, id: 'c_2', title: 'Second', pinned: false, lastMessage: { seq: 1, at: 100, preview: 'new' } }
    const initial = createRealtimeState({ seq: 1, away: false, chats: [general, second], usage: noUsage })

    const moved = applyServerEvent(initial, {
      type: 'chat.updated',
      seq: 2,
      chat: { ...general, unread: 2, lastMessage: { seq: 2, at: 200, preview: 'latest' } },
    })

    expect(moved.chats.map(chat => chat.id)).toEqual(['general', 'c_2'])
  })
})

describe('usage.updated', () => {
  const usage: UsageView = {
    accounts: [{ source: 'claude-code', windows: [{ kind: 'five_hour', label: '5h', windowMinutes: 300, usedPercent: 2, resetsAtMs: 1000 }], measuredAt: 5 }],
    chats: {},
  }

  test('parses a seq-less usage.updated line and stores it without moving eventSeq', () => {
    const event = parseServerEvent(JSON.stringify({ type: 'usage.updated', usage }))
    expect(event).toEqual({ type: 'usage.updated', usage })
    const initial = createRealtimeState({ seq: 7, away: false, chats: [general], usage: noUsage })
    const next = applyServerEvent(initial, event!)
    expect(next.usage).toEqual(usage)
    expect(next.eventSeq).toBe(7)
  })

  test('rejects malformed usage and still rejects a seq-less message.created', () => {
    expect(parseServerEvent(JSON.stringify({ type: 'usage.updated', usage: { accounts: [] } }))).toBeNull()
    expect(parseServerEvent(JSON.stringify({ type: 'usage.updated' }))).toBeNull()
    expect(parseServerEvent(JSON.stringify({ type: 'message.created', message: first }))).toBeNull()
  })
})
