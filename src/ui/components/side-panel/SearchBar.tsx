import { Search, X } from 'lucide-react'
import { useRef } from 'react'
import type { OriginFilter } from '../../chat-filters.ts'
import { Input } from '../ui/input.tsx'
import { SourceFilter } from './SourceFilter.tsx'

type SearchBarProps = {
  query: string
  onQuery(query: string): void
  origin: OriginFilter
  onOrigin(origin: OriginFilter): void
}

/** The search field, its clear button, and the source filter inside it. */
export function SearchBar({ query, onQuery, origin, onOrigin }: SearchBarProps) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        ref={input}
        aria-label="Search sessions"
        placeholder="Search sessions"
        value={query}
        onChange={event => onQuery(event.target.value)}
        className={`h-10 rounded-full border-transparent bg-muted pl-9 shadow-none focus-visible:border-border ${query === '' ? 'pr-11' : 'pr-[4.5rem]'}`}
      />
      {query !== '' && (
        <button
          type="button"
          aria-label="Clear search"
          title="Clear search"
          onClick={() => {
            onQuery('')
            input.current?.focus()
          }}
          className="absolute right-10 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-background/60"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
      <SourceFilter value={origin} onSelect={onOrigin} />
    </div>
  )
}
