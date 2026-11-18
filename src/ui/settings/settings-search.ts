import { SETTINGS, type SettingDefinition } from './settings-registry.ts'

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
