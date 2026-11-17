import { describe, it, expect } from 'bun:test'
import type { Chat } from '../../../src/channel/web/protocol.ts'
import { chatFolder } from './actions.ts'

const chat = (fields: Partial<Chat>) => ({ id: 'c1', title: 'T', ...fields }) as unknown as Chat

describe('chatFolder', () => {
  it('is the chat launch folder', () => {
    expect(chatFolder(chat({ launchCwd: '/work/api', cwd: '/elsewhere' }))).toBe('/work/api')
  })

  it('falls back to the chat folder, and is undefined when the chat has none or there is no chat', () => {
    expect(chatFolder(chat({ cwd: '/work/web' }))).toBe('/work/web')
    expect(chatFolder(chat({}))).toBeUndefined()
    expect(chatFolder(null)).toBeUndefined()
  })
})
