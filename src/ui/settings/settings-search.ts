import { SETTINGS, SETTING_GROUPS, type SettingDefinition, type SettingGroupId } from './settings-registry.ts'

/** Whether each group is expanded when nothing is searched. */
export type GroupOpenState = Readonly<Record<SettingGroupId, boolean>>

/** One group as the side panel shows it: the settings to list, and whether the group is open. */
export type GroupView = {
  group: SettingGroupId
  title: string
  description: string
  settings: SettingDefinition[]
  /** True while a search is active: the group is expanded and cannot be collapsed. */
  searching: boolean
  open: boolean
}

/**
 * The groups the side panel shows for a query. A blank query shows every group with all its settings, each open as the
 * state says. A query shows only the groups with a match, each with only its matching settings, all expanded. Searching
 * does not change the open state, so clearing the query returns each group to how it was.
 */
export function groupsForView(query: string, open: GroupOpenState): GroupView[] {
  const searching = query.trim() !== ''
  const matches = searching ? searchSettings(query) : SETTINGS
  return SETTING_GROUPS.flatMap(group => {
    const settings = matches.filter(setting => setting.group === group.id)
    if (settings.length === 0) {
      return []
    }
    return [{ group: group.id, title: group.title, description: group.description, settings, searching, open: searching || open[group.id] }]
  })
}

/**
 * The settings a query finds. Every word of the query must appear, ignoring case, in a setting's title, description or
 * keywords. Words are matched as plain text, so characters such as `(` never mean anything. A blank query finds nothing.
 */
export function searchSettings(query: string): SettingDefinition[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return []
  }
  return SETTINGS.filter(setting => {
    const haystack = [setting.title, setting.description, ...setting.keywords].join(' ').toLowerCase()
    return words.every(word => haystack.includes(word))
  })
}
