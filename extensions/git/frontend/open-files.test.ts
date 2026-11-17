import { describe, expect, test } from 'bun:test'
import type { OpenStateStorage } from '../../../src/ui/components/ui/accordion-state.ts'
import { readOpenDiffs, writeOpenDiffs } from './open-files.ts'

const KEY = 'remote-agent.git.open-files.v1'

function memoryStorage(initial: Record<string, string> = {}): OpenStateStorage {
  const data: Record<string, string> = { ...initial }
  return {
    getItem: key => (key in data ? (data[key] ?? null) : null),
    setItem: (key, value) => {
      data[key] = value
    },
  }
}

describe('open diffs', () => {
  test('each chat keeps its own open diffs', () => {
    const storage = memoryStorage()
    writeOpenDiffs(storage, 'chat-1', [{ path: 'a.ts', scope: 'unstaged' }])
    writeOpenDiffs(storage, 'chat-2', [{ path: 'b.ts', scope: 'commit', sha: 'abc1234' }])
    expect(readOpenDiffs(storage, 'chat-1')).toEqual([{ path: 'a.ts', scope: 'unstaged' }])
    expect(readOpenDiffs(storage, 'chat-2')).toEqual([{ path: 'b.ts', scope: 'commit', sha: 'abc1234' }])
    expect(readOpenDiffs(storage, 'chat-3')).toEqual([])
  })

  test('a throwing store reads as empty and writes nothing', () => {
    const throwing: OpenStateStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readOpenDiffs(throwing, 'chat-1')).toEqual([])
    expect(() => writeOpenDiffs(throwing, 'chat-1', [{ path: 'a.ts', scope: 'staged' }])).not.toThrow()
    expect(readOpenDiffs(null, 'chat-1')).toEqual([])
  })

  test('a corrupt value reads as empty', () => {
    expect(readOpenDiffs(memoryStorage({ [KEY]: '{not json' }), 'chat-1')).toEqual([])
    expect(readOpenDiffs(memoryStorage({ [KEY]: '[1,2]' }), 'chat-1')).toEqual([])
  })

  test('malformed entries are dropped on read', () => {
    const raw = JSON.stringify({
      'chat-1': [
        { path: 'ok.ts', scope: 'staged' },
        { path: 42, scope: 'staged' },
        { path: 'bad-scope.ts', scope: 'everything' },
        'nonsense',
      ],
    })
    expect(readOpenDiffs(memoryStorage({ [KEY]: raw }), 'chat-1')).toEqual([{ path: 'ok.ts', scope: 'staged' }])
  })
})
