import { beforeEach, expect, test } from 'bun:test'
import { Liveness, PING_INTERVAL_MS, PONG_TIMEOUT_MS, RESUME_PROBE_AFTER_MS, RESUME_PROBE_TIMEOUT_MS, type LivenessDeps } from '../../src/ui/liveness.ts'

/** A clock the test moves by hand, with the timers Liveness asks for. */
class ManualClock {
  now = 0
  private nextId = 0
  private tasks = new Map<number, { at: number; fn: () => void; every: number | null }>()

  schedule = (fn: () => void, ms: number): (() => void) => this.add(fn, ms, null)
  repeat = (fn: () => void, ms: number): (() => void) => this.add(fn, ms, ms)

  private add(fn: () => void, ms: number, every: number | null): () => void {
    const id = this.nextId++
    this.tasks.set(id, { at: this.now + ms, fn, every })
    return () => {
      this.tasks.delete(id)
    }
  }

  advance(ms: number): void {
    const end = this.now + ms
    for (;;) {
      const due = [...this.tasks.entries()].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (due === undefined) {
        break
      }
      const [id, task] = due
      this.now = task.at
      if (task.every === null) {
        this.tasks.delete(id)
      } else {
        task.at += task.every
      }
      task.fn()
    }
    this.now = end
  }
}

let clock: ManualClock
let pings: number
let dead: number
let monitor: Liveness

beforeEach(() => {
  clock = new ManualClock()
  pings = 0
  dead = 0
  const deps: LivenessDeps = {
    now: () => clock.now,
    send: () => {
      pings += 1
    },
    onDead: () => {
      dead += 1
    },
    schedule: clock.schedule,
    repeat: clock.repeat,
  }
  monitor = new Liveness(deps)
  monitor.start()
})

test('it pings on an interval, and a reply keeps the connection alive', () => {
  clock.advance(PING_INTERVAL_MS)
  expect(pings).toBe(1)
  clock.advance(1_000)
  monitor.heard()
  clock.advance(PONG_TIMEOUT_MS)
  expect(dead).toBe(0)
  clock.advance(PING_INTERVAL_MS)
  expect(pings).toBe(2)
})

test('a ping nobody answers marks the connection dead, once', () => {
  clock.advance(PING_INTERVAL_MS)
  expect(dead).toBe(0)
  clock.advance(PONG_TIMEOUT_MS)
  expect(dead).toBe(1)
  clock.advance(10 * PING_INTERVAL_MS)
  expect(dead).toBe(1)
  expect(pings).toBe(1)
})

test('any message counts as a sign of life, not only the pong', () => {
  clock.advance(PING_INTERVAL_MS)
  clock.advance(PONG_TIMEOUT_MS - 1)
  monitor.heard()
  clock.advance(5_000)
  expect(dead).toBe(0)
})

test('returning to the app after a short absence does nothing', () => {
  clock.advance(5_000)
  monitor.heard()
  clock.advance(RESUME_PROBE_AFTER_MS - 1)
  monitor.returned()
  expect(pings).toBe(0)
})

test('returning after a long silence probes at once, and a quiet connection is declared dead quickly', () => {
  clock.advance(RESUME_PROBE_AFTER_MS)
  monitor.returned()
  expect(pings).toBe(1)
  clock.advance(RESUME_PROBE_TIMEOUT_MS - 1)
  expect(dead).toBe(0)
  clock.advance(1)
  expect(dead).toBe(1)
})

test('a probe that is answered leaves the connection alive', () => {
  clock.advance(RESUME_PROBE_AFTER_MS)
  monitor.returned()
  clock.advance(1_000)
  monitor.heard()
  clock.advance(RESUME_PROBE_TIMEOUT_MS)
  expect(dead).toBe(0)
})

test('a probe does not stack on a ping already waiting for its answer', () => {
  clock.advance(PING_INTERVAL_MS)
  expect(pings).toBe(1)
  monitor.returned()
  expect(pings).toBe(1)
})

test('after stop nothing more is sent and nothing is declared dead', () => {
  clock.advance(PING_INTERVAL_MS)
  monitor.stop()
  clock.advance(10 * PING_INTERVAL_MS)
  expect(dead).toBe(0)
  expect(pings).toBe(1)
  monitor.returned()
  expect(pings).toBe(1)
})
