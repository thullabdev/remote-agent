import { chatState } from './chat-state.ts'
import type { Chat } from './protocol.ts'

const GENERAL_ID = 'general'

/**
 * 0: waiting on the user, 1: pinned, 2: has a draft, 3: working, 4: everything else (idle and ended). A chat that needs the user
 * stays in tier 0 whatever else it has, so a pin never buries it. An ended chat cannot take a message, so a pin or a draft does
 * not rank it.
 */
function tier(chat: Chat): number {
  const state = chatState(chat)
  if (state === 'needs_you') {
    return 0
  }
  if (chat.pinned && state !== 'ended') {
    return 1
  }
  if (chat.draft !== null && state !== 'ended') {
    return 2
  }
  return state === 'working' ? 3 : 4
}

/**
 * The chat list order, shared by the server and the browser so a chat.updated lands where /api/state would put it:
 * General first, then chats that need the user (the one waiting longest first), then pinned chats, then chats with an unsent draft
 * (the most recently edited first, so the one being written is on top), then working chats, then the rest. Within a tier the newest message comes
 * first. Deleting a draft puts a chat back where its messages put it.
 */
export function orderChats(chats: readonly Chat[]): Chat[] {
  return [...chats].sort((a, b) => {
    if (a.id === GENERAL_ID || b.id === GENERAL_ID) {
      return a.id === GENERAL_ID ? -1 : 1
    }
    const tierA = tier(a)
    const tierB = tier(b)
    if (tierA !== tierB) {
      return tierA - tierB
    }
    // Within a tier: the Prompt waiting longest first, the draft edited last first, otherwise the newest message.
    const withinTier =
      tierA === 0
        ? (a.pendingPrompt?.at ?? 0) - (b.pendingPrompt?.at ?? 0)
        : tierA === 2
          ? (b.draft?.at ?? 0) - (a.draft?.at ?? 0)
          : 0
    if (withinTier !== 0) {
      return withinTier
    }
    const byRecency = (b.lastMessage?.at ?? 0) - (a.lastMessage?.at ?? 0)
    return byRecency !== 0 ? byRecency : a.id.localeCompare(b.id)
  })
}
