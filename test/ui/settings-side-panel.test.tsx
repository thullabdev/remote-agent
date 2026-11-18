import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsSidePanel } from '../../src/ui/components/settings/SettingsSidePanel.tsx'

describe('SettingsSidePanel', () => {
  it('lists the three groups with a search field', () => {
    const html = renderToStaticMarkup(<SettingsSidePanel onOpen={() => {}} />)
    expect(html).toContain('aria-label="Search settings"')
    expect(html).toContain('Appearance')
    expect(html).toContain('Chat')
    expect(html).toContain('Notifications &amp; presence')
  })

  it('shows the matching settings in place of the groups when a query is given', () => {
    const html = renderToStaticMarkup(<SettingsSidePanel onOpen={() => {}} initialQuery="accent" />)
    expect(html).toContain('Accent')
    expect(html).not.toContain('Notifications &amp; presence')
  })

  it('says so when nothing matches', () => {
    const html = renderToStaticMarkup(<SettingsSidePanel onOpen={() => {}} initialQuery="zebra" />)
    expect(html).toContain('No settings match')
    expect(html).toContain('zebra')
  })
})
