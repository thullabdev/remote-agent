import { describe, expect, test } from 'bun:test'
import { DRAFT_STORAGE_KEY, draftKey, readDraft, readDrafts, writeDraft } from './commit-draft.ts'

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial))
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value)
    },
  }
}

const throwingStorage = {
  getItem: (): string | null => {
    throw new Error('blocked')
  },
  setItem: (): void => {
    throw new Error('blocked')
  },
}

describe('draftKey', () => {
  test('joins the repository root and the branch', () => {
    expect(draftKey('/repo', 'main')).toBe('/repo#main')
  })

  test('a detached HEAD has its own key', () => {
    expect(draftKey('/repo', null)).toBe('/repo#(detached)')
  })
})

describe('writeDraft and readDrafts', () => {
  test('stores a message under its key and reads it back', () => {
    const storage = memoryStorage()
    writeDraft(storage, '/repo#main', 'feat: add thing')
    expect(readDrafts(storage)).toEqual({ '/repo#main': 'feat: add thing' })
    expect(readDraft(storage, '/repo#main')).toBe('feat: add thing')
  })

  test('keeps other branches drafts when one is written', () => {
    const storage = memoryStorage({ [DRAFT_STORAGE_KEY]: JSON.stringify({ '/repo#dev': 'wip' }) })
    writeDraft(storage, '/repo#main', 'fix: x')
    expect(readDrafts(storage)).toEqual({ '/repo#dev': 'wip', '/repo#main': 'fix: x' })
  })

  test('a blank message removes the key', () => {
    const storage = memoryStorage({ [DRAFT_STORAGE_KEY]: JSON.stringify({ '/repo#main': 'wip', '/repo#dev': 'other' }) })
    writeDraft(storage, '/repo#main', '   ')
    expect(readDrafts(storage)).toEqual({ '/repo#dev': 'other' })
  })

  test('uses the versioned storage key', () => {
    const storage = memoryStorage()
    writeDraft(storage, '/repo#main', 'x')
    expect([...storage.items.keys()]).toEqual(['remote-agent.git.commit-draft.v1'])
  })
})

describe('reading malformed or missing storage', () => {
  test('a missing entry reads as an empty map and an empty message', () => {
    expect(readDrafts(memoryStorage())).toEqual({})
    expect(readDraft(memoryStorage(), '/repo#main')).toBe('')
  })

  test('malformed JSON, arrays and non-string entries are ignored', () => {
    expect(readDrafts(memoryStorage({ [DRAFT_STORAGE_KEY]: '{not json' }))).toEqual({})
    expect(readDrafts(memoryStorage({ [DRAFT_STORAGE_KEY]: '["x"]' }))).toEqual({})
    expect(readDrafts(memoryStorage({ [DRAFT_STORAGE_KEY]: JSON.stringify({ a: 'ok', b: 3 }) }))).toEqual({ a: 'ok' })
  })

  test('a null storage reads empty and writes nothing', () => {
    expect(readDrafts(null)).toEqual({})
    expect(() => writeDraft(null, '/repo#main', 'x')).not.toThrow()
  })
})

describe('a storage that throws', () => {
  test('reads give an empty draft instead of an error', () => {
    expect(readDrafts(throwingStorage)).toEqual({})
    expect(readDraft(throwingStorage, '/repo#main')).toBe('')
  })

  test('writes are dropped without an error', () => {
    expect(() => writeDraft(throwingStorage, '/repo#main', 'feat: x')).not.toThrow()
  })
})
