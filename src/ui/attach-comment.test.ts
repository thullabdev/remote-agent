import { describe, expect, test } from 'bun:test'
import { attachCommentToChat, type CommentToAttach } from './attach-comment.ts'
import { setChatOpener, subscribeBundles } from './composer-bus.ts'
import type { CommentBundle } from './comment-bundle.ts'

const card: CommentToAttach = {
  chatId: 'api-chat',
  kind: 'quote',
  title: 'Quote · Bash result',
  markdown: '> ls output\n\nlooks wrong',
  count: 1,
  files: [],
}

describe('attachCommentToChat', () => {
  test('a mounted composer receives the card with the host id and time filled in', () => {
    const received: CommentBundle[] = []
    const unsubscribe = subscribeBundles('api-chat', bundle => received.push(bundle))
    expect(attachCommentToChat(card)).toBe('delivered')
    expect(received).toHaveLength(1)
    const [sent] = received
    expect(sent?.kind).toBe('quote')
    expect(sent?.title).toBe('Quote · Bash result')
    expect(sent?.markdown).toBe('> ls output\n\nlooks wrong')
    expect(sent?.count).toBe(1)
    expect(sent?.id.length).toBeGreaterThan(0)
    expect(typeof sent?.createdAt).toBe('number')
    unsubscribe()
  })

  test('when no composer is mounted the card is queued and the chat is brought into view', () => {
    const opened: string[] = []
    const restore = setChatOpener(chatId => opened.push(chatId))
    expect(attachCommentToChat({ ...card, chatId: 'api-closed' })).toBe('queued')
    expect(opened).toEqual(['api-closed'])
    restore()
  })
})
