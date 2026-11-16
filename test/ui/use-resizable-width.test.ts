import { describe, it, expect } from 'bun:test'
import { clampWidth, readWidth } from '../../src/ui/lib/use-resizable-width.ts'

describe('resizable width', () => {
  it('keeps a width inside its limits and rounds it', () => {
    expect(clampWidth(100, 260, 560)).toBe(260)
    expect(clampWidth(900, 260, 560)).toBe(560)
    expect(clampWidth(333.6, 260, 560)).toBe(334)
  })

  it('falls back to the default when nothing usable is stored', () => {
    const options = { storageKey: 'test.width', defaultWidth: 352, min: 260, max: 560 }
    expect(readWidth(options)).toBe(352)
  })
})
