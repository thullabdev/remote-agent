import { chatState } from '../channel/web/chat-state.ts'
import type { Chat } from '../channel/web/protocol.ts'

/** What the user wants to see in the chat list: by what a session is doing, not by how it was started. */
export type ListFilter = 'needs_you' | 'working' | 'all' | 'ended' | 'archived'

export const LIST_FILTERS: readonly [ListFilter, string][] = [
  ['needs_you', 'Needs you'],
  ['working', 'Working'],
  ['all', 'All'],
  ['ended', 'Ended'],
  ['archived', 'Archived'],
]

function matchesFilter(chat: Chat, filter: ListFilter): boolean {
  if (filter === 'archived') {
    return chat.id !== 'general' && chat.archived
  }
  if (chat.archived) {
    return false
  }
  switch (filter) {
    case 'all':
      return true
    case 'needs_you':
      return chat.id !== 'general' && chatState(chat) === 'needs_you'
    case 'working':
      return chat.id !== 'general' && chatState(chat) === 'working'
    case 'ended':
      return chat.id !== 'general' && chat.status === 'ended'
  }
}

export function filterChats(chats: Chat[], query: string, filter: ListFilter): Chat[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return chats.filter(chat => matchesFilter(chat, filter) && chat.title.toLocaleLowerCase().includes(normalizedQuery))
}

/** How many chats each filter holds. Search is ignored, so a chip's number does not change while typing. */
export function filterCounts(chats: Chat[]): Record<ListFilter, number> {
  return Object.fromEntries(LIST_FILTERS.map(([filter]) => [filter, chats.filter(chat => matchesFilter(chat, filter)).length])) as Record<ListFilter, number>
}
