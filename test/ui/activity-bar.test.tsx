import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ActivityBar, type ActivityTab } from '../../src/ui/components/side-panel/ActivityBar.tsx'

const Icon = () => null
const tabs: ActivityTab[] = [
  { id: 'chats', title: 'Chats', icon: Icon },
  { id: 'terminal', title: 'Terminals', icon: Icon },
]

describe('ActivityBar', () => {
  it('renders one labelled button per tab', () => {
    const html = renderToStaticMarkup(<ActivityBar tabs={tabs} selected="chats" onSelect={() => {}} />)

    expect(html).toContain('aria-label="Chats"')
    expect(html).toContain('aria-label="Terminals"')
    expect(html.match(/<button/g)).toHaveLength(2)
  })

  it('marks only the selected tab as pressed', () => {
    const html = renderToStaticMarkup(<ActivityBar tabs={tabs} selected="terminal" onSelect={() => {}} />)

    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-label="Terminals"[^>]*aria-pressed="true"/)
  })

  it('is a labelled navigation landmark that takes the caller’s layout classes', () => {
    const html = renderToStaticMarkup(<ActivityBar tabs={tabs} selected="chats" onSelect={() => {}} className="hidden md:flex" />)

    expect(html).toContain('<nav aria-label="Side panel tabs"')
    expect(html).toContain('hidden md:flex')
  })
})
