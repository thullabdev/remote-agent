import { describe, expect, test } from 'bun:test'
import type { OpenStateStorage } from './components/ui/accordion-state.ts'
import { type CommentBundle, bundleMessage, COMMENT_BUNDLES_STORAGE_KEY, readBundles, writeBundles } from './comment-bundle.ts'

function memoryStorage(): OpenStateStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
  }
}

function throwingStorage(): OpenStateStorage {
  return {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    },
  }
}

function bundle(overrides: Partial<CommentBundle> = {}): CommentBundle {
  return {
    id: 'b1',
    kind: 'comments',
    title: 'Review comments · 1 comment',
    markdown: '# Review comments\n\nbody\n',
    count: 1,
    files: ['src/a.ts'],
    createdAt: 1000,
    ...overrides,
  }
}

describe('comment bundle store', () => {
  test('write then read returns the same bundles', () => {
    const storage = memoryStorage()
    const first = bundle({ id: 'one' })
    const second = bundle({ id: 'two', count: 2, files: ['src/a.ts', 'src/b.ts'] })
    writeBundles(storage, 'chat-1', [first, second])
    expect(readBundles(storage, 'chat-1')).toEqual([first, second])
  })

  test('the store is one JSON object under the versioned key, keyed by chat', () => {
    const storage = memoryStorage()
    writeBundles(storage, 'chat-1', [bundle({ id: 'a' })])
    const stored = JSON.parse(storage.data.get(COMMENT_BUNDLES_STORAGE_KEY) ?? 'null') as Record<string, CommentBundle[]>
    expect(COMMENT_BUNDLES_STORAGE_KEY).toBe('remote-agent.composer.comment-bundles.v1')
    expect(Object.keys(stored)).toEqual(['chat-1'])
    expect(stored['chat-1']?.[0]?.id).toBe('a')
  })

  test('bundles are isolated per chat, and clearing one chat keeps the other', () => {
    const storage = memoryStorage()
    writeBundles(storage, 'chat-1', [bundle({ id: 'a' })])
    writeBundles(storage, 'chat-2', [bundle({ id: 'b' })])
    expect(readBundles(storage, 'chat-1').map(item => item.id)).toEqual(['a'])
    expect(readBundles(storage, 'chat-2').map(item => item.id)).toEqual(['b'])

    writeBundles(storage, 'chat-1', [])
    expect(readBundles(storage, 'chat-1')).toEqual([])
    expect(readBundles(storage, 'chat-2').map(item => item.id)).toEqual(['b'])
  })

  test('a throwing storage reads as empty and a write does not throw', () => {
    const storage = throwingStorage()
    expect(readBundles(storage, 'chat-1')).toEqual([])
    expect(() => writeBundles(storage, 'chat-1', [bundle()])).not.toThrow()
  })

  test('a write to storage that cannot be read is skipped, so other chats are not lost', () => {
    const storage = memoryStorage()
    writeBundles(storage, 'chat-2', [bundle({ id: 'kept' })])
    const readFails: OpenStateStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: (key, value) => storage.setItem(key, value),
    }
    writeBundles(readFails, 'chat-1', [bundle({ id: 'lost' })])
    expect(readBundles(storage, 'chat-2').map(item => item.id)).toEqual(['kept'])
    expect(readBundles(storage, 'chat-1')).toEqual([])
  })

  test('null storage (no window) reads as empty and writes nothing', () => {
    expect(readBundles(null, 'chat-1')).toEqual([])
    expect(() => writeBundles(null, 'chat-1', [bundle()])).not.toThrow()
  })

  test('malformed entries are dropped on read', () => {
    const storage = memoryStorage()
    const valid = bundle({ id: 'ok' })
    const badId = { ...bundle(), id: 7 }
    const badMarkdown = { ...bundle(), markdown: null }
    const badCount = { ...bundle(), count: 1.5 }
    const negativeCount = { ...bundle(), count: -1 }
    const badFiles = { ...bundle(), files: 'src/a.ts' }
    const badFileItem = { ...bundle(), files: ['src/a.ts', 3] }
    const badCreatedAt = { ...bundle(), createdAt: '1000' }
    storage.setItem(
      COMMENT_BUNDLES_STORAGE_KEY,
      JSON.stringify({ 'chat-1': [valid, badId, badMarkdown, badCount, negativeCount, badFiles, badFileItem, badCreatedAt, null, 'x'] }),
    )
    expect(readBundles(storage, 'chat-1')).toEqual([valid])
  })

  test('a quote bundle keeps its kind and title through a write and read', () => {
    const storage = memoryStorage()
    const quote = bundle({ id: 'q1', kind: 'quote', title: 'Quote · Bash result', markdown: '> ok\n\nlooks wrong', count: 1, files: [] })
    writeBundles(storage, 'chat-1', [quote])
    expect(readBundles(storage, 'chat-1')).toEqual([quote])
  })

  test('an old stored bundle with no kind or title reads as a git comments bundle', () => {
    const storage = memoryStorage()
    const old = { id: 'old', markdown: '# Review comments\n', count: 2, files: ['src/a.ts', 'src/b.ts'], createdAt: 5 }
    storage.setItem(COMMENT_BUNDLES_STORAGE_KEY, JSON.stringify({ 'chat-1': [old] }))
    expect(readBundles(storage, 'chat-1')).toEqual([
      { ...old, kind: 'comments', title: 'Review comments · 2 comments' },
    ])
  })

  test('an old bundle with one comment gets the singular title, and a missing quote title is plain Quote', () => {
    const storage = memoryStorage()
    const single = { id: 's', markdown: 'x', count: 1, files: [], createdAt: 1 }
    const quote = { id: 'q', kind: 'quote', markdown: '> y', count: 1, files: [], createdAt: 2 }
    storage.setItem(COMMENT_BUNDLES_STORAGE_KEY, JSON.stringify({ 'chat-1': [single, quote] }))
    const [first, second] = readBundles(storage, 'chat-1')
    expect(first?.title).toBe('Review comments · 1 comment')
    expect(second).toEqual({ ...quote, kind: 'quote', title: 'Quote' })
  })

  test('an entry with a non-string title is dropped on read', () => {
    const storage = memoryStorage()
    storage.setItem(COMMENT_BUNDLES_STORAGE_KEY, JSON.stringify({ 'chat-1': [{ ...bundle(), title: 4 }] }))
    expect(readBundles(storage, 'chat-1')).toEqual([])
  })

  test('a corrupt store or a non-array chat entry reads as empty', () => {
    const corrupt = memoryStorage()
    corrupt.setItem(COMMENT_BUNDLES_STORAGE_KEY, '{not json')
    expect(readBundles(corrupt, 'chat-1')).toEqual([])

    const notArray = memoryStorage()
    notArray.setItem(COMMENT_BUNDLES_STORAGE_KEY, JSON.stringify({ 'chat-1': 'oops' }))
    expect(readBundles(notArray, 'chat-1')).toEqual([])
  })
})

describe('bundleMessage', () => {
  test('with no bundles the text is returned unchanged', () => {
    expect(bundleMessage([], 'hello')).toBe('hello')
    expect(bundleMessage([], '')).toBe('')
  })

  test('with one bundle the markdown comes first, then a blank line, then the text', () => {
    expect(bundleMessage([bundle({ markdown: '# Review comments\n\nA\n' })], 'please fix')).toBe('# Review comments\n\nA\n\nplease fix')
  })

  test('with two bundles they are in order, separated by a blank line, before the text', () => {
    const one = bundle({ id: 'one', markdown: '# First\n' })
    const two = bundle({ id: 'two', markdown: '# Second\n' })
    expect(bundleMessage([one, two], 'done')).toBe('# First\n\n# Second\n\ndone')
  })

  test('with empty text only the bundles markdown is returned', () => {
    expect(bundleMessage([bundle({ markdown: '# Only\n' })], '')).toBe('# Only')
    const one = bundle({ id: 'one', markdown: '# First\n' })
    const two = bundle({ id: 'two', markdown: '# Second\n' })
    expect(bundleMessage([one, two], '')).toBe('# First\n\n# Second')
  })
})
