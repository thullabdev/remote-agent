import { describe, it, expect, beforeEach } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ExtensionRegistry, registerPanel, clearPanelsForTesting } from '../../src/ui/components/extension-registry.tsx'
import type { PanelContext } from '../../src/ui/extension-slots.ts'

const context: PanelContext = {
  params: {},
  openPanel: () => {},
  closePanel: () => {},
  notify: () => {},
  density: 'comfortable',
}

describe('ExtensionRegistry', () => {
  beforeEach(() => {
    clearPanelsForTesting()
  })

  it('renders the active panel and not inactive panels', () => {
    const PanelA = () => <div data-testid="panel-a">Panel A</div>
    const PanelB = () => <div data-testid="panel-b">Panel B</div>
    registerPanel('a', PanelA, 'Panel A')
    registerPanel('b', PanelB, 'Panel B')

    const html = renderToStaticMarkup(<ExtensionRegistry panel={{ id: 'a', params: {} }} context={context} />)
    expect(html).toContain('Panel A')
    expect(html).not.toContain('Panel B')
  })

  it('passes the panel its parameters and navigation', () => {
    const seen: Array<Record<string, string>> = []
    const Panel = (props: PanelContext) => {
      seen.push(props.params)
      return <div>Panel</div>
    }
    registerPanel('a', Panel, 'Panel A')
    renderToStaticMarkup(<ExtensionRegistry panel={{ id: 'a', params: { sid: 'x' } }} context={{ ...context, params: { sid: 'x' } }} />)
    expect(seen).toEqual([{ sid: 'x' }])
  })

  it('renders nothing when no panel is active or the panel is not registered', () => {
    expect(renderToStaticMarkup(<ExtensionRegistry panel={null} context={context} />)).toBe('')
    expect(renderToStaticMarkup(<ExtensionRegistry panel={{ id: 'missing', params: {} }} context={context} />)).toBe('')
  })
})
