import { Search, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { SettingGroupId } from '../../settings/settings-registry.ts'
import { groupsForView, type GroupOpenState } from '../../settings/settings-search.ts'
import { Input } from '../ui/input.tsx'
import { SidePanelFrame } from '../side-panel/SidePanelFrame.tsx'
import { SettingsGroup } from './SettingsGroup.tsx'
import type { SettingsContext } from './settings-rows.tsx'

export type SettingsSidePanelProps = {
  /** What every setting row reads and writes. The app supplies it. */
  context: SettingsContext
  /** The search the panel opens with. Empty, unless a test says otherwise. */
  initialQuery?: string
}

const ALL_OPEN: GroupOpenState = { appearance: true, chat: true, notifications: true }

/**
 * The Settings tab of the side column. The search field stays at the top; the groups scroll beneath it, each one collapsible
 * and expanded by default. A search keeps the matching settings in their groups. The query is not kept when the tab is left.
 */
export function SettingsSidePanel({ context, initialQuery = '' }: SettingsSidePanelProps) {
  const [query, setQuery] = useState(initialQuery)
  const [open, setOpen] = useState<GroupOpenState>(ALL_OPEN)
  const input = useRef<HTMLInputElement>(null)
  const views = useMemo(() => groupsForView(query, open), [query, open])

  const toggle = (group: SettingGroupId) => {
    setOpen(current => ({ ...current, [group]: !current[group] }))
  }

  return (
    <SidePanelFrame label="Settings">
      <header className="flex h-[4.25rem] shrink-0 items-center px-4">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={input}
            aria-label="Search settings"
            placeholder="Search settings"
            value={query}
            onChange={event => setQuery(event.target.value)}
            className={`h-10 rounded-full border-transparent bg-muted pl-9 shadow-none focus-visible:border-border ${query === '' ? '' : 'pr-11'}`}
          />
          {query !== '' && (
            <button
              type="button"
              aria-label="Clear search"
              title="Clear search"
              onClick={() => {
                setQuery('')
                input.current?.focus()
              }}
              className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-background/60"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 max-md:pb-24">
        {views.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">No settings match &ldquo;{query.trim()}&rdquo;.</div>
        ) : (
          views.map(view => <SettingsGroup key={view.group} view={view} context={context} onToggle={toggle} />)
        )}
      </div>
    </SidePanelFrame>
  )
}
