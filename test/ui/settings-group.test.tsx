import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsGroup } from '../../src/ui/components/settings/SettingsGroup.tsx'
import type { SettingsContext } from '../../src/ui/components/settings/settings-rows.tsx'
import { groupsForView, type GroupOpenState, type GroupView } from '../../src/ui/settings/settings-search.ts'
import { DEFAULT_PREFERENCES } from '../../src/ui/preferences.ts'

const context: SettingsContext = {
  preferences: DEFAULT_PREFERENCES,
  onPreferences: () => {},
  away: false,
  onAwayToggle: () => {},
  push: { supported: true, subscribed: false, permission: 'default', iosHomeScreenRequired: false },
  pushBusy: false,
  onPushToggle: () => {},
}
const open: GroupOpenState = { appearance: true, chat: true, notifications: true }
const view = (group: 'appearance' | 'chat' | 'notifications', query = '', state: GroupOpenState = open): GroupView =>
  groupsForView(query, state).find(item => item.group === group)!

describe('SettingsGroup', () => {
  it('is expanded by default and shows its settings', () => {
    const html = renderToStaticMarkup(<SettingsGroup view={view('chat')} context={context} onToggle={() => {}} />)
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('data-setting="enter"')
    expect(html).toContain('data-setting="codeWrap"')
  })

  it('hides its settings when collapsed, and says so', () => {
    const html = renderToStaticMarkup(
      <SettingsGroup view={view('chat', '', { ...open, chat: false })} context={context} onToggle={() => {}} />,
    )
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('data-setting="enter"')
  })

  it('keeps its header sticky inside the scrolling body', () => {
    const html = renderToStaticMarkup(<SettingsGroup view={view('chat')} context={context} onToggle={() => {}} />)
    expect(html).toMatch(/<button[^>]*sticky top-0/)
  })

  it('is not a toggle while a search is active', () => {
    const html = renderToStaticMarkup(<SettingsGroup view={view('chat', 'enter')} context={context} onToggle={() => {}} />)
    expect(html).not.toContain('aria-expanded')
    expect(html).toContain('data-setting="enter"')
    expect(html).not.toContain('data-setting="codeWrap"')
  })
})

describe('SettingsGroup alignment', () => {
  it('insets the settings body by the same padding as the header, so rows line up with the icon tile', () => {
    const html = renderToStaticMarkup(<SettingsGroup view={view('chat')} context={context} onToggle={() => {}} />)
    const body = html.match(/<div id="settings-group-chat" class="([^"]*)"/)?.[1] ?? ''
    expect(body).toContain('px-3')
    expect(body).not.toContain('px-1')
  })
})
