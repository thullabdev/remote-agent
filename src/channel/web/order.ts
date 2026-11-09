import { chatState } from './chat-state.ts'
import type { Chat } from './protocol.ts'

const GENERAL_ID = 'general'

/** 0: waiting on the user, 1: working, 2: everything else (idle and ended). */
function tier(chat: Chat): number {
  const state = chatState(chat)
  return state === 'needs_you' ? 0 : state === 'working' ? 1 : 2
}

/**
 * The chat list order, shared by the server and the browser so a chat.updated lands where /api/state would put it:
 * General first, then chats that need the user (the one waiting longest first), then working chats, then the rest.
 * Within a tier the newest message comes first.
 */
export function orderChats(chats: readonly Chat[]): Chat[] {
  return [...chats].sort((a, b) => {
    if (a.id === GENERAL_ID || b.id === GENERAL_ID) {
      return a.id === GENERAL_ID ? -1 : 1
    }
    const byTier = tier(a) - tier(b)
    if (byTier !== 0) {
      return byTier
    }
    if (tier(a) === 0) {
      const byWait = (a.pendingPrompt?.at ?? 0) - (b.pendingPrompt?.at ?? 0)
      if (byWait !== 0) {
        return byWait
      }
    }
    const byRecency = (b.lastMessage?.at ?? 0) - (a.lastMessage?.at ?? 0)
    return byRecency !== 0 ? byRecency : a.id.localeCompare(b.id)
  })
}
