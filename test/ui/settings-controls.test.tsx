import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingSegments, SettingSwitch } from '../../src/ui/components/settings/settings-controls.tsx'

describe('settings controls', () => {
  it('marks only the chosen segment as pressed and names the group', () => {
    const html = renderToStaticMarkup(
      <SettingSegments label="Density" value="compact" onChange={() => {}} options={[['compact', 'Compact'], ['comfortable', 'Comfortable']]} />,
    )
    expect(html).toContain('aria-label="Density"')
    expect(html).toMatch(/aria-pressed="true"[^>]*>Compact</)
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
  })

  it('renders a switch with its checked state', () => {
    const html = renderToStaticMarkup(<SettingSwitch label="Away mode" checked onChange={() => {}} />)
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('aria-label="Away mode"')
  })
})
