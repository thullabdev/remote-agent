import { describe, expect, test } from 'bun:test'
import { rowTops, visibleRange, visibleRangeInTops } from './virtual.ts'

describe('visibleRange', () => {
  test('draws the rows under the viewport plus overscan on each side', () => {
    expect(visibleRange({ scrollTop: 0, viewportHeight: 280, rowHeight: 28, count: 1000, overscan: 5 })).toEqual({ start: 0, end: 15 })
    expect(visibleRange({ scrollTop: 280, viewportHeight: 280, rowHeight: 28, count: 1000, overscan: 5 })).toEqual({ start: 5, end: 25 })
  })

  test('a count of zero draws nothing', () => {
    expect(visibleRange({ scrollTop: 0, viewportHeight: 280, rowHeight: 28, count: 0, overscan: 5 })).toEqual({ start: 0, end: 0 })
    expect(visibleRange({ scrollTop: 500, viewportHeight: 280, rowHeight: 28, count: 0, overscan: 5 })).toEqual({ start: 0, end: 0 })
  })

  test('a scrollTop past the end shows the last rows, clamped to the count', () => {
    expect(visibleRange({ scrollTop: 1_000_000, viewportHeight: 280, rowHeight: 28, count: 1000, overscan: 5 })).toEqual({ start: 985, end: 1000 })
  })

  test('a negative scrollTop is treated as the top', () => {
    expect(visibleRange({ scrollTop: -40, viewportHeight: 280, rowHeight: 28, count: 1000, overscan: 0 })).toEqual({ start: 0, end: 10 })
  })

  test('a list shorter than the viewport draws every row', () => {
    expect(visibleRange({ scrollTop: 0, viewportHeight: 280, rowHeight: 28, count: 3, overscan: 5 })).toEqual({ start: 0, end: 3 })
  })

  test('the window ends on a row boundary when the viewport holds part of a row', () => {
    expect(visibleRange({ scrollTop: 0, viewportHeight: 30, rowHeight: 28, count: 100, overscan: 0 })).toEqual({ start: 0, end: 2 })
  })
})

describe('rowTops', () => {
  test('gives each row its top, then the total height', () => {
    expect(rowTops(3, (index) => (index === 1 ? 40 : 28))).toEqual([0, 28, 68, 96])
  })

  test('an empty list has a single zero top', () => {
    expect(rowTops(0, () => 28)).toEqual([0])
  })
})

describe('visibleRangeInTops', () => {
  const tops = rowTops(100, (index) => (index % 2 === 0 ? 40 : 28))

  test('draws the rows that overlap the viewport, plus overscan', () => {
    // Rows 0..: tops 0, 40, 68, 108, 136, ... The viewport 0..100 overlaps rows 0, 1, 2 (row 2 starts at 68).
    expect(visibleRangeInTops({ scrollTop: 0, viewportHeight: 100, tops, overscan: 0 })).toEqual({ start: 0, end: 3 })
    expect(visibleRangeInTops({ scrollTop: 0, viewportHeight: 100, tops, overscan: 1 })).toEqual({ start: 0, end: 4 })
  })

  test('finds the first visible row in the middle of the list', () => {
    // scrollTop is the top of row 50, so the first drawn row is row 50.
    const middle = visibleRangeInTops({ scrollTop: tops[50] ?? 0, viewportHeight: 100, tops, overscan: 0 })
    expect(middle.start).toBe(50)
    expect(middle.end).toBeGreaterThan(middle.start)
    expect(middle.end - middle.start).toBeLessThanOrEqual(5)
  })

  test('a scrollTop past the end shows the last rows', () => {
    const range = visibleRangeInTops({ scrollTop: 1_000_000, viewportHeight: 100, tops, overscan: 0 })
    expect(range.end).toBe(100)
    expect(range.start).toBeLessThan(100)
  })

  test('an empty list draws nothing', () => {
    expect(visibleRangeInTops({ scrollTop: 0, viewportHeight: 100, tops: rowTops(0, () => 28), overscan: 5 })).toEqual({ start: 0, end: 0 })
  })
})
