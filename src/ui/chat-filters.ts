import { chatState } from '../channel/web/chat-state.ts'
import type { Chat } from '../channel/web/protocol.ts'

/** What the user wants to see in the chat list: by what a session is doing, not by how it was started. */
export type ListFilter = 'all' | 'needs_you' | 'working' | 'ended' | 'archived'

/** Where a session runs: on the user's computer (started there), or spawned from Remote Agent in a tmux session. */
export type OriginFilter = 'all' | 'computer' | 'spawned'

export const ORIGIN_FILTERS: readonly [OriginFilter, string][] = [
  ['all', 'All sources'],
  ['computer', 'Computer'],
  ['spawned', 'Spawned'],
]

/** General is neither, so any source other than All leaves it out. */
export function matchesOrigin(chat: Chat, origin: OriginFilter): boolean {
  return origin === 'all' || (chat.id !== 'general' && chat.spawned === (origin === 'spawned'))
}

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

/** The words of a search: lowercase, split on spaces, empty ones dropped. */
export function searchTerms(query: string): string[] {
  return query.toLocaleLowerCase().split(/\s+/).filter(term => term !== '')
}

/**
 * Whether a session matches a search. Every word has to be found somewhere in the session's title, project, folder, last message
 * or draft, in any order. No words matches everything.
 */
export function chatMatchesSearch(chat: Chat, terms: string[]): boolean {
  if (terms.length === 0) {
    return true
  }
  const haystack = [chat.title, chat.project, chat.cwd, chat.lastMessage?.preview, chat.draft?.preview]
    .filter((part): part is string => part !== null && part !== undefined)
    .join('\n')
    .toLocaleLowerCase()
  return terms.every(term => haystack.includes(term))
}

export function filterChats(chats: Chat[], query: string, filter: ListFilter, origin: OriginFilter = 'all'): Chat[] {
  const terms = searchTerms(query)
  return chats.filter(chat => matchesOrigin(chat, origin) && matchesFilter(chat, filter, terms.length > 0) && chatMatchesSearch(chat, terms))
}

/** How many chats each filter holds, for the chosen source. Search is ignored, so a chip's number does not change while typing. */
export function filterCounts(chats: Chat[], origin: OriginFilter = 'all'): Record<ListFilter, number> {
  const inSource = chats.filter(chat => matchesOrigin(chat, origin))
  return Object.fromEntries(LIST_FILTERS.map(([filter]) => [filter, inSource.filter(chat => matchesFilter(chat, filter, false)).length])) as Record<ListFilter, number>
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
