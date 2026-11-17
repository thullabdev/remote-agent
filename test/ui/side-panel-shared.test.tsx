import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Plus, TerminalIcon } from 'lucide-react'
import { SidePanelEmptyState } from '../../src/ui/components/side-panel/SidePanelEmptyState.tsx'
import { SidePanelHeader } from '../../src/ui/components/side-panel/SidePanelHeader.tsx'

describe('SidePanelHeader', () => {
  test('renders the title in an h2 with the shared font classes and the given id', () => {
    const markup = renderToStaticMarkup(<SidePanelHeader title="Terminal" titleId="side-terminal-title" />)
    expect(markup).toContain('<h2 id="side-terminal-title" class="min-w-0 flex-1 truncate font-display text-xl font-semibold tracking-tight">Terminal</h2>')
    expect(markup).toContain('class="flex h-14 shrink-0 items-center gap-2 px-3"')
  })

  test('passes padX through instead of the default', () => {
    expect(renderToStaticMarkup(<SidePanelHeader title="Terminal" padX="px-4" />)).toContain('px-4')
  })

  test('renders the actions after the title', () => {
    const markup = renderToStaticMarkup(<SidePanelHeader title="Git" actions={<button aria-label="Refresh">r</button>} />)
    expect(markup).toContain('aria-label="Refresh"')
    expect(markup.indexOf('Git')).toBeLessThan(markup.indexOf('aria-label="Refresh"'))
  })

  test('renders no actions when none are given', () => {
    expect(renderToStaticMarkup(<SidePanelHeader title="Git" />)).not.toContain('<button')
  })
})

describe('SidePanelEmptyState', () => {
  test('renders the title and description', () => {
    const markup = renderToStaticMarkup(<SidePanelEmptyState icon={TerminalIcon} title="No terminal sessions" description="Start a shell here." />)
    expect(markup).toContain('No terminal sessions')
    expect(markup).toContain('Start a shell here.')
    expect(markup).toContain('font-display text-xl font-semibold tracking-tight')
    expect(markup).not.toContain('<button')
  })

  test('renders the action with its icon only when one is given', () => {
    const markup = renderToStaticMarkup(
      <SidePanelEmptyState icon={TerminalIcon} title="No terminal sessions" description="Start a shell here." action={{ label: 'Start terminal', onClick: () => {}, icon: Plus }} />,
    )
    expect(markup).toContain('Start terminal')
    expect(markup).toContain('<button')
    expect(markup).toContain('mr-2 size-4')
  })

  test('renders an action without an icon when none is given', () => {
    const markup = renderToStaticMarkup(<SidePanelEmptyState icon={TerminalIcon} title="T" description="D" action={{ label: 'Try again', onClick: () => {} }} />)
    expect(markup).toContain('Try again')
    expect(markup).not.toContain('mr-2 size-4')
  })
})
