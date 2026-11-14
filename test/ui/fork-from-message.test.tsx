import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat, Message } from '../../src/channel/web/protocol.ts'
import { MessageFeed } from '../../src/ui/components/message-feed.tsx'

const FORK_BUTTON = 'aria-label="Fork from this message"'
const JUMP_TO_POINT = 'aria-label="Go to fork point"'
const JUMP_TO_FORK = 'aria-label="Jump to fork"'

const chat = (overrides: Partial<Chat> = {}): Chat => ({
  id: 'c1',
  title: 'Original',
  project: 'api',
  cwd: '/home/u/Sites/api',
  status: 'active',
  spawned: true,
  archived: false,
  busy: false,
  unread: 0,
  lastMessage: null,
  draft: null,
  pinned: false,
  tmuxName: null,
  pendingPrompt: null,
  activity: null,
  forkedFrom: null,
  ...overrides,
})

/** An agent reply. `forkable` is what the server sends for a reply that came from a transcript. */
const reply = (id: string, seq: number, markdown: string, forkable: boolean): Message => ({
  id,
  chatId: 'c1',
  seq,
  at: 1_000 + seq,
  pinned: false,
  kind: 'agent_text',
  markdown,
  ...(forkable ? { forkable: true as const } : {}),
})

const messages: Message[] = [
  reply('m1', 1, 'Earlier reply', true),
  reply('m2', 2, 'Latest reply', true),
]

const forkedToRow: Message = {
  id: 'm3',
  chatId: 'c1',
  seq: 3,
  at: 1_003,
  pinned: false,
  kind: 'fork_link',
  direction: 'forked_to',
  otherChatId: 'c2',
  title: 'Fork of the plan',
  pointMessageId: 'm1',
}

function feed(options: { chat?: Chat; messages?: Message[] }): string {
  return renderToStaticMarkup(createElement(MessageFeed, {
    chat: options.chat ?? chat({ lastMessage: { seq: 2, at: 1_002, preview: 'Latest reply' } }),
    messages: options.messages ?? messages,
    hasMore: false,
    loadingEarlier: false,
    onLoadEarlier: () => {},
    onPromptAction: async () => {},
    onPromptReply: async () => {},
    onPickerAction: async () => {},
    onFork: () => {},
    onOpenChat: () => {},
  }))
}

test('Fork is offered on every forkable reply except the chat\'s last message, in any state', () => {
  const html = feed({})
  expect(html.split(FORK_BUTTON)).toHaveLength(2)
  expect(feed({ chat: chat({ busy: true, lastMessage: { seq: 2, at: 1_002, preview: 'Latest reply' } }) }).split(FORK_BUTTON)).toHaveLength(2)
})

test('a reply the server cannot fork gets no Fork button', () => {
  const html = feed({ messages: [reply('m1', 1, 'Bridge-written', false), reply('m2', 2, 'Latest', true)] })
  expect(html.split(FORK_BUTTON)).toHaveLength(1)
})

test('the original\'s feed shows no link row for its forks: the details panel lists them', () => {
  const html = feed({ messages: [...messages, forkedToRow] })
  expect(html).not.toContain('Forked to')
  expect(html).not.toContain('Fork of the plan')
  expect(html).not.toContain(JUMP_TO_FORK)
})

test('a forked chat\'s banner sits right after the reply it was forked from, not at the bottom', () => {
  const html = feed({
    chat: chat({
      forkedFrom: { chatId: 'c0', title: 'The plan', fromMessageId: 'm9', anchorMessageId: 'm1', anchorSeq: 1 },
      lastMessage: { seq: 2, at: 1_002, preview: 'Latest reply' },
    }),
  })
  expect(html).toContain('Forked from')
  expect(html).toContain('The plan')
  expect(html).toContain(JUMP_TO_POINT)
  expect(html.indexOf('Forked from')).toBeGreaterThan(html.indexOf('Earlier reply'))
  expect(html.indexOf('Forked from')).toBeLessThan(html.indexOf('Latest reply'))
})

test('the banner keeps its place after the fork point when a later turn follows it', () => {
  const html = feed({
    chat: chat({
      forkedFrom: { chatId: 'c0', title: 'The plan', fromMessageId: 'm9', anchorMessageId: 'm2', anchorSeq: 2 },
      lastMessage: { seq: 3, at: 1_003, preview: 'Newer turn' },
    }),
    messages: [reply('m1', 1, 'Copied history', true), reply('m2', 2, 'The fork point', true), reply('m3', 3, 'Newer turn', true)],
  })
  expect(html.indexOf('Forked from')).toBeGreaterThan(html.indexOf('The fork point'))
  expect(html.indexOf('Forked from')).toBeLessThan(html.indexOf('Newer turn'))
})

test('a fork point in an older page puts the banner at the top, and new turns do not pull it down', () => {
  const html = feed({
    chat: chat({
      forkedFrom: { chatId: 'c0', title: 'The plan', fromMessageId: 'm9', anchorMessageId: 'm0', anchorSeq: 1 },
      lastMessage: { seq: 3, at: 1_003, preview: 'Newer turn' },
    }),
    messages: [reply('m2', 2, 'First loaded reply', true), reply('m3', 3, 'Newer turn', true)],
  })
  expect(html.indexOf('Forked from')).toBeLessThan(html.indexOf('First loaded reply'))
})

test('a forked chat whose copied history is not recorded yet shows its banner at the bottom', () => {
  const html = feed({
    chat: chat({
      forkedFrom: { chatId: 'c0', title: 'The plan', fromMessageId: 'm9', anchorMessageId: null, anchorSeq: null },
      lastMessage: { seq: 2, at: 1_002, preview: 'Latest reply' },
    }),
  })
  expect(html.indexOf('Forked from')).toBeGreaterThan(html.indexOf('Latest reply'))
})
