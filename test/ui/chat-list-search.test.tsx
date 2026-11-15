import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatList } from '../../src/ui/components/chat-list.tsx'

const noop = () => {}
const props = {
  chats: [],
  activeId: null,
  status: 'connected' as const,
  onOpen: noop,
  onNew: noop,
  onSettings: noop,
  onArchiveSelected: async () => {},
  onPinSelected: async () => {},
  onActionError: noop,
}

function render(initialQuery: string): string {
  return renderToStaticMarkup(createElement(ChatList, { ...props, initialQuery }))
}

test('the search field shows a clear button only while it has text', () => {
  expect(render('billing')).toContain('aria-label="Clear search"')
  expect(render('')).not.toContain('aria-label="Clear search"')
})
