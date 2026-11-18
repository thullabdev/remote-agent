import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsView, type SettingsViewProps } from '../../src/ui/components/settings/SettingsView.tsx'
import { DEFAULT_PREFERENCES } from '../../src/ui/preferences.ts'

const base: SettingsViewProps = {
  group: 'chat',
  preferences: DEFAULT_PREFERENCES,
  onPreferences: () => {},
  away: false,
  onAwayToggle: () => {},
  push: { supported: false, subscribed: false, permission: 'unsupported', iosHomeScreenRequired: false },
  pushBusy: false,
  onPushToggle: () => {},
}

describe('SettingsView', () => {
  it('renders only the settings of its group', () => {
    const html = renderToStaticMarkup(<SettingsView {...base} />)
    expect(html).toContain('data-setting="enter"')
    expect(html).toContain('data-setting="codeWrap"')
    expect(html).not.toContain('data-setting="theme"')
    expect(html).toContain('<h2')
  })

  it('shows the Web Push explanation when the browser lacks it', () => {
    const html = renderToStaticMarkup(<SettingsView {...base} group="notifications" />)
    expect(html).toContain('does not support Web Push')
    expect(html).toMatch(/aria-label="Push notifications"|Push notifications/)
  })

  it('shows a back button only when given onBack', () => {
    expect(renderToStaticMarkup(<SettingsView {...base} />)).not.toContain('aria-label="Back to settings"')
    expect(renderToStaticMarkup(<SettingsView {...base} onBack={() => {}} />)).toContain('aria-label="Back to settings"')
  })
})
