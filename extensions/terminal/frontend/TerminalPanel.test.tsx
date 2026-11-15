import { describe, it, expect, beforeEach } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { TerminalPanel } from './TerminalPanel.tsx'

describe('TerminalPanel', () => {
  beforeEach(() => {
    // xterm.js is initialized in useEffect; SSR renders the static structure only.
  })

  it('renders an empty state when no terminals are open', () => {
    const html = renderToStaticMarkup(
      <TerminalPanel terminals={[]} activeTerminalId={null} onBack={() => {}} onNew={() => {}} onClose={() => {}} />
    )
    expect(html).toContain('No terminal sessions')
    expect(html).toContain('Start terminal')
  })

  it('renders a tab per terminal', () => {
    const html = renderToStaticMarkup(
      <TerminalPanel
        terminals={[{ id: 'sid-1', cwd: '/tmp', login: 'user', connected: true }]}
        activeTerminalId="sid-1"
        onBack={() => {}}
        onNew={() => {}}
        onClose={() => {}}
      />
    )
    expect(html).toContain('sid-1')
    expect(html).toContain('/tmp')
    expect(html).toContain('user')
  })
})

describe('TerminalPanel navigation', () => {
  it('shows a back control that leads to chats', () => {
    const html = renderToStaticMarkup(
      <TerminalPanel
        terminals={[{ id: 'sid-1', cwd: '', login: '', connected: false }]}
        activeTerminalId="sid-1"
        onBack={() => {}}
        onNew={() => {}}
        onClose={() => {}}
      />
    )
    expect(html).toContain('aria-label="Back to chats"')
  })
})
