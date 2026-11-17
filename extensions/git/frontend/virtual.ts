/** The rows to draw, as a half-open range of indexes. */
export type RowRange = { start: number; end: number }

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}

/**
 * The rows to draw for a list of rows that all have one height: the rows under the viewport, plus `overscan` rows on each side.
 * `scrollTop` is clamped to the scrollable range, so a value past the end shows the last rows. The result is clamped to [0, count].
 */
export function visibleRange({
  scrollTop,
  viewportHeight,
  rowHeight,
  count,
  overscan,
}: {
  scrollTop: number
  viewportHeight: number
  rowHeight: number
  count: number
  overscan: number
}): RowRange {
  if (count <= 0) {
    return { start: 0, end: 0 }
  }
  if (rowHeight <= 0) {
    return { start: 0, end: count }
  }
  const viewport = Math.max(0, viewportHeight)
  const maxScrollTop = Math.max(0, count * rowHeight - viewport)
  const top = clamp(scrollTop, 0, maxScrollTop)
  const first = Math.floor(top / rowHeight)
  const last = Math.ceil((top + viewport) / rowHeight)
  const pad = Math.max(0, overscan)
  return { start: clamp(first - pad, 0, count), end: clamp(last + pad, 0, count) }
}

/** The top offset of every row, then the total height as the last entry: `tops[i + 1] - tops[i]` is row i's height. */
export function rowTops(count: number, heightOf: (index: number) => number): number[] {
  const tops = [0]
  for (let index = 0; index < count; index += 1) {
    tops.push((tops[index] ?? 0) + heightOf(index))
  }
  return tops
}

/**
 * The rows to draw when rows have different heights, given the offsets from `rowTops`.
 * Same rule as `visibleRange`: the rows that overlap the viewport, plus `overscan` rows on each side, clamped to [0, count].
 */
export function visibleRangeInTops({
  scrollTop,
  viewportHeight,
  tops,
  overscan,
}: {
  scrollTop: number
  viewportHeight: number
  tops: number[]
  overscan: number
}): RowRange {
  const count = Math.max(0, tops.length - 1)
  if (count === 0) {
    return { start: 0, end: 0 }
  }
  const viewport = Math.max(0, viewportHeight)
  const total = tops[count] ?? 0
  const top = clamp(scrollTop, 0, Math.max(0, total - viewport))
  const bottom = top + viewport
  // The last row that starts at or above `top`: binary search over the row starts.
  let low = 0
  let high = count - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if ((tops[middle] ?? 0) <= top) {
      low = middle
    } else {
      high = middle - 1
    }
  }
  let last = low
  while (last < count && (tops[last] ?? 0) < bottom) {
    last += 1
  }
  const pad = Math.max(0, overscan)
  return { start: clamp(low - pad, 0, count), end: clamp(last + pad, 0, count) }
}
