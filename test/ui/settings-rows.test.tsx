import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SETTINGS } from '../../src/ui/settings/settings-registry.ts'
import { SettingRow, type SettingsContext } from '../../src/ui/components/settings/settings-rows.tsx'
import { DEFAULT_PREFERENCES } from '../../src/ui/preferences.ts'

const context: SettingsContext = {
  preferences: DEFAULT_PREFERENCES,
  onPreferences: () => {},
  away: false,
  onAwayToggle: () => {},
  push: { supported: false, subscribed: false, permission: 'unsupported', iosHomeScreenRequired: false },
  pushBusy: false,
  onPushToggle: () => {},
}

describe('SettingRow', () => {
  it('renders a row for every setting', () => {
    for (const setting of SETTINGS) {
      expect(renderToStaticMarkup(<SettingRow setting={setting} context={context} />)).toContain(`data-setting="${setting.id}"`)
    }
  })

  it('shows the Web Push explanation when the browser lacks it', () => {
    const push = SETTINGS.find(setting => setting.id === 'pushNotifications')!
    expect(renderToStaticMarkup(<SettingRow setting={push} context={context} />)).toContain('does not support Web Push')
  })

  it('wraps the accent swatches so they fit a 260px panel', () => {
    const accent = SETTINGS.find(setting => setting.id === 'accent')!
    expect(renderToStaticMarkup(<SettingRow setting={accent} context={context} />)).toContain('flex-wrap')
  })
})
