import type { ReactNode } from 'react'
import { ActivityBar, type ActivityTab } from './ActivityBar.tsx'

/**
 * The whole left column: the tab strip and the selected tab's panel. On the narrow layout it slides over the main area, and
 * the tab strip becomes a bottom bar under the panel. On desktop the strip is a narrow column on the far left.
 */
export function SideColumn({
  shown,
  tabs,
  selected,
  onSelect,
  children,
}: {
  shown: boolean
  tabs: ActivityTab[]
  selected: string
  onSelect(id: string): void
  children: ReactNode
}) {
  return (
    <div
      className={`absolute inset-0 z-10 flex min-w-0 flex-col bg-background transition-[transform,visibility] duration-300 md:relative md:z-auto md:h-full md:shrink-0 md:translate-x-0 ${
        shown ? 'translate-x-0' : '-translate-x-full max-md:invisible'
      }`}
    >
      <div className="flex min-h-0 min-w-0 flex-1">
        <ActivityBar
          tabs={tabs}
          selected={selected}
          onSelect={onSelect}
          className="hidden w-[52px] shrink-0 flex-col gap-1 border-r border-border py-3 md:flex"
        />
        {children}
      </div>
      <ActivityBar
        tabs={tabs}
        selected={selected}
        onSelect={onSelect}
        className="flex shrink-0 flex-row gap-1 border-t border-border px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1 md:hidden"
      />
    </div>
  )
}
