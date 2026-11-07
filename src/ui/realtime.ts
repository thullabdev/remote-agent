import type { Chat, Message, ServerEvent, UsageView } from '../channel/web/protocol.ts'
import type { WebState } from './api.ts'

export type RealtimeState = {
  eventSeq: number
  away: boolean
  usage: UsageView
  chats: Chat[]
  messages: Record<string, Message[]>
  hasMore: Record<string, boolean>
  loadedChats: Set<string>
  hiddenBeforeSeq: Record<string, number>
}

export function createRealtimeState(state: WebState): RealtimeState {
  return {
    eventSeq: state.seq,
    away: state.away,
    usage: state.usage,
    chats: state.chats,
    messages: {},
    hasMore: {},
    loadedChats: new Set(),
    hiddenBeforeSeq: {},
  }
}

function orderChats(chats: Chat[]): Chat[] {
  return [...chats].sort((a, b) => {
    if (a.id === 'general') {
      return -1
    }
    if (b.id === 'general') {
      return 1
    }
    return (b.lastMessage?.at ?? 0) - (a.lastMessage?.at ?? 0)
  })
}

function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const byId = new Map(existing.map(message => [message.id, message]))
  for (const message of incoming) {
    byId.set(message.id, message)
  }
  return [...byId.values()].sort((a, b) => a.seq - b.seq)
}

export function mergeHistory(state: RealtimeState, chatId: string, page: { messages: Message[]; hasMore: boolean }): RealtimeState {
  const hiddenBefore = state.hiddenBeforeSeq[chatId] ?? 0
  return {
    ...state,
    messages: {
      ...state.messages,
      [chatId]: mergeMessages(
        state.messages[chatId] ?? [],
        page.messages.filter(message => message.seq > hiddenBefore),
      ),
    },
    hasMore: { ...state.hasMore, [chatId]: page.hasMore },
    loadedChats: new Set(state.loadedChats).add(chatId),
  }
}

export function applyServerEvent(state: RealtimeState, event: ServerEvent): RealtimeState {
  if (event.type === 'usage.updated') {
    return { ...state, usage: event.usage }
  }
  if (event.type === 'hello' || event.type === 'resync' || event.seq <= state.eventSeq) {
    return state
  }

  let next: RealtimeState = { ...state, eventSeq: event.seq }
  switch (event.type) {
    case 'message.created':
    case 'message.updated': {
      const message = event.message
      next = {
        ...next,
        messages: {
          ...next.messages,
          [message.chatId]: mergeMessages(next.messages[message.chatId] ?? [], [message]),
        },
      }
      break
    }
    case 'chat.updated': {
      const chats = next.chats.filter(chat => chat.id !== event.chat.id)
      next = { ...next, chats: orderChats([...chats, event.chat]) }
      break
    }
    case 'chat.cleared': {
      const hiddenBeforeSeq = Math.max(next.hiddenBeforeSeq[event.chatId] ?? 0, event.beforeSeq)
      next = {
        ...next,
        hiddenBeforeSeq: { ...next.hiddenBeforeSeq, [event.chatId]: hiddenBeforeSeq },
        messages: {
          ...next.messages,
          [event.chatId]: (next.messages[event.chatId] ?? []).filter(message => message.seq > hiddenBeforeSeq),
        },
      }
      break
    }
    case 'away.updated':
      next = { ...next, away: event.away }
      break
  }
  return next
}
