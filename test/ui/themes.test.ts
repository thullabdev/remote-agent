import { describe, expect, test } from 'bun:test'
import { appearanceVars, COLOR_THEMES, DEFAULT_COLOR_THEME, type Palette } from '../../src/ui/themes.ts'

const KEYS: (keyof Palette)[] = ['background', 'foreground', 'card', 'muted', 'mutedForeground', 'border', 'accent', 'primary', 'primaryForeground', 'glow']
const COLOR = /^#[0-9a-f]{6}$/i
const GLOW = /^\d{1,3} \d{1,3} \d{1,3}$/

describe('color themes', () => {
  test('ids are unique and the default theme exists', () => {
    const ids = COLOR_THEMES.map(theme => theme.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(DEFAULT_COLOR_THEME)
  })

  test('every theme has a complete light and dark palette', () => {
    for (const theme of COLOR_THEMES) {
      for (const mode of ['light', 'dark'] as const) {
        for (const key of KEYS) {
          const value = theme[mode][key]
          if (key === 'glow') {
            expect(value).toMatch(GLOW)
          } else {
            expect(value).toMatch(COLOR)
          }
        }
      }
    }
  })

  test('appearanceVars returns every token for the chosen theme and mode', () => {
    const vars = appearanceVars('nord', 'dark', 'ink')
    expect(Object.keys(vars).sort()).toEqual(['--accent', '--background', '--border', '--card', '--foreground', '--glow', '--muted', '--muted-foreground', '--primary', '--primary-foreground'])
    expect(vars['--background']).toBe('#2e3440')
    expect(appearanceVars('nord', 'light', 'ink')['--background']).toBe('#eceff4')
  })

  test('an accent replaces only primary and glow', () => {
    const plain = appearanceVars('github', 'light', 'ink')
    const accented = appearanceVars('github', 'light', 'olive')
    expect(accented['--primary']).toBe('#3f4a3c')
    expect(accented['--glow']).toBe('96 125 88')
    expect(accented['--background']).toBe(plain['--background'])
    expect(accented['--border']).toBe(plain['--border'])
  })

  test('an unknown theme id falls back to the first theme', () => {
    expect(appearanceVars('missing', 'light', 'ink')).toEqual(appearanceVars(DEFAULT_COLOR_THEME, 'light', 'ink'))
  })
})
