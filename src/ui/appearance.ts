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
  // Every theme-color tag gets the chosen background, so the light and dark variants in index.html never disagree with the theme.
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute('content', vars['--background'] ?? '')
  }
  return mode
}
