import { useRef, type ReactNode, type TouchEvent } from 'react'

/** A swipe that starts at the left edge: how far it must travel sideways and how far it may drift vertically. */
const EDGE_WIDTH = 40
const SWIPE_DISTANCE = 80
const SWIPE_DRIFT = 60

/**
 * The main area beside the chat list. On the narrow layout it slides over the list when a chat or panel is open, and a swipe
 * from the left edge goes back to the list.
 */
export function MainArea({ shown, onSwipeBack, children }: { shown: boolean; onSwipeBack(): void; children: ReactNode }) {
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  const onTouchStart = (event: TouchEvent<HTMLElement>) => {
    const touch = event.touches[0]
    touchStart.current = touch && touch.clientX < EDGE_WIDTH ? { x: touch.clientX, y: touch.clientY } : null
  }

  const onTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const start = touchStart.current
    const touch = event.changedTouches[0]
    if (start && touch && touch.clientX - start.x > SWIPE_DISTANCE && Math.abs(touch.clientY - start.y) < SWIPE_DRIFT) {
      onSwipeBack()
    }
    touchStart.current = null
  }

  return (
    <main
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className={`absolute inset-0 z-20 flex min-w-0 bg-background shadow-2xl transition-transform duration-300 md:static md:z-auto md:flex-1 md:translate-x-0 md:shadow-none ${
        shown ? 'translate-x-0' : 'translate-x-full md:translate-x-0'
      }`}
    >
      {children}
    </main>
  )
}
