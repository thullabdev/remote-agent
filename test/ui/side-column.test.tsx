import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SideColumn } from '../../src/ui/components/side-panel/SideColumn.tsx'

const Icon = () => null
const tabs = [
  { id: 'chats', title: 'Chats', icon: Icon },
  { id: 'terminal', title: 'Terminals', icon: Icon },
]

describe('SideColumn', () => {
  it('shows the panel content and the tab strip twice: a side strip on desktop and a bottom bar on phones', () => {
    const html = renderToStaticMarkup(
      <SideColumn shown tabs={tabs} selected="chats" onSelect={() => {}}>
        <span>panel body</span>
      </SideColumn>,
    )

    expect(html).toContain('panel body')
    expect(html.match(/<nav aria-label="Side panel tabs"/g)).toHaveLength(2)
    expect(html.match(/<button/g)).toHaveLength(4)
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2)
  })

  it('slides off screen on the narrow layout when shown is false', () => {
    const hidden = renderToStaticMarkup(
      <SideColumn shown={false} tabs={tabs} selected="chats" onSelect={() => {}}>
        <span>panel body</span>
      </SideColumn>,
    )

    expect(hidden).toContain('-translate-x-full')
  })
})
