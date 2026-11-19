import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsSidePanel } from '../../src/ui/components/settings/SettingsSidePanel.tsx'
import type { SettingsContext } from '../../src/ui/components/settings/settings-rows.tsx'
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

describe('SettingsSidePanel', () => {
  it('shows every group expanded by default, with its settings', () => {
    const html = renderToStaticMarkup(<SettingsSidePanel context={context} />)
    expect(html).toContain('Appearance')
    expect(html).toContain('Notifications &amp; presence')
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(3)
    expect(html).toContain('data-setting="theme"')
    expect(html).toContain('data-setting="pushNotifications"')
  })

  it('keeps the search field and its header outside the scrolling body', () => {
    const html = renderToStaticMarkup(<SettingsSidePanel context={context} />)
    const headerEnd = html.indexOf('</header>')
    expect(headerEnd).toBeGreaterThan(-1)
    expect(html.indexOf('aria-label="Search settings"')).toBeLessThan(headerEnd)
    expect(html.indexOf('overflow-y-auto')).toBeGreaterThan(headerEnd)
  })

  it('shows only the matching settings while searching', () => {
    const html = renderToStaticMarkup(<SettingsSidePanel context={context} initialQuery="accent" />)
    expect(html).toContain('data-setting="accent"')
    expect(html).not.toContain('data-setting="theme"')
    expect(html).not.toContain('Notifications &amp; presence')
  })

  it('shows the clear button only while there is a query', () => {
    expect(renderToStaticMarkup(<SettingsSidePanel context={context} initialQuery="accent" />)).toContain('aria-label="Clear search"')
    expect(renderToStaticMarkup(<SettingsSidePanel context={context} />)).not.toContain('aria-label="Clear search"')
  })

  it('says so when nothing matches', () => {
    const html = renderToStaticMarkup(<SettingsSidePanel context={context} initialQuery="zebra" />)
    expect(html).toContain('No settings match')
    expect(html).toContain('zebra')
  })
})
