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
    expect(renderToStaticMarkup(<SettingsView {...base} />)).not.toContain('aria-label="Back"')
    expect(renderToStaticMarkup(<SettingsView {...base} onBack={() => {}} />)).toContain('aria-label="Back"')
  })
})

describe('SettingsView header', () => {
  it('keeps the header outside the scrolling content', () => {
    const html = renderToStaticMarkup(<SettingsView {...base} onBack={() => {}} />)
    const headerEnd = html.indexOf('</header>')
    expect(headerEnd).toBeGreaterThan(-1)
    expect(html.indexOf('overflow-y-auto')).toBeGreaterThan(headerEnd)
  })

  it('shows the back button at every width, like the chat header does on phones', () => {
    const html = renderToStaticMarkup(<SettingsView {...base} onBack={() => {}} />)
    const button = html.match(/<button[^>]*aria-label="Back"[^>]*>/)?.[0] ?? ''
    expect(button).not.toBe('')
    expect(button).not.toContain('md:hidden')
  })

  it('titles the header with the group name and its description', () => {
    const html = renderToStaticMarkup(<SettingsView {...base} group="chat" onBack={() => {}} />)
    expect(html).toContain('<h2')
    expect(html).toContain('How messages are sent and shown')
  })
})
