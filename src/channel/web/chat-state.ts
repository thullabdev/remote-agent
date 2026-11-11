import type { Chat } from './protocol.ts'

/**
 * What a chat is doing, for the list, the header and the details: one answer, so they cannot disagree.
 * `needs_you` wins over `working` because a Session waiting on a Prompt still has its turn open (`busy` stays true).
 * An ended chat is `ended` whatever else is set.
 */
export type ChatState = 'needs_you' | 'working' | 'idle' | 'ended'

export function chatState(chat: Pick<Chat, 'status' | 'busy' | 'pendingPrompt'>): ChatState {
  if (chat.status === 'ended') {
    return 'ended'
  }
  if (chat.pendingPrompt !== null) {
    return 'needs_you'
  }
  return chat.busy ? 'working' : 'idle'
}
