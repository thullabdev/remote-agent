import { visibleFilters, type ListFilter } from '../../chat-filters.ts'

/** Horizontally scrolling tabs. Needs you and Working only appear while they hold something. */
export function ChatFilterBar({
  value,
  counts,
  endedUnread,
  onSelect,
}: {
  value: ListFilter
  counts: Record<ListFilter, number>
  /** An ended session has unread messages, so a session that just finished or failed is not missed behind the Ended tab. */
  endedUnread: boolean
  onSelect(filter: ListFilter): void
}) {
  return (
    <div
      className="flex shrink-0 gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="group"
      aria-label="Filter sessions"
    >
      {visibleFilters(counts, value).map(([filter, label]) => {
        const selected = value === filter
        const count = counts[filter]
        const attention = filter === 'needs_you' && count > 0
        const showCount = (filter === 'needs_you' || filter === 'working') && count > 0
        const showDot = filter === 'ended' && endedUnread
        return (
          <button
            key={filter}
            type="button"
            aria-pressed={selected}
            aria-label={showDot ? `${label}, has unread messages` : undefined}
            onClick={() => onSelect(filter)}
            className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors ${
              selected ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60'
            } ${attention && !selected ? 'text-status-needs' : ''}`}
          >
            {label}
            {showCount && <span className={`tabular-nums text-xs ${attention ? 'text-status-needs' : ''}`}>{count}</span>}
            {showDot && <span data-unread="true" aria-hidden="true" className="size-2 rounded-full bg-primary" />}
          </button>
        )
      })}
    </div>
  )
}
