import type { ListFilter, OriginFilter } from '../../chat-filters.ts'

/** What an empty list says: why it is empty, in the words of what the user asked to see. */
export function emptyMessage(query: string, filter: ListFilter, origin: OriginFilter): string {
  if (query.trim() !== '') {
    return 'No sessions match that search.'
  }
  if (origin !== 'all') {
    return `No ${origin} sessions here.`
  }
  switch (filter) {
    case 'all':
      return 'Your sessions will appear here.'
    case 'needs_you':
      return 'Nothing is waiting on you.'
    case 'working':
      return 'No session is working right now.'
    case 'ended':
      return 'No ended sessions.'
    case 'archived':
      return 'No archived sessions.'
  }
}
