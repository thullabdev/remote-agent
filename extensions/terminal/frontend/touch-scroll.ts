/** Pixels of vertical drag that make one wheel step. */
export const WHEEL_STEP_PX = 16
/** A movement shorter than this is a tap, so it is left to the browser and the shell. */
const TAP_SLOP_PX = 8
/** Most wheel steps sent for one touch move, so a fast flick cannot flood the shell. */
const MAX_STEPS_PER_MOVE = 10

/**
 * The SGR mouse sequence for one wheel step, aimed at the middle of the screen. Up is button 64, down is 65. tmux, with mouse
 * mode on, turns these into scrolling its own scrollback.
 */
export function wheelSequence(direction: 'up' | 'down', cols: number, rows: number): string {
  const x = Math.floor(cols / 2) + 1
  const y = Math.floor(rows / 2) + 1
  return `\x1b[<${direction === 'up' ? 64 : 65};${x};${y}M`
}

/**
 * Turns a vertical touch drag on `element` into wheel steps, sent with `emit`. A finger moving down shows older output, which is a
 * wheel up. Returns the function that removes the listeners.
 */
export function attachTouchScroll(element: HTMLElement, size: () => { cols: number; rows: number }, emit: (data: string) => void): () => void {
  let lastY: number | null = null
  let travelled = 0
  let carried = 0
  let scrolling = false

  const onStart = (event: TouchEvent) => {
    const touch = event.touches[0]
    if (event.touches.length !== 1 || !touch) {
      lastY = null
      return
    }
    lastY = touch.clientY
    travelled = 0
    carried = 0
    scrolling = false
  }

  const onMove = (event: TouchEvent) => {
    const touch = event.touches[0]
    if (lastY === null || !touch || event.touches.length !== 1) {
      return
    }
    const delta = touch.clientY - lastY
    lastY = touch.clientY
    travelled += delta
    if (!scrolling && Math.abs(travelled) < TAP_SLOP_PX) {
      return
    }
    scrolling = true
    // The page must not scroll under a drag that the terminal is using.
    event.preventDefault()
    carried += delta
    const steps = Math.trunc(carried / WHEEL_STEP_PX)
    if (steps === 0) {
      return
    }
    carried -= steps * WHEEL_STEP_PX
    const direction = steps > 0 ? 'up' : 'down'
    const count = Math.min(Math.abs(steps), MAX_STEPS_PER_MOVE)
    const { cols, rows } = size()
    const sequence = wheelSequence(direction, cols, rows)
    for (let index = 0; index < count; index += 1) {
      emit(sequence)
    }
  }

  const onEnd = () => {
    lastY = null
  }

  element.addEventListener('touchstart', onStart, { passive: true })
  element.addEventListener('touchmove', onMove, { passive: false })
  element.addEventListener('touchend', onEnd, { passive: true })
  element.addEventListener('touchcancel', onEnd, { passive: true })
  return () => {
    element.removeEventListener('touchstart', onStart)
    element.removeEventListener('touchmove', onMove)
    element.removeEventListener('touchend', onEnd)
    element.removeEventListener('touchcancel', onEnd)
  }
}
