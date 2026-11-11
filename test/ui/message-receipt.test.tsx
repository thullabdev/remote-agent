import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat, Message } from '../../src/channel/web/protocol.ts'
import { MessageFeed } from '../../src/ui/components/message-feed.tsx'

const chat: Chat = {
  id: 'c1', title: 'api', project: 'api', cwd: '/w/api', status: 'active', spawned: true, archived: false, busy: false, unread: 0,
  lastMessage: null, draft: null, pinned: false, tmuxName: 'ra-1', pendingPrompt: null, activity: null,
}

const sent = (status: 'queued' | 'delivered' | 'not_received'): Message => ({
  id: 'm1', chatId: 'c1', seq: 1, at: Date.now(), pinned: false, kind: 'user_text', text: 'Continue', status, instructionId: 'i1', attachments: [],
})

function feed(message: Message, onResend?: (message: Message) => void): string {
  return renderToStaticMarkup(
    createElement(MessageFeed, {
      chat, messages: [message], hasMore: false, loadingEarlier: false, onLoadEarlier: () => {},
      onPromptAction: async () => {}, onPromptReply: async () => {}, onPickerAction: async () => {}, onResend,
    }),
  )
}

test('a message Claude did not pick up says so and offers to send it again', () => {
  const html = feed(sent('not_received'), () => {})
  expect(html).toContain('Not received by Claude')
  expect(html).toContain('Send again')
})

test('a delivered message shows no receipt warning, and no resend without a handler', () => {
  expect(feed(sent('delivered'), () => {})).not.toContain('Not received')
  expect(feed(sent('not_received'))).not.toContain('Send again')
})
