import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat } from '../../src/channel/web/protocol.ts'
import { ChatComposer, shouldSendOnEnter } from '../../src/ui/components/chat-composer.tsx'

const chat: Chat = {
  id: 'test',
  title: 'Test',
  project: null,
  cwd: null,
  status: 'active',
  spawned: false,
  archived: false,
  busy: false,
  unread: 0,
  lastMessage: null,
  pinned: false,
  tmuxName: null,
}

describe('chat composer surface', () => {
  test('preserves the rounded input wrapper without a focus border or ring', () => {
    const markup = renderToStaticMarkup(createElement(ChatComposer, {
      chat,
      usage: { accounts: [], chats: {} },
      sending: false,
      enterSends: true,
      library: [],
      onRefreshLibrary: () => {},
      onUpload: async () => null,
      onDeleteUpload: () => {},
      onSend: async () => {},
      onResume: async () => {},
    }))

    expect(markup).toContain('chat-composer-dock')
    expect(markup).toContain('rounded-3xl border border-border bg-card')
    expect(markup).toContain('chat-composer-input')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('id="chat-usage-panel"')
    expect(markup).not.toContain('focus-within:ring')
    expect(markup).not.toContain('focus-within:border')
  })
})

describe('Enter key preference', () => {
  const key = (overrides: Partial<{ key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; isComposing: boolean }> = {}) => ({
    key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, ...overrides,
  })

  test('Enter sends and Shift+Enter adds a line when Enter sends', () => {
    expect(shouldSendOnEnter(key(), true)).toBe(true)
    expect(shouldSendOnEnter(key({ shiftKey: true }), true)).toBe(false)
  })

  test('Enter adds a line and Ctrl/Cmd+Enter sends when Enter does not send', () => {
    expect(shouldSendOnEnter(key(), false)).toBe(false)
    expect(shouldSendOnEnter(key({ ctrlKey: true }), false)).toBe(true)
    expect(shouldSendOnEnter(key({ metaKey: true }), false)).toBe(true)
  })

  test('other keys and IME composition never send', () => {
    expect(shouldSendOnEnter(key({ key: 'a' }), true)).toBe(false)
    expect(shouldSendOnEnter(key({ isComposing: true }), true)).toBe(false)
    expect(shouldSendOnEnter(key({ isComposing: true, ctrlKey: true }), false)).toBe(false)
  })
})
