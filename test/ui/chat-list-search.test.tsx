import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SidePanel } from '../../src/ui/components/side-panel/SidePanel.tsx'

const noop = () => {}
const props = {
  chats: [],
  activeId: null,
  status: 'connected' as const,
  onOpen: noop,
  onNew: noop,
  onArchiveSelected: async () => {},
  onPinSelected: async () => {},
  onActionError: noop,
}

function render(initialQuery: string): string {
  return renderToStaticMarkup(createElement(SidePanel, { ...props, initialQuery }))
}

test('the search field shows a clear button only while it has text', () => {
  expect(render('billing')).toContain('aria-label="Clear search"')
  expect(render('')).not.toContain('aria-label="Clear search"')
})

test('the chat header has no gear button; settings live in their own tab', () => {
  expect(render('')).not.toContain('aria-label="Settings"')
})
