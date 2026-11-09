/**
 * Tells a live connection from a dead one that still looks open. A phone that loses its network, or a tab the browser froze, can
 * keep a socket "open" for minutes: no close event ever fires, so without this the app would show old data as if it were live.
 *
 * The browser pings on an interval and expects *any* message back soon after. It also probes when the user comes back to the app
 * after a quiet spell, with a short deadline. A connection that stays silent past its deadline is declared dead, once, and the
 * owner reconnects (replaying what was missed). Timers and the clock are injected, so the rules are testable without a browser.
 */
export const PING_INTERVAL_MS = 30_000
export const PONG_TIMEOUT_MS = 10_000
/** On return to the app, a connection silent this long is probed instead of trusted. */
export const RESUME_PROBE_AFTER_MS = 20_000
export const RESUME_PROBE_TIMEOUT_MS = 4_000

export type LivenessDeps = {
  now(): number
  /** Sends a ping. */
  send(): void
  /** The connection did not answer in time. Called at most once. */
  onDead(): void
  /** Runs `fn` once after `ms`; the returned function cancels it. */
  schedule(fn: () => void, ms: number): () => void
  /** Runs `fn` every `ms`; the returned function cancels it. */
  repeat(fn: () => void, ms: number): () => void
}

export class Liveness {
  private lastHeardAt: number
  private cancelRepeat: (() => void) | null = null
  private cancelWait: (() => void) | null = null
  private stopped = false

  constructor(private readonly deps: LivenessDeps) {
    this.lastHeardAt = deps.now()
  }

  start(): void {
    this.cancelRepeat = this.deps.repeat(() => this.ping(PONG_TIMEOUT_MS), PING_INTERVAL_MS)
  }

  /** Anything arrived from the server: the connection is alive, so no answer is owed any more. */
  heard(): void {
    this.lastHeardAt = this.deps.now()
    this.cancelWait?.()
    this.cancelWait = null
  }

  /** The user is back (the tab became visible, or the network returned). Probes if the connection has been quiet for a while. */
  returned(): void {
    if (!this.stopped && this.deps.now() - this.lastHeardAt >= RESUME_PROBE_AFTER_MS) {
      this.ping(RESUME_PROBE_TIMEOUT_MS)
    }
  }

  stop(): void {
    this.stopped = true
    this.cancelRepeat?.()
    this.cancelWait?.()
    this.cancelRepeat = null
    this.cancelWait = null
  }

  private ping(timeoutMs: number): void {
    if (this.stopped || this.cancelWait !== null) {
      return
    }
    const sentAt = this.deps.now()
    this.deps.send()
    this.cancelWait = this.deps.schedule(() => {
      this.cancelWait = null
      if (!this.stopped && this.lastHeardAt < sentAt) {
        this.stop()
        this.deps.onDead()
      }
    }, timeoutMs)
  }
}
