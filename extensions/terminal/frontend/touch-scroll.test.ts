import { describe, it, expect } from 'bun:test'
import { attachTouchScroll, wheelSequence, WHEEL_STEP_PX } from './touch-scroll.ts'

type Listener = (event: unknown) => void

/** A stand-in element that records its listeners, so the gesture can be replayed without a browser. */
function fakeElement() {
  const listeners = new Map<string, Listener>()
  return {
    element: {
      addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    } as unknown as HTMLElement,
    fire(type: string, y?: number) {
      let prevented = false
      const touches = y === undefined ? [] : [{ clientY: y }]
      listeners.get(type)?.({ touches, preventDefault: () => (prevented = true) })
      return prevented
    },
    has: (type: string) => listeners.has(type),
  }
}

describe('wheelSequence', () => {
  it('is an SGR wheel event: 64 up, 65 down, aimed at the middle of the screen', () => {
    expect(wheelSequence('up', 80, 24)).toBe('\x1b[<64;41;13M')
    expect(wheelSequence('down', 80, 24)).toBe('\x1b[<65;41;13M')
  })
})

describe('attachTouchScroll', () => {
  it('leaves a tap alone', () => {
    const emitted: string[] = []
    const pad = fakeElement()
    attachTouchScroll(pad.element, () => ({ cols: 80, rows: 24 }), data => emitted.push(data))

    pad.fire('touchstart', 100)
    expect(pad.fire('touchmove', 103)).toBe(false)
    pad.fire('touchend')
    expect(emitted).toEqual([])
  })

  it('sends one wheel up per step when the finger moves down, and takes over the gesture', () => {
    const emitted: string[] = []
    const pad = fakeElement()
    attachTouchScroll(pad.element, () => ({ cols: 80, rows: 24 }), data => emitted.push(data))

    pad.fire('touchstart', 100)
    expect(pad.fire('touchmove', 100 + WHEEL_STEP_PX * 2 + 1)).toBe(true)

    expect(emitted).toEqual([wheelSequence('up', 80, 24), wheelSequence('up', 80, 24)])
  })

  it('sends wheel down when the finger moves up, and keeps the leftover distance for the next move', () => {
    const emitted: string[] = []
    const pad = fakeElement()
    attachTouchScroll(pad.element, () => ({ cols: 80, rows: 24 }), data => emitted.push(data))

    pad.fire('touchstart', 200)
    pad.fire('touchmove', 200 - 10)
    pad.fire('touchmove', 200 - 10 - 10)

    expect(emitted).toEqual([wheelSequence('down', 80, 24)])
  })

  it('removes its listeners when detached', () => {
    const pad = fakeElement()
    const detach = attachTouchScroll(pad.element, () => ({ cols: 80, rows: 24 }), () => {})
    detach()
    expect(pad.has('touchmove')).toBe(false)
  })
})
