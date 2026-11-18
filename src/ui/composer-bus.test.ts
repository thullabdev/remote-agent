import { describe, expect, test } from 'bun:test'
import type { UploadRef } from '../channel/web/protocol.ts'
import { attachToComposer, subscribeComposer } from './composer-bus.ts'

const ref: UploadRef = { id: 'u1', name: 'notes.md', mime: 'text/markdown', size: 10 }

describe('composer bus', () => {
  test('attach with no listener returns false', () => {
    expect(attachToComposer('chat-empty', ref)).toBe(false)
  })

  test('attach delivers only to the listener for that chat', () => {
    const received: string[] = []
    const unsubA = subscribeComposer('chat-a', next => received.push(`a:${next.id}`))
    const unsubB = subscribeComposer('chat-b', next => received.push(`b:${next.id}`))
    expect(attachToComposer('chat-a', ref)).toBe(true)
    expect(received).toEqual(['a:u1'])
    unsubA()
    unsubB()
  })

  test('unsubscribe stops delivery', () => {
    const received: UploadRef[] = []
    const unsubscribe = subscribeComposer('chat-c', next => received.push(next))
    unsubscribe()
    expect(attachToComposer('chat-c', ref)).toBe(false)
    expect(received).toEqual([])
  })

  test('several listeners for one chat all receive, and removing one keeps the rest', () => {
    const first: string[] = []
    const second: string[] = []
    const unsubFirst = subscribeComposer('chat-d', next => first.push(next.id))
    const unsubSecond = subscribeComposer('chat-d', next => second.push(next.id))
    expect(attachToComposer('chat-d', ref)).toBe(true)
    unsubFirst()
    expect(attachToComposer('chat-d', { ...ref, id: 'u2' })).toBe(true)
    expect(first).toEqual(['u1'])
    expect(second).toEqual(['u1', 'u2'])
    unsubSecond()
    expect(attachToComposer('chat-d', ref)).toBe(false)
  })

  test('an attachment handed over before the composer mounts is delivered when it mounts', () => {
    expect(attachToComposer('chat-late', ref)).toBe(false)
    const received: string[] = []
    const unsubscribe = subscribeComposer('chat-late', next => received.push(next.id))
    expect(received).toEqual(['u1'])
    unsubscribe()
  })
})
