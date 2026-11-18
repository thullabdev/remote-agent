import { Bell, ChevronRight, MessageSquareText, Palette, Search, X, type LucideIcon } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { SETTING_GROUPS, type SettingGroupId, type SettingId } from '../../settings/settings-registry.ts'
import { searchSettings } from '../../settings/settings-search.ts'
import { Input } from '../ui/input.tsx'
import { SidePanelFrame } from '../side-panel/SidePanelFrame.tsx'

/** Each group's icon in the side panel. */
const GROUP_ICONS: Record<SettingGroupId, LucideIcon> = {
  appearance: Palette,
  chat: MessageSquareText,
  notifications: Bell,
}

export type SettingsSidePanelProps = {
  /** Opens a group in the main area; `focus` names the setting a search result picked. */
  onOpen(group: SettingGroupId, focus?: SettingId): void
  /** The search the panel opens with. Empty, unless a test says otherwise. */
  initialQuery?: string
}

/**
 * The Settings tab of the side column: a search field over every setting, and the list of groups when nothing is
 * searched. Picking a group or a result opens it in the main area. The query is not kept when the tab is left.
 */
export function SettingsSidePanel({ onOpen, initialQuery = '' }: SettingsSidePanelProps) {
  const [query, setQuery] = useState(initialQuery)
  const input = useRef<HTMLInputElement>(null)
  const results = useMemo(() => searchSettings(query), [query])
  const searching = query.trim() !== ''

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

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {searching ? (
          results.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">No settings match &ldquo;{query.trim()}&rdquo;.</div>
          ) : (
            <div className="space-y-1">
              {results.map(setting => (
                <button
                  type="button"
                  key={setting.id}
                  onClick={() => onOpen(setting.group, setting.id)}
                  className="w-full rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted"
                >
                  <span className="block text-sm font-medium">{setting.title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {SETTING_GROUPS.find(group => group.id === setting.group)?.title} · {setting.description}
                  </span>
                </button>
              ))}
            </div>
          )
        ) : (
          <div className="space-y-1">
            {SETTING_GROUPS.map(group => {
              const Icon = GROUP_ICONS[group.id]
              return (
                <button
                  type="button"
                  key={group.id}
                  onClick={() => onOpen(group.id)}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-3.5 text-left transition-colors hover:bg-muted"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{group.title}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{group.description}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              )
            })}
          </div>
        )}
      </div>
    </SidePanelFrame>
  )
}
