import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat } from '../../src/channel/web/protocol.ts'
import { ChatComposer } from '../../src/ui/components/chat-composer.tsx'

const chat: Chat = {
  id: 'test',
  title: 'Test',
  project: null,
  cwd: null,
  status: 'active',
  spawned: false,
  busy: false,
  unread: 0,
  lastMessage: null,
  pinned: false,
  tmuxName: null,
}

describe('chat composer surface', () => {
  test('keeps the composer transparent and removes the focused border/ring', () => {
    const markup = renderToStaticMarkup(createElement(ChatComposer, {
      chat,
      sending: false,
      onSend: async () => {},
      onResume: async () => {},
    }))

    expect(markup).not.toContain('bg-card')
    expect(markup).not.toContain('border-border')
    expect(markup).not.toContain('focus-within:ring')
    expect(markup).not.toContain('focus-within:border')
  })
})
