import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { rowTops, visibleRange, visibleRangeInTops } from './virtual.ts'

/** Rows drawn beyond each edge of the viewport, so a fast scroll does not show blank space. */
const OVERSCAN = 5
/** The viewport height used before the real one is measured. */
const FALLBACK_VIEWPORT = 320

/**
 * A scroll container that draws only the rows under its viewport. The rest are represented by the height of a spacer.
 * `rowHeight` is a fixed height in pixels, or a function giving each row's height. `renderRow` content should fill its row (`h-full`).
 */
export function VirtualRows<T>({
  rows,
  rowHeight,
  getKey,
  renderRow,
}: {
  rows: readonly T[]
  rowHeight: number | ((row: T) => number)
  getKey(row: T): string
  renderRow(row: T): ReactNode
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT)

  useEffect(() => {
    const element = scroller.current
    if (element === null) {
      return undefined
    }
    const measure = () => setViewportHeight(element.clientHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const tops = useMemo(() => rowTops(rows.length, (index) => (typeof rowHeight === 'number' ? rowHeight : rowHeight(rows[index] as T))), [rows, rowHeight])
  const range =
    typeof rowHeight === 'number'
      ? visibleRange({ scrollTop, viewportHeight, rowHeight, count: rows.length, overscan: OVERSCAN })
      : visibleRangeInTops({ scrollTop, viewportHeight, tops, overscan: OVERSCAN })

  const items: ReactNode[] = []
  for (let index = range.start; index < range.end; index += 1) {
    const row = rows[index] as T
    const top = tops[index] ?? 0
    const height = (tops[index + 1] ?? top) - top
    items.push(
      <div key={getKey(row)} role="listitem" className="absolute inset-x-0" style={{ top: `${top}px`, height: `${height}px` }}>
        {renderRow(row)}
      </div>,
    )
  }

  return (
    <div ref={scroller} role="list" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} className="h-full overflow-auto">
      <div className="relative" style={{ height: `${tops[rows.length] ?? 0}px` }}>
        {items}
      </div>
    </div>
  )
}
