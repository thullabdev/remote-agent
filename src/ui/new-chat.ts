import type { Chat } from '../channel/web/protocol.ts'

/**
 * The chat to open for the user after they asked for a session to start or resume: the first active chat that was not active
 * when they asked (a new one, or an ended one that came back), and is not General. Undefined once the wait has passed.
 */
export function newChatToOpen(chats: Chat[], known: ReadonlyMap<string, Chat['status']>, until: number, now: number): Chat | undefined {
  if (now > until) {
    return undefined
  }
  return chats.find(chat => chat.id !== 'general' && chat.status === 'active' && known.get(chat.id) !== 'active')
}
