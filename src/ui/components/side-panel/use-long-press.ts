import { useEffect, useRef, type PointerEvent } from 'react'

/** How long a press must last to count as a long press, and how far the pointer may drift before it is a scroll instead. */
const LONG_PRESS_MS = 500
const DRIFT_PX = 10

type Pending = { chatId: string; x: number; y: number; timer: ReturnType<typeof setTimeout> }

/**
 * A long press on a row starts selection. The click that a long press ends with must not also open the row, so it is consumed once.
 */
export function useLongPress(onLongPress: (chatId: string) => void) {
  const pending = useRef<Pending | null>(null)
  const suppressed = useRef<string | null>(null)

  useEffect(
    () => () => {
      if (pending.current !== null) {
        clearTimeout(pending.current.timer)
      }
    },
    [],
  )

  const cancel = () => {
    if (pending.current !== null) {
      clearTimeout(pending.current.timer)
      pending.current = null
    }
  }

  return {
    onPointerDown(chatId: string, event: PointerEvent<HTMLElement>) {
      cancel()
      const { clientX: x, clientY: y } = event
      const timer = setTimeout(() => {
        pending.current = null
        suppressed.current = chatId
        onLongPress(chatId)
      }, LONG_PRESS_MS)
      pending.current = { chatId, x, y, timer }
    },
    onPointerMove(chatId: string, event: PointerEvent<HTMLElement>) {
      const current = pending.current
      if (current?.chatId === chatId && (Math.abs(event.clientX - current.x) > DRIFT_PX || Math.abs(event.clientY - current.y) > DRIFT_PX)) {
        cancel()
      }
    },
    /** Ends a press without selecting. */
    cancel,
    /** True once for the click a long press ended with, which must not open the row. */
    consumeClick(chatId: string): boolean {
      if (suppressed.current === chatId) {
        suppressed.current = null
        return true
      }
      return false
    },
  }
}
