import { describe, it, expect } from 'bun:test'
import { deepLinkPanel } from '../../src/ui/presentation.ts'

describe('deepLinkPanel', () => {
  it('reads the panel id and its parameters from the URL', () => {
    expect(deepLinkPanel('?panel=terminal&sid=sid-1')).toEqual({ id: 'terminal', params: { sid: 'sid-1' } })
  })

  it('returns null when no panel is named', () => {
    expect(deepLinkPanel('?chat=abc')).toBe(null)
    expect(deepLinkPanel('')).toBe(null)
  })

  it('returns null for an empty panel value', () => {
    expect(deepLinkPanel('?panel=')).toBe(null)
  })

  it('leaves chat parameters out of the panel parameters', () => {
    expect(deepLinkPanel('?panel=terminal&sid=s&chat=c&prompt=p')).toEqual({ id: 'terminal', params: { sid: 's' } })
  })
})
