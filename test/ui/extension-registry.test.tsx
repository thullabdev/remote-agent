import { describe, it, expect, beforeEach } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ExtensionRegistry, registerPanel, clearPanelsForTesting } from '../../src/ui/components/extension-registry.tsx'

describe('ExtensionRegistry', () => {
  beforeEach(() => {
    clearPanelsForTesting()
  })

  it('renders the active panel and not inactive panels', () => {
    const PanelA = () => <div data-testid="panel-a">Panel A</div>
    const PanelB = () => <div data-testid="panel-b">Panel B</div>
    registerPanel('a', PanelA, 'Panel A')
    registerPanel('b', PanelB, 'Panel B')

    const html = renderToStaticMarkup(
      <ExtensionRegistry activePanelId="a" onClose={() => {}} />
    )
    expect(html).toContain('Panel A')
    expect(html).not.toContain('Panel B')
  })

  it('renders a single panel without crashing', () => {
    const Panel = () => <div>Panel</div>
    registerPanel('a', Panel, 'Panel A')
    const html = renderToStaticMarkup(
      <ExtensionRegistry activePanelId="a" onClose={() => {}} />
    )
    expect(html).toContain('Panel')
  })
})
