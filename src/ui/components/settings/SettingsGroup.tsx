import { Bell, ChevronDown, MessageSquareText, Palette, type LucideIcon } from 'lucide-react'
import type { SettingGroupId } from '../../settings/settings-registry.ts'
import type { GroupView } from '../../settings/settings-search.ts'
import { SettingRow, type SettingsContext } from './settings-rows.tsx'

/** Each group's icon in the side panel. */
const GROUP_ICONS: Record<SettingGroupId, LucideIcon> = {
  appearance: Palette,
  chat: MessageSquareText,
  notifications: Bell,
}

/**
 * One group in the side panel. Its header stays at the top of the scrolling list while the group's settings pass under it.
 * The header toggles the group unless a search is active; a search keeps every match open and shows the header as a title.
 */
export function SettingsGroup({ view, context, onToggle }: { view: GroupView; context: SettingsContext; onToggle(group: SettingGroupId): void }) {
  const Icon = GROUP_ICONS[view.group]
  const bodyId = `settings-group-${view.group}`
  const title = (
    <>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{view.title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{view.description}</span>
      </span>
      {!view.searching && (
        <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${view.open ? '' : '-rotate-90'}`} aria-hidden="true" />
      )}
    </>
  )
  const headerClass = 'sticky top-0 z-10 flex w-full items-center gap-3 bg-background px-3 py-3.5 text-left'

  return (
    <section data-group={view.group}>
      {view.searching ? (
        <div className={headerClass}>{title}</div>
      ) : (
        <button
          type="button"
          aria-expanded={view.open}
          aria-controls={bodyId}
          onClick={() => onToggle(view.group)}
          className={`${headerClass} transition-colors hover:bg-muted`}
        >
          {title}
        </button>
      )}
      {view.open && (
        <div id={bodyId} className="space-y-3 px-1 pb-3">
          {view.settings.map(setting => (
            <SettingRow key={setting.id} setting={setting} context={context} />
          ))}
        </div>
      )}
    </section>
  )
}
