import { describe, expect, test } from 'bun:test'
import type { OpenDiff } from './open-files.ts'
import { addOrActivate, closeOptionsFor, removeTab, sameDiff, tabName } from './diff-tabs.ts'

const a: OpenDiff = { path: 'src/a.ts', scope: 'unstaged' }
const b: OpenDiff = { path: 'src/b.ts', scope: 'staged' }
const c: OpenDiff = { path: 'docs/c.md', scope: 'commit', sha: 'abc1234' }

describe('diff tabs', () => {
  test('tabName shows only the file name', () => {
    expect(tabName('src/deep/a.ts')).toBe('a.ts')
    expect(tabName('a.ts')).toBe('a.ts')
  })

  test('sameDiff compares path, scope and sha', () => {
    expect(sameDiff(a, { path: 'src/a.ts', scope: 'unstaged' })).toBe(true)
    expect(sameDiff(a, { path: 'src/a.ts', scope: 'staged' })).toBe(false)
    expect(sameDiff(c, { path: 'docs/c.md', scope: 'commit', sha: 'other' })).toBe(false)
  })

  test('addOrActivate appends a new diff and returns it as active', () => {
    const result = addOrActivate([a], b)
    expect(result.list).toEqual([a, b])
    expect(result.active).toEqual(b)
  })

  test('addOrActivate does not duplicate a diff already in the list', () => {
    const result = addOrActivate([a, b], { path: 'src/b.ts', scope: 'staged' })
    expect(result.list).toEqual([a, b])
    expect(result.active).toEqual(b)
  })

  test('removeTab takes the nearest tab to the right, then the left', () => {
    expect(removeTab([a, b, c], b)).toEqual({ list: [a, c], next: c })
    expect(removeTab([a, b, c], c)).toEqual({ list: [a, b], next: b })
    expect(removeTab([a], a)).toEqual({ list: [], next: null })
  })

  test('removeTab leaves the list alone when the diff is not in it', () => {
    expect(removeTab([a, b], c)).toEqual({ list: [a, b], next: a })
  })

  test('closeOptionsFor returns the origin chat when known and nothing otherwise', () => {
    expect(closeOptionsFor('chat-1')).toEqual({ chatId: 'chat-1' })
    expect(closeOptionsFor(undefined)).toEqual({})
    expect(closeOptionsFor('')).toEqual({})
  })
})
