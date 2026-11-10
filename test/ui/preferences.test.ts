import { describe, expect, test } from 'bun:test'
import { DEFAULT_PREFERENCES, readPreferences, resolvedTheme, savePreferences, type Preferences } from '../../src/ui/preferences.ts'

function createStorage(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value) },
  }
}

describe('device appearance preferences', () => {
  test('uses defaults when storage is empty or malformed', () => {
    expect(readPreferences(createStorage())).toEqual(DEFAULT_PREFERENCES)
    expect(readPreferences(createStorage({ 'remote-agent.preferences.v1': '{bad json' }))).toEqual(DEFAULT_PREFERENCES)
  })

  test('persists and restores valid choices while ignoring unknown values', () => {
    const storage = createStorage()
    const saved: Preferences = { theme: 'dark', palette: 'nord', accent: 'teal', glow: 'strong', density: 'compact', font: 'large', enter: 'newline', codeWrap: 'wrap', generalView: 'chat' }
    savePreferences(saved, storage)
    expect(readPreferences(storage)).toEqual(saved)

    const invalid = createStorage({ 'remote-agent.preferences.v1': JSON.stringify({ theme: 'neon', palette: 'hotdog', accent: 'olive' }) })
    expect(readPreferences(invalid)).toEqual({ ...DEFAULT_PREFERENCES, accent: 'olive' })
    expect(readPreferences(createStorage({ 'remote-agent.preferences.v1': JSON.stringify({ enter: 'maybe' }) })).enter).toBe('newline')
    expect(readPreferences(createStorage({ 'remote-agent.preferences.v1': JSON.stringify({ codeWrap: 'sideways' }) })).codeWrap).toBe('scroll')
    expect(readPreferences(createStorage({ 'remote-agent.preferences.v1': JSON.stringify({ theme: 'dark' }) })).codeWrap).toBe('scroll')
  })

  test('General opens to the dashboard unless the chat was chosen', () => {
    expect(DEFAULT_PREFERENCES.generalView).toBe('dashboard')
    expect(readPreferences(createStorage({ 'remote-agent.preferences.v1': JSON.stringify({ generalView: 'chat' }) })).generalView).toBe('chat')
    expect(readPreferences(createStorage({ 'remote-agent.preferences.v1': JSON.stringify({ generalView: 'tiles' }) })).generalView).toBe('dashboard')
  })

  test('resolves system appearance without changing the saved preference', () => {
    expect(resolvedTheme('system', true)).toBe('dark')
    expect(resolvedTheme('system', false)).toBe('light')
    expect(resolvedTheme('light', true)).toBe('light')
  })
})
