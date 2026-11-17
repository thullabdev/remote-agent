import { expect, test } from 'bun:test'
import { readOpen, writeOpen, type OpenStateStorage } from './accordion-state.ts'

function memory(): OpenStateStorage {
  const map = new Map<string, string>()
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) }
}

test('falls back to the default when nothing is stored', () => {
  expect(readOpen(memory(), 'files', true)).toBe(true)
})

test('remembers the open state per id', () => {
  const storage = memory()
  writeOpen(storage, 'files', false)
  writeOpen(storage, 'log', true)
  expect(readOpen(storage, 'files', true)).toBe(false)
  expect(readOpen(storage, 'log', false)).toBe(true)
})

test('a throwing or corrupt store falls back to the default', () => {
  const throwing: OpenStateStorage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  expect(readOpen(throwing, 'files', true)).toBe(true)
  writeOpen(throwing, 'files', false)
  expect(readOpen({ getItem: () => '{not json', setItem: () => {} }, 'files', true)).toBe(true)
})

test('null storage (no localStorage) falls back to the default and never throws', () => {
  expect(readOpen(null, 'files', false)).toBe(false)
  writeOpen(null, 'files', true)
})
