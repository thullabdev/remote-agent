import type { Chat } from '../../../channel/web/protocol.ts'

export function isSelectableChat(chat: Chat): boolean {
  return chat.id !== 'general' && chat.status === 'ended' && !chat.archived
}

export function isPinnableChat(chat: Chat): boolean {
  return chat.id !== 'general' && chat.status !== 'ended' && !chat.archived
}

export type SelectionGroup = 'ended' | 'live'

// A selection holds one kind of session: ended ones can be archived, live ones can be pinned.
export function selectionGroupOf(chat: Chat): SelectionGroup | null {
  if (isSelectableChat(chat)) {
    return 'ended'
  }
  return isPinnableChat(chat) ? 'live' : null
}
