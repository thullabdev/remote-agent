import { chatState } from '../channel/web/chat-state.ts'
import type { Chat } from '../channel/web/protocol.ts'

/** What the user wants to see in the chat list: by what a session is doing, not by how it was started. */
export type ListFilter = 'all' | 'needs_you' | 'working' | 'ended' | 'archived'

/** All comes first because it is what opens. */
export const LIST_FILTERS: readonly [ListFilter, string][] = [
  ['all', 'All'],
  ['needs_you', 'Needs you'],
  ['working', 'Working'],
  ['ended', 'Ended'],
  ['archived', 'Archived'],
]

/**
 * All is General and every live session. Ended sessions have their own tab, so they do not crowd All; a search from All still
 * reaches them, so an ended session is never unfindable from the tab that opens by default.
 */
function matchesFilter(chat: Chat, filter: ListFilter, searching: boolean): boolean {
  if (filter === 'archived') {
    return chat.id !== 'general' && chat.archived
  }
  if (chat.archived) {
    return false
  }
  switch (filter) {
    case 'all':
      return chat.id === 'general' || chat.status !== 'ended' || searching
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
  const searching = normalizedQuery !== ''
  return chats.filter(chat => matchesFilter(chat, filter, searching) && chat.title.toLocaleLowerCase().includes(normalizedQuery))
}

/** How many chats each filter holds. Search is ignored, so a chip's number does not change while typing. */
export function filterCounts(chats: Chat[]): Record<ListFilter, number> {
  return Object.fromEntries(LIST_FILTERS.map(([filter]) => [filter, chats.filter(chat => matchesFilter(chat, filter, false)).length])) as Record<ListFilter, number>
}

/**
 * The tabs to show. Needs you and Working are usually empty, so they appear only while they hold something (an empty tab costs
 * nothing then), or while selected, so the user sees the last one clear instead of the tab vanishing under their finger.
 */
export function visibleFilters(counts: Record<ListFilter, number>, selected: ListFilter): readonly [ListFilter, string][] {
  return LIST_FILTERS.filter(([filter]) => {
    if (filter === 'needs_you' || filter === 'working') {
      return counts[filter] > 0 || selected === filter
    }
    return true
  })
}
