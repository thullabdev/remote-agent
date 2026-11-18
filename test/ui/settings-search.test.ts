import { describe, expect, it } from 'bun:test'
import { SETTINGS, SETTING_GROUPS, settingsIn } from '../../src/ui/settings/settings-registry.ts'
import { searchSettings } from '../../src/ui/settings/settings-search.ts'

describe('settings registry', () => {
  it('gives every setting a known group and a unique id', () => {
    const groups = new Set(SETTING_GROUPS.map(group => group.id))
    const ids = SETTINGS.map(setting => setting.id)
    expect(SETTINGS.every(setting => groups.has(setting.group))).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('lists the groups in order with their titles', () => {
    expect(SETTING_GROUPS.map(group => group.title)).toEqual(['Appearance', 'Chat', 'Notifications & presence'])
    expect(settingsIn('chat').map(setting => setting.id)).toEqual(['enter', 'codeWrap'])
  })
})

describe('searchSettings', () => {
  it('returns nothing for a blank query', () => {
    expect(searchSettings('')).toEqual([])
    expect(searchSettings('   ')).toEqual([])
  })

  it('matches titles, descriptions and keywords, ignoring case', () => {
    expect(searchSettings('ACCENT').map(setting => setting.id)).toContain('accent')
    expect(searchSettings('system').map(setting => setting.id)).toContain('theme')
    expect(searchSettings('web push').map(setting => setting.id)).toEqual(['pushNotifications'])
  })

  it('requires every word of the query to match', () => {
    expect(searchSettings('font size').map(setting => setting.id)).toEqual(['fontSize'])
    expect(searchSettings('font zebra')).toEqual([])
  })

  it('treats regex characters as plain text', () => {
    expect(() => searchSettings('(')).not.toThrow()
    expect(searchSettings('*')).toEqual([])
  })
})
