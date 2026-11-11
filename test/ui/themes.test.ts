import { describe, expect, test } from 'bun:test'
import { ACCENTS, appearanceVars, COLOR_THEMES, DEFAULT_COLOR_THEME, type Palette } from '../../src/ui/themes.ts'

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
    expect(Object.keys(vars).sort()).toEqual(['--accent', '--background', '--border', '--card', '--foreground', '--glow', '--muted', '--muted-foreground', '--primary', '--primary-foreground', '--status-needs', '--status-working'])
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


function luminance(hex: string): number {
  const channels = [1, 3, 5].map(index => {
    const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0)
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}

describe('status colors', () => {
  test('are independent of the accent, so Needs you never looks like the accent', () => {
    for (const mode of ['light', 'dark'] as const) {
      const reference = appearanceVars('default', mode, 'ink')
      for (const accent of ACCENTS) {
        expect(appearanceVars('default', mode, accent)['--status-needs']).toBe(reference['--status-needs'] as string)
        expect(appearanceVars('default', mode, accent)['--status-working']).toBe(reference['--status-working'] as string)
      }
      expect(reference['--status-needs']).not.toBe(reference['--status-working'])
    }
  })

  test('read at 4.5:1 or better on the background, card and muted fill of every theme and mode', () => {
    const failures: string[] = []
    for (const theme of COLOR_THEMES) {
      for (const mode of ['light', 'dark'] as const) {
        const vars = appearanceVars(theme.id, mode, 'ink')
        for (const token of ['--status-needs', '--status-working'] as const) {
          for (const surface of ['--background', '--card', '--muted'] as const) {
            const ratio = contrast(vars[token] as string, vars[surface] as string)
            if (ratio < 4.5) {
              failures.push(`${theme.id}/${mode} ${token} on ${surface}: ${ratio.toFixed(2)}`)
            }
          }
        }
      }
    }
    expect(failures).toEqual([])
  })
})

describe('text contrast', () => {
  test('body text and secondary text read at 4.5:1 or better on the background, card and muted fill of every theme and mode', () => {
    const failures: string[] = []
    for (const theme of COLOR_THEMES) {
      for (const mode of ['light', 'dark'] as const) {
        const palette = theme[mode]
        for (const text of ['foreground', 'mutedForeground'] as const) {
          for (const surface of ['background', 'card', 'muted'] as const) {
            const ratio = contrast(palette[text], palette[surface])
            if (ratio < 4.5) {
              failures.push(`${theme.id}/${mode} ${text} on ${surface}: ${ratio.toFixed(2)}`)
            }
          }
        }
      }
    }
    expect(failures).toEqual([])
  })
})
