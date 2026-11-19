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

import { groupsForView, type GroupOpenState } from '../../src/ui/settings/settings-search.ts'

const allOpen: GroupOpenState = { appearance: true, chat: true, notifications: true }

describe('groupsForView', () => {
  it('shows every group with all its settings when nothing is searched', () => {
    const views = groupsForView('', allOpen)
    expect(views.map(view => view.group)).toEqual(['appearance', 'chat', 'notifications'])
    expect(views[1]!.settings.map(setting => setting.id)).toEqual(['enter', 'codeWrap'])
    expect(views.every(view => view.searching === false)).toBe(true)
  })

  it('keeps a collapsed group collapsed when nothing is searched', () => {
    const views = groupsForView('', { ...allOpen, chat: false })
    expect(views.find(view => view.group === 'chat')!.open).toBe(false)
  })

  it('shows only matching settings, in their groups, expanded while searching', () => {
    const views = groupsForView('accent', { ...allOpen, appearance: false })
    expect(views.map(view => view.group)).toEqual(['appearance'])
    expect(views[0]!.settings.map(setting => setting.id)).toEqual(['accent', 'glow'])
    expect(views[0]!.searching).toBe(true)
    expect(views[0]!.open).toBe(true)
  })

  it('hides groups with no match', () => {
    const views = groupsForView('web push', allOpen)
    expect(views.map(view => view.group)).toEqual(['notifications'])
  })

  it('returns the group collapsed again once the search is cleared', () => {
    const collapsed: GroupOpenState = { ...allOpen, chat: false }
    expect(groupsForView('enter', collapsed).find(view => view.group === 'chat')!.open).toBe(true)
    expect(groupsForView('', collapsed).find(view => view.group === 'chat')!.open).toBe(false)
  })

  it('returns no groups for a query that matches nothing', () => {
    expect(groupsForView('zebra', allOpen)).toEqual([])
  })

  it('treats regex characters as plain text', () => {
    expect(() => groupsForView('(', allOpen)).not.toThrow()
    expect(groupsForView('*', allOpen)).toEqual([])
  })
})
