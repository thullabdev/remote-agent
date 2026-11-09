import { chatState } from './chat-state.ts'
import type { Chat } from './protocol.ts'

const GENERAL_ID = 'general'

/**
 * 0: has a draft, 1: waiting on the user, 2: working, 3: everything else (idle and ended). An ended chat cannot take a message,
 * so its draft does not rank it.
 */
function tier(chat: Chat): number {
  if (chat.draft !== null && chat.status !== 'ended') {
    return 0
  }
  const state = chatState(chat)
  return state === 'needs_you' ? 1 : state === 'working' ? 2 : 3
}

/**
 * The chat list order, shared by the server and the browser so a chat.updated lands where /api/state would put it:
 * chats with an unsent draft first (the most recently edited on top, so the one being written is at the top), then chats that
 * need the user (the one waiting longest first), then working chats, then the rest. Within a tier the newest message comes first.
 * General is first of everything except a draft that is newer than its own. Deleting a draft puts a chat back by its messages.
 */
export function orderChats(chats: readonly Chat[]): Chat[] {
  return [...chats].sort((a, b) => {
    const tierA = tier(a)
    const tierB = tier(b)
    if (tierA === 0 || tierB === 0) {
      return tierA !== tierB ? tierA - tierB : (b.draft?.at ?? 0) - (a.draft?.at ?? 0) || a.id.localeCompare(b.id)
    }
    if (a.id === GENERAL_ID || b.id === GENERAL_ID) {
      return a.id === GENERAL_ID ? -1 : 1
    }
    if (tierA !== tierB) {
      return tierA - tierB
    }
    if (tierA === 1) {
      const byWait = (a.pendingPrompt?.at ?? 0) - (b.pendingPrompt?.at ?? 0)
      if (byWait !== 0) {
        return byWait
      }
    }
    const byRecency = (b.lastMessage?.at ?? 0) - (a.lastMessage?.at ?? 0)
    return byRecency !== 0 ? byRecency : a.id.localeCompare(b.id)
  })
}
