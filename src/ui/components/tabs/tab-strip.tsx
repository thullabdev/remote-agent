import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '../../lib/utils.ts'

/**
 * A row of tabs shared by side panels and the main panel. The strip is a tablist with a hairline under it. Each tab is a name
 * with a close button after it; the close button shows on the selected tab and on hover, and always on touch screens.
 */
export function TabStrip({ label, padX, children }: { label: string; padX?: string; children: ReactNode }) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn('flex h-full min-h-0 min-w-0 shrink items-stretch gap-4 overflow-x-auto overflow-y-hidden border-b border-border/60 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', padX)}
    >
      {children}
    </div>
  )
}

/** One tab: the name selects it, and the close button after it (with a gap) closes it. */
export function TabItem({
  name,
  title,
  selected,
  closeLabel,
  onSelect,
  onClose,
}: {
  name: ReactNode
  title: string
  selected: boolean
  closeLabel: string
  onSelect(): void
  onClose(): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  // A selected tab that is scrolled out of the strip (many tabs) is brought into view, so the active one is always visible.
  useEffect(() => {
    if (selected) {
      ref.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    }
  }, [selected])
  return (
    <div ref={ref} className="group relative flex h-full shrink-0 items-center">
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        title={title}
        onClick={onSelect}
        className={cn('max-w-[220px] truncate py-2 text-xs transition-colors', selected ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}
      >
        {name}
      </button>
      <button
        type="button"
        aria-label={closeLabel}
        title={closeLabel}
        onClick={onClose}
        className={cn(
          'ml-1.5 mr-1 grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground',
          selected ? 'opacity-70' : 'opacity-70 md:opacity-0 md:group-hover:opacity-70 md:focus-visible:opacity-70',
        )}
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </div>
  )
}
