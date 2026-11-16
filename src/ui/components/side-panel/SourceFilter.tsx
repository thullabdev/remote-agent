import { Check, SlidersHorizontal } from 'lucide-react'
import { ORIGIN_FILTERS, type OriginFilter } from '../../chat-filters.ts'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu.tsx'

/** Narrows the list to sessions started on the computer or spawned from Remote Agent. Sits inside the search field to keep the header light. */
export function SourceFilter({ value, onSelect }: { value: OriginFilter; onSelect(origin: OriginFilter): void }) {
  const active = value !== 'all'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Filter by source"
          data-active={active ? 'true' : undefined}
          className={`absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full hover:bg-background/60 ${active ? 'text-primary' : 'text-muted-foreground'}`}
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          {active && <span aria-hidden="true" className="absolute right-1 top-1 size-2 rounded-full bg-primary" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {ORIGIN_FILTERS.map(([origin, label]) => (
          <DropdownMenuItem key={origin} onSelect={() => onSelect(origin)}>
            <span className="flex-1">{label}</span>
            {value === origin && <Check className="size-4" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
