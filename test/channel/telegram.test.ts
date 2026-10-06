import { describe, expect, test } from 'bun:test'
import { decodeButton, encodeButton, keyboard, MAX_MESSAGE, renderHtml } from '../../src/channel/telegram/render.ts'
import { isAuthorized, parseCommand, replyTarget, threadOf } from '../../src/channel/telegram/updates.ts'

describe('buttons', () => {
  test('round-trip', () => {
    const data = { promptId: 'q:toolu_01ABCDEFGHIJKLMNOPQRSTUV', questionIndex: 3, optionIndex: 2 }
    expect(decodeButton(encodeButton(data))).toEqual(data)
  })
  test('refuse callback data over 64 bytes', () => {
    expect(() => encodeButton({ promptId: 'x'.repeat(70), questionIndex: 0, optionIndex: 0 })).toThrow('64')
  })
  test('ignore foreign data', () => {
    expect(decodeButton('garbage')).toBeUndefined()
  })
  test('keyboard puts one button per row', () => {
    const markup = keyboard({ text: 'x', buttons: [{ label: 'A', data: { promptId: 'p', questionIndex: 0, optionIndex: 0 } }, { label: 'B', data: { promptId: 'p', questionIndex: 0, optionIndex: 1 } }] })
    expect(markup).toEqual({ inline_keyboard: [[{ text: 'A', callback_data: 'p|0|0' }], [{ text: 'B', callback_data: 'p|0|1' }]] })
  })
})

describe('renderHtml', () => {
  test('bolds the title and escapes the body', () => {
    expect(renderHtml('app · 1234', 'a < b')).toBe('<b>app · 1234</b>\na &lt; b')
  })
  test('stays under the limit even when escaping inflates the text', () => {
    const html = renderHtml('t', '<&>'.repeat(5_000))
    expect(html.length).toBeLessThanOrEqual(MAX_MESSAGE)
    expect(html).toContain('chars]')
  })
})

describe('updates', () => {
  const allowed = { chatId: -100, allowedUserId: 42 }
  test('only the configured chat and user are authorized', () => {
    expect(isAuthorized({ chatId: -100, userId: 42 }, allowed)).toBe(true)
    expect(isAuthorized({ chatId: -100, userId: 7 }, allowed)).toBe(false)
    expect(isAuthorized({ chatId: -999, userId: 42 }, allowed)).toBe(false)
    expect(isAuthorized({}, allowed)).toBe(false)
  })
  test('commands, with or without the bot suffix', () => {
    expect(parseCommand('/status')).toEqual({ name: 'status' })
    expect(parseCommand('/away@my_bot now')).toEqual({ name: 'away' })
    expect(parseCommand('hello /status')).toBeUndefined()
  })
  test('thread is the topic id only for topic messages', () => {
    expect(threadOf({ is_topic_message: true, message_thread_id: 77 })).toBe('77')
    expect(threadOf({ message_thread_id: 77 })).toBeNull()
  })
  test('a plain message in a topic is not a reply (Telegram marks it as a reply to the topic root)', () => {
    expect(replyTarget({ message_thread_id: 77, reply_to_message: { message_id: 77 } })).toBeNull()
    expect(replyTarget({ message_thread_id: 77, reply_to_message: { message_id: 90 } })).toBe('90')
    expect(replyTarget({})).toBeNull()
  })
})
