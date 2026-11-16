import { describe, it, expect, beforeEach } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SideTabContext } from '../../../src/ui/extension-slots.ts'
import { TerminalsSideTab } from './TerminalPanel.tsx'
import { resetSessionsForTesting, selectTerminal, type TerminalSession } from './store.ts'

const context: SideTabContext = { activeChat: null, openPanel: () => {}, notify: () => {}, density: 'comfortable' }

function term(id: string, cwd: string, command: string | null = 'zsh'): TerminalSession {
  return { id, cwd, login: '', connected: false, createdAt: 1, command }
}

function render(): string {
  return renderToStaticMarkup(<TerminalsSideTab {...context} />)
}

describe('terminal side tab', () => {
  beforeEach(() => {
    resetSessionsForTesting()
  })

  it('titles the header Terminal and shows the add button', () => {
    const html = render()
    expect(html).toContain('>Terminal<')
    expect(html).toContain('aria-label="New terminal"')
  })

  it('shows an empty state with a start button when no shell is open', () => {
    const html = render()
    expect(html).toContain('No terminal sessions')
    expect(html).toContain('Start terminal')
    expect(html).not.toContain('role="tab"')
  })

  it('hides the tab pills when only one shell is open', () => {
    resetSessionsForTesting([term('sid-1', '/work/api')])
    expect(render()).not.toContain('role="tab"')
  })

  it('shows a pill per shell, labelled with the folder and the foreground command, once there are two', () => {
    resetSessionsForTesting([term('sid-1', '/work/api', 'vim'), term('sid-2', '/work/web', 'zsh')])
    const html = render()

    expect(html.match(/role="tab"/g)).toHaveLength(2)
    expect(html).toContain('title="api • vim · /work/api"')
    expect(html).toContain('>api<')
    expect(html).toContain('vim')
    expect(html).toContain('web • zsh')
  })

  it('marks the chosen shell as selected', () => {
    resetSessionsForTesting([term('sid-1', '/work/api'), term('sid-2', '/work/web')])
    selectTerminal('sid-2')
    const html = render()

    expect(html).toMatch(/aria-selected="true"[^>]*title="web • zsh · \/work\/web"/)
  })
})
