import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

export type ResizableOptions = {
  /** localStorage key the width is saved under. */
  storageKey: string
  defaultWidth: number
  min: number
  max: number
  /** Pixels one arrow key press moves the edge by. */
  keyboardStep: number
  /**
   * Which edge of the panel the handle sits on. A left-edge handle grows the panel when it is dragged or pressed left;
   * a right-edge handle grows it when dragged or pressed right.
   */
  edge: 'left' | 'right'
}

export function clampWidth(width: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(width)))
}

export function readWidth(options: Pick<ResizableOptions, 'storageKey' | 'defaultWidth' | 'min' | 'max'>): number {
  try {
    const stored = Number(localStorage.getItem(options.storageKey))
    return Number.isFinite(stored) && stored > 0 ? clampWidth(stored, options.min, options.max) : options.defaultWidth
  } catch {
    return options.defaultWidth
  }
}

export function saveWidth(storageKey: string, width: number): void {
  try {
    localStorage.setItem(storageKey, String(width))
  } catch {
    // Storage unavailable: the width still applies for this session.
  }
}

/** Pointer and keyboard handling for a panel edge that can be dragged to resize the panel. */
export function useResizableWidth(options: ResizableOptions) {
  const { storageKey, min, max, keyboardStep, edge } = options
  const [width, setWidth] = useState(() => readWidth(options))
  const drag = useRef<{ x: number; width: number } | null>(null)
  // +1 when moving the pointer or the key toward the growing direction, -1 when away from it.
  const direction = edge === 'left' ? -1 : 1

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, width }
  }

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (drag.current === null) {
      return
    }
    setWidth(clampWidth(drag.current.width + direction * (event.clientX - drag.current.x), min, max))
  }

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    if (drag.current === null) {
      return
    }
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    saveWidth(storageKey, width)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const grow = edge === 'left' ? 'ArrowLeft' : 'ArrowRight'
    const shrink = edge === 'left' ? 'ArrowRight' : 'ArrowLeft'
    if (event.key !== grow && event.key !== shrink) {
      return
    }
    event.preventDefault()
    const next = clampWidth(width + (event.key === grow ? keyboardStep : -keyboardStep), min, max)
    setWidth(next)
    saveWidth(storageKey, next)
  }

  return {
    width,
    /** Spread onto a `role="separator"` element. */
    handle: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onKeyDown },
    /** The current value for assistive technology, and the limits. */
    ariaValues: { 'aria-valuemin': min, 'aria-valuemax': max, 'aria-valuenow': width },
  }
}
