import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { Log } from '../../../../src/bridge/prompts.ts'

/** The PTY bridge runs under Node.js (node-pty needs native bindings Bun can't load).
 * Bun proxies WebSocket bytes to the bridge over stdio and bridges bridge output back to WebSocket. */
export type PtyManager = {
  /** Create or reattach a session. Reattaching an existing sid replays its buffer via the bridge. */
  open(sid: string, cols: number, rows: number, cwd: string, ownerLogin: string): string
  /** Send keystrokes/pasted text to a session's PTY. Throws if the session is not found. */
  input(sid: string, data: string): void
  /** Resize a session's PTY. */
  resize(sid: string, cols: number, rows: number): void
  /** Detach: the client WebSocket closed but the PTY stays alive. Starts the idle timer. */
  detach(sid: string): void
  /** Close: kill the PTY and remove the session. */
  close(sid: string): void
  /** Subscribe to output for a session. Returns an unsubscribe function. */
  onOutput(sid: string, onData: (data: string) => void): () => void
}

/** Options for creating a PTY manager. */
export type PtyManagerOptions = {
  maxSessions: number
  idleAfterMs: number
  /** Factory that spawns the PTY bridge. Defaults to spawning `node pty-bridge.js` next to this file. */
  spawnBridge?(): { stdin: NodeJS.WritableStream; stdout: NodeJS.ReadableStream; kill(): void }
  log: Log
}

type Session = { ownerLogin: string; cwd: string; idleTimer: NodeJS.Timer | null }
type OutputSubscribers = Map<string, Set<(data: string) => void>>

/** Create a PTY manager backed by the Node.js PTY bridge. */
export function createPtyManager(options: PtyManagerOptions): PtyManager {
  const { maxSessions, idleAfterMs, log } = options
  const spawnBridge = options.spawnBridge ?? defaultSpawnBridge

  const sessions = new Map<string, Session>()
  const subscribers: OutputSubscribers = new Map()

  const bridge = spawnBridge()

  // Read JSON lines from the bridge's stdout and dispatch to subscribers.
  let buffer = ''
  bridge.stdout.on('data', (chunk: string | Buffer) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    let newline: number
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line.trim() === '') {
        continue
      }
      try {
        const msg = JSON.parse(line)
        const sid = msg.sid as string | undefined
        if (sid !== undefined) {
          const subs = subscribers.get(sid)
          if (subs !== undefined && msg.type === 'output') {
            for (const cb of subs) {
              cb(msg.data as string)
            }
          }
        }
      } catch {
        // Ignore malformed lines from the bridge.
      }
    }
  })

  bridge.stdout.on('end', () => {
    log('pty bridge stdout ended')
  })

  function startIdleTimer(sid: string): void {
    const session = sessions.get(sid)
    if (session === undefined || session.idleTimer !== null) {
      return
    }
    session.idleTimer = setTimeout(() => {
      sessions.delete(sid)
      try {
        bridge.stdin.write(JSON.stringify({ type: 'close', sid }) + '\n')
      } catch {
        // Bridge may already be gone.
      }
      log(`pty session reaped after idle: ${sid}`)
    }, idleAfterMs)
  }

  function stopIdleTimer(sid: string): void {
    const session = sessions.get(sid)
    if (session !== undefined && session.idleTimer !== null) {
      clearTimeout(session.idleTimer)
      session.idleTimer = null
    }
  }

  function forward(type: string, payload: Record<string, unknown>): void {
    try {
      bridge.stdin.write(JSON.stringify({ type, ...payload }) + '\n')
    } catch {
      // Bridge may already be gone.
    }
  }

  return {
    open(sid, cols, rows, cwd, ownerLogin) {
      const existing = sessions.get(sid)
      if (existing !== undefined) {
        // Reattach: the bridge sends buffered output (replay) then live output.
        stopIdleTimer(sid)
        forward('open', { sid, cols, rows, cwd })
        return sid
      }
      if (sessions.size >= maxSessions) {
        throw new Error(`max sessions reached (${maxSessions})`)
      }
      try {
        forward('open', { sid, cols, rows, cwd })
      } catch (error) {
        throw new Error(`failed to open PTY: ${error instanceof Error ? error.message : String(error)}`)
      }
      sessions.set(sid, { ownerLogin, cwd, idleTimer: null })
      startIdleTimer(sid)
      return sid
    },

    input(sid, data) {
      const session = sessions.get(sid)
      if (session === undefined) {
        throw new Error(`session ${sid} not found`)
      }
      stopIdleTimer(sid)
      try {
        bridge.stdin.write(JSON.stringify({ type: 'input', sid, data }) + '\n')
      } catch (error) {
        throw new Error(`failed to send input: ${error instanceof Error ? error.message : String(error)}`)
      }
      startIdleTimer(sid)
    },

    resize(sid, cols, rows) {
      const session = sessions.get(sid)
      if (session === undefined) {
        throw new Error(`session ${sid} not found`)
      }
      try {
        bridge.stdin.write(JSON.stringify({ type: 'resize', sid, cols, rows }) + '\n')
      } catch (error) {
        throw new Error(`failed to resize: ${error instanceof Error ? error.message : String(error)}`)
      }
    },

    detach(sid) {
      const session = sessions.get(sid)
      if (session === undefined) {
        return
      }
      // PTY stays alive; start the idle timer so it gets reaped if no client reconnects.
      startIdleTimer(sid)
    },

    close(sid) {
      const session = sessions.get(sid)
      if (session === undefined) {
        throw new Error(`session ${sid} not found`)
      }
      stopIdleTimer(sid)
      sessions.delete(sid)
      forward('close', { sid })
    },

    onOutput(sid, onData) {
      let subs = subscribers.get(sid)
      if (subs === undefined) {
        subs = new Set()
        subscribers.set(sid, subs)
      }
      subs.add(onData)
      return () => {
        subs.delete(onData)
      }
    },
  }
}

function defaultSpawnBridge(): { stdin: NodeJS.WritableStream; stdout: NodeJS.ReadableStream; kill(): void } {
  const bridgePath = join(__dirname, 'pty-bridge.js')
  const child = spawn('node', [bridgePath], { stdio: ['pipe', 'pipe', 'inherit'] })
  return {
    stdin: child.stdin as NodeJS.WritableStream,
    stdout: child.stdout as NodeJS.ReadableStream,
    kill: () => child.kill(),
  }
}
