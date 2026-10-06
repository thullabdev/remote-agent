import { expect, test } from 'bun:test'
import { canonicalJson } from '../../src/core/json.ts'

test('object key order does not matter, at any depth', () => {
  expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: 2 } })).toBe(canonicalJson({ a: { c: 2, d: [1, { y: 2, z: 1 }] }, b: 1 }))
})

test('different values differ', () => {
  expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }))
  expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
})

test('undefined and primitives are handled', () => {
  expect(canonicalJson(undefined)).toBe('undefined')
  expect(canonicalJson('x')).toBe('"x"')
  expect(canonicalJson(null)).toBe('null')
})
