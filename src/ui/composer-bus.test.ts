import { describe, expect, test } from 'bun:test'
import type { UploadRef } from '../channel/web/protocol.ts'
import type { CommentBundle } from './comment-bundle.ts'
import { attachCommentsToComposer, attachToComposer, subscribeBundles, subscribeComposer } from './composer-bus.ts'

const ref: UploadRef = { id: 'u1', name: 'notes.md', mime: 'text/markdown', size: 10 }

describe('composer bus', () => {
  test('attach with no composer mounted is queued', () => {
    expect(attachToComposer('chat-empty', ref)).toBe('queued')
  })

  test('attach delivers only to the composer for that chat', () => {
    const received: string[] = []
    const unsubA = subscribeComposer('chat-a', next => {
      received.push(`a:${next.id}`)
      return true
    })
    const unsubB = subscribeComposer('chat-b', next => {
      received.push(`b:${next.id}`)
      return true
    })
    expect(attachToComposer('chat-a', ref)).toBe('delivered')
    expect(received).toEqual(['a:u1'])
    unsubA()
    unsubB()
  })

  test('a full composer refuses the attachment', () => {
    const unsubscribe = subscribeComposer('chat-full', () => false)
    expect(attachToComposer('chat-full', ref)).toBe('full')
    unsubscribe()
  })

  test('unsubscribe stops delivery', () => {
    const received: UploadRef[] = []
    const unsubscribe = subscribeComposer('chat-c', next => {
      received.push(next)
      return true
    })
    unsubscribe()
    expect(attachToComposer('chat-c', ref)).toBe('queued')
    expect(received).toEqual([])
  })

  test('an attachment handed over before the composer mounts is delivered when it mounts', () => {
    expect(attachToComposer('chat-late', ref)).toBe('queued')
    const received: string[] = []
    const unsubscribe = subscribeComposer('chat-late', next => {
      received.push(next.id)
      return true
    })
    expect(received).toEqual(['u1'])
    unsubscribe()
  })

  describe('comment bundles', () => {
    const bundle: CommentBundle = { id: 'bundle-1', markdown: '# Review comments\n', count: 1, files: ['src/a.ts'], createdAt: 1 }

    test('a bundle with no composer mounted is queued', () => {
      expect(attachCommentsToComposer('bundle-empty', bundle)).toBe('queued')
    })

    test('a bundle is delivered only to the composer for its chat', () => {
      const received: string[] = []
      const unsubA = subscribeBundles('bundle-chat-a', next => {
        received.push(`a:${next.id}`)
      })
      const unsubB = subscribeBundles('bundle-chat-b', next => {
        received.push(`b:${next.id}`)
      })
      expect(attachCommentsToComposer('bundle-chat-a', bundle)).toBe('delivered')
      expect(received).toEqual(['a:bundle-1'])
      unsubA()
      unsubB()
    })

    test('a bundle queued before the composer mounts is delivered when it mounts, once', () => {
      expect(attachCommentsToComposer('bundle-late', bundle)).toBe('queued')
      const received: string[] = []
      const unsubscribe = subscribeBundles('bundle-late', next => {
        received.push(next.id)
      })
      expect(received).toEqual(['bundle-1'])
      unsubscribe()

      const again: string[] = []
      const later = subscribeBundles('bundle-late', next => {
        again.push(next.id)
      })
      expect(again).toEqual([])
      later()
    })

    test('unsubscribe stops delivery, so the next bundle waits', () => {
      const received: string[] = []
      const unsubscribe = subscribeBundles('bundle-gone', next => {
        received.push(next.id)
      })
      unsubscribe()
      expect(attachCommentsToComposer('bundle-gone', bundle)).toBe('queued')
      expect(received).toEqual([])
    })
  })
})
