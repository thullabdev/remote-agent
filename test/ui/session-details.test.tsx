import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat } from '../../src/channel/web/protocol.ts'
import { SessionDetails } from '../../src/ui/components/details/SessionDetails.tsx'
import { clearSlotsForTesting, registerChatInfoSection } from '../../src/ui/extension-slots.ts'

const chat: Chat = {
  id: 'c1', title: 'Billing fix', project: 'api', cwd: '/home/u/api', status: 'active', spawned: false, archived: false,
  busy: false, unread: 0, lastMessage: null, draft: null, pinned: false, tmuxName: null, pendingPrompt: null, activity: null,
}

function render(): string {
  return renderToStaticMarkup(createElement(SessionDetails, {
    chat,
    forks: [],
    pins: [],
    openPanel: () => {},
    density: 'comfortable',
    onNotify: () => {},
    onEnd: async () => {},
    onArchive: async () => {},
    onUnarchive: async () => {},
    onRename: async () => {},
    onPin: async () => {},
    onClear: async () => {},
    onFork: async () => {},
    onResume: async () => {},
    onUnpin: async () => {},
    onJump: () => {},
  }))
}

/** The `aria-expanded` value of the button whose text contains `label`, or undefined when there is no such button. */
function expandedOf(html: string, label: string): string | undefined {
  const pattern = new RegExp(
    `<button[^>]*aria-expanded="(true|false)"[^>]*>(?:(?!</button>)[\\s\\S])*${label}(?:(?!</button>)[\\s\\S])*</button>`,
  )
  return pattern.exec(html)?.[1]
}

/** Makes the accordion state storage report the given ids as open, as localStorage would after a previous visit. */
function rememberOpen(ids: string[]) {
  const stored = JSON.stringify(Object.fromEntries(ids.map(id => [id, true])))
  Object.assign(globalThis, {
    window: { localStorage: { getItem: () => stored, setItem: () => {} } },
  })
}

beforeEach(() => clearSlotsForTesting())
afterEach(() => {
  clearSlotsForTesting()
  delete (globalThis as { window?: unknown }).window
})

test('each registered chat-info section renders as a closed accordion titled by the section', () => {
  registerChatInfoSection('changes', 'File changes', () => <p>changed files here</p>)

  const html = render()

  expect(expandedOf(html, 'File changes')).toBe('false')
  expect(html).not.toContain('changed files here')
})

test('a registered chat-info section shows its content once its accordion is open', () => {
  registerChatInfoSection('changes', 'File changes', () => <p>changed files here</p>)
  rememberOpen(['ext:changes'])

  const html = render()

  expect(html).toContain('changed files here')
  expect(expandedOf(html, 'File changes')).toBe('true')
})

test('the host sections are accordions too, so Bookmarks, Forks and Technical are buttons with aria-expanded', () => {
  const html = render()

  expect(expandedOf(html, 'Bookmarks · 0')).toBe('false')
  expect(expandedOf(html, 'Forks · 0')).toBe('false')
  expect(expandedOf(html, 'Technical')).toBe('false')
})
