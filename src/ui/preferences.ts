import { ACCENTS, COLOR_THEMES, DEFAULT_COLOR_THEME, type AccentId } from './themes.ts'

export type ThemePreference = 'light' | 'dark' | 'system'
export type AccentPreference = AccentId
export type GlowPreference = 'off' | 'soft' | 'strong'
export type DensityPreference = 'compact' | 'comfortable'
export type FontPreference = 'small' | 'medium' | 'large'
export type EnterPreference = 'send' | 'newline'
export type CodeWrapPreference = 'scroll' | 'wrap'

export type Preferences = {
  theme: ThemePreference
  palette: string
  accent: AccentPreference
  glow: GlowPreference
  density: DensityPreference
  font: FontPreference
  /** What Enter does in the chat composer: send the message, or add a new line (Ctrl/Cmd+Enter then sends). */
  enter: EnterPreference
  /** Long lines in code blocks: scroll sideways inside the block, or wrap onto the next line. */
  codeWrap: CodeWrapPreference
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  palette: DEFAULT_COLOR_THEME,
  accent: 'ink',
  glow: 'soft',
  density: 'comfortable',
  font: 'medium',
  enter: 'newline',
  codeWrap: 'scroll',
}

const STORAGE_KEY = 'remote-agent.preferences.v1'

export function readPreferences(storage: Pick<Storage, 'getItem'> = localStorage): Preferences {
  try {
    const stored: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')
    if (stored === null || typeof stored !== 'object') {
      return DEFAULT_PREFERENCES
    }
    const value = stored as Partial<Preferences>
    return {
      theme: isOneOf(value.theme, ['light', 'dark', 'system']) ? value.theme : DEFAULT_PREFERENCES.theme,
      palette: isOneOf(value.palette, COLOR_THEMES.map(theme => theme.id)) ? value.palette : DEFAULT_PREFERENCES.palette,
      accent: isOneOf(value.accent, ACCENTS) ? value.accent : DEFAULT_PREFERENCES.accent,
      glow: isOneOf(value.glow, ['off', 'soft', 'strong']) ? value.glow : DEFAULT_PREFERENCES.glow,
      density: isOneOf(value.density, ['compact', 'comfortable']) ? value.density : DEFAULT_PREFERENCES.density,
      font: isOneOf(value.font, ['small', 'medium', 'large']) ? value.font : DEFAULT_PREFERENCES.font,
      enter: isOneOf(value.enter, ['send', 'newline']) ? value.enter : DEFAULT_PREFERENCES.enter,
      codeWrap: isOneOf(value.codeWrap, ['scroll', 'wrap']) ? value.codeWrap : DEFAULT_PREFERENCES.codeWrap,
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export function savePreferences(preferences: Preferences, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(preferences))
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && options.includes(value as T)
}

export function resolvedTheme(theme: ThemePreference, systemDark: boolean): 'light' | 'dark' {
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
}
