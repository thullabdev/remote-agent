import { resolvedTheme, type Preferences } from './preferences.ts'
import { appearanceVars } from './themes.ts'

/** Writes the mode class, theme colors, glow level and browser chrome color for these preferences. Returns the resolved mode. */
export function applyAppearance(preferences: Preferences, systemDark: boolean, root: HTMLElement = document.documentElement): 'light' | 'dark' {
  const mode = resolvedTheme(preferences.theme, systemDark)
  const vars = appearanceVars(preferences.palette, mode, preferences.accent)
  root.classList.toggle('dark', mode === 'dark')
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value)
  }
  root.dataset.glow = preferences.glow
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars['--background'] ?? '')
  return mode
}
