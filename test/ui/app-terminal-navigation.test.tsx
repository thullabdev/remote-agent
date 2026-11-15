import { describe, it, expect } from 'bun:test'
import { deepLinkTerminal } from '../../src/ui/presentation.ts'

describe('deepLinkTerminal', () => {
  it('parses ?terminal=<sid> from the URL', () => {
    expect(deepLinkTerminal('?terminal=sid-1')).toBe('sid-1')
  })

  it('returns null when no terminal param', () => {
    expect(deepLinkTerminal('?chat=abc')).toBe(null)
    expect(deepLinkTerminal('')).toBe(null)
  })

  it('returns null for an empty terminal value', () => {
    expect(deepLinkTerminal('?terminal=')).toBe(null)
  })
})
