import type { ComponentType } from 'react'

export type ActivityTab = { id: string; title: string; icon: ComponentType<{ className?: string }> }

/**
 * The tab buttons of the side column. The caller decides the layout: a vertical strip on desktop, a bottom bar on phones.
 * The title shows under the icon on phones only; it is always the button's accessible name.
 */
export function ActivityBar({ tabs, selected, onSelect, className }: { tabs: ActivityTab[]; selected: string; onSelect(id: string): void; className?: string }) {
  return (
    <nav aria-label="Side panel tabs" className={`items-center bg-background ${className ?? ''}`}>
      {tabs.map(tab => {
        const Icon = tab.icon
        const active = tab.id === selected
        return (
          <button
            key={tab.id}
            type="button"
            aria-label={tab.title}
            title={tab.title}
            aria-pressed={active}
            onClick={() => onSelect(tab.id)}
            className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl py-2 transition-colors md:size-10 md:flex-none md:py-0 ${
              active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="size-5" />
            <span className="text-[10px] font-medium leading-none md:sr-only">{tab.title}</span>
          </button>
        )
      })}
    </nav>
  )
}
