import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import type { Log } from '../../../src/bridge/prompts.ts'

/** Output kept for replay on reattach. Oldest chunks are dropped first once this is exceeded. */
export const REPLAY_LIMIT_BYTES = 1024 * 1024

/** Environment variables a shell may inherit. Everything else (tokens, API keys, ...) is dropped. */
const INHERITED_ENV = ['HOME', 'USER', 'LOGNAME', 'PATH', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR'] as const

export type OutputListener = (data: string) => void
export type ExitListener = (exitCode: number | null) => void

export type OpenRequest = {
  sid: string
  cols: number
  rows: number
  /** Working directory for a new shell. Ignored on reattach. Falls back to the home directory when missing. */
  cwd?: string
  ownerLogin: string
  onOutput: OutputListener
  onExit: ExitListener
}

export type OpenResult = {
  created: boolean
  cwd: string
  /** Buffered output to write before any live output. Empty for a new session. */
  replay: string
}

export type PtyManager = {
  /** Creates a session, or reattaches to a live one (its buffer comes back as `replay`). A second live attachment is rejected. */
  open(request: OpenRequest): OpenResult
  /** Keystrokes or pasted text for a session owned by `ownerLogin`. */
  input(sid: string, ownerLogin: string, data: string): void
  resize(sid: string, ownerLogin: string, cols: number, rows: number): void
  /** The attached client went away. The shell keeps running and is reaped after the idle timeout. Ignored for a stale listener. */
  detach(sid: string, onOutput: OutputListener): void
  /** Kills the shell and forgets the session. Works whether or not a client is attached. */
  close(sid: string, ownerLogin: string): void
  has(sid: string): boolean
  dispose(): void
}

export type PtyManagerOptions = {
  maxSessions: number
  idleAfterMs: number
  /** Shell to run as a login shell. Defaults to $SHELL, then /bin/sh. */
  shell?: string
  log: Log
}

/** What a session shows its client: the replay buffer and the one attached listener, if any. */
type Output = {
  decoder: TextDecoder
  chunks: string[]
  bytes: number
  attached: { onOutput: OutputListener; onExit: ExitListener } | null
}

type Session = {
  sid: string
  ownerLogin: string
  cwd: string
  terminal: Bun.Terminal
  process: Bun.Subprocess
  output: Output
  idleTimer: ReturnType<typeof setTimeout> | null
}

/** Creates a PTY session manager that runs shells in-process through Bun's native terminal (`Bun.Terminal`). */
export function createPtyManager(options: PtyManagerOptions): PtyManager {
  const { maxSessions, idleAfterMs, log } = options
  const sessions = new Map<string, Session>()

  function clearIdle(session: Session): void {
    if (session.idleTimer !== null) {
      clearTimeout(session.idleTimer)
      session.idleTimer = null
    }
  }

  function armIdle(session: Session): void {
    clearIdle(session)
    session.idleTimer = setTimeout(() => {
      log(`pty session reaped after idle: ${session.sid}`)
      kill(session)
    }, idleAfterMs)
    session.idleTimer.unref?.()
  }

  /** Forgets the session and tears down its shell and terminal. Safe to call more than once. */
  function kill(session: Session): void {
    clearIdle(session)
    sessions.delete(session.sid)
    session.output.attached = null
    try {
      session.process.kill()
    } catch {
      // The shell already exited.
    }
    try {
      session.terminal.close()
    } catch {
      // The terminal already closed.
    }
  }

  function requireOwned(sid: string, ownerLogin: string): Session {
    const session = sessions.get(sid)
    if (session === undefined) {
      throw new Error(`session ${sid} not found`)
    }
    if (session.ownerLogin !== ownerLogin) {
      throw new Error(`session ${sid} belongs to another user`)
    }
    return session
  }

  function spawn(request: OpenRequest): Session {
    const shell = options.shell ?? process.env.SHELL ?? '/bin/sh'
    const cwd = resolveCwd(request.cwd)
    const output: Output = { decoder: new TextDecoder('utf-8'), chunks: [], bytes: 0, attached: null }

    const proc = Bun.spawn([shell, '-l'], {
      cwd,
      env: shellEnv(),
      terminal: {
        cols: request.cols,
        rows: request.rows,
        name: 'xterm-256color',
        data: (_terminal, bytes) => {
          const text = output.decoder.decode(bytes, { stream: true })
          if (text === '') {
            return
          }
          appendReplay(output, text)
          output.attached?.onOutput(text)
        },
      },
    })
    const terminal = proc.terminal
    if (terminal === undefined) {
      throw new Error('Bun did not attach a terminal to the shell')
    }

    const session: Session = { sid: request.sid, ownerLogin: request.ownerLogin, cwd, terminal, process: proc, output, idleTimer: null }
    sessions.set(session.sid, session)
    log(`pty session started: ${session.sid}`)

    void proc.exited.then(code => {
      // A session closed on purpose has already left the map; only shells that exit on their own are reported here.
      if (sessions.get(session.sid) !== session) {
        return
      }
      const attached = output.attached
      kill(session)
      log(`pty session exited: ${session.sid} (code ${code})`)
      attached?.onExit(code)
    })
    return session
  }

  return {
    open(request) {
      const existing = sessions.get(request.sid)
      if (existing !== undefined) {
        if (existing.ownerLogin !== request.ownerLogin) {
          throw new Error(`session ${request.sid} belongs to another user`)
        }
        if (existing.output.attached !== null) {
          throw new Error(`session ${request.sid} is already open in another connection`)
        }
        clearIdle(existing)
        existing.output.attached = { onOutput: request.onOutput, onExit: request.onExit }
        existing.terminal.resize(request.cols, request.rows)
        return { created: false, cwd: existing.cwd, replay: existing.output.chunks.join('') }
      }
      if (sessions.size >= maxSessions) {
        throw new Error(`too many terminal sessions (max ${maxSessions})`)
      }
      const session = spawn(request)
      session.output.attached = { onOutput: request.onOutput, onExit: request.onExit }
      return { created: true, cwd: session.cwd, replay: '' }
    },

    input(sid, ownerLogin, data) {
      requireOwned(sid, ownerLogin).terminal.write(data)
    },

    resize(sid, ownerLogin, cols, rows) {
      requireOwned(sid, ownerLogin).terminal.resize(cols, rows)
    },

    detach(sid, onOutput) {
      const session = sessions.get(sid)
      if (session === undefined || session.output.attached?.onOutput !== onOutput) {
        return
      }
      session.output.attached = null
      armIdle(session)
    },

    close(sid, ownerLogin) {
      const session = requireOwned(sid, ownerLogin)
      log(`pty session closed: ${sid}`)
      kill(session)
    },

    has(sid) {
      return sessions.has(sid)
    },

    dispose() {
      for (const session of [...sessions.values()]) {
        kill(session)
      }
    },
  }
}

function appendReplay(output: Output, text: string): void {
  output.chunks.push(text)
  output.bytes += Buffer.byteLength(text, 'utf8')
  while (output.bytes > REPLAY_LIMIT_BYTES && output.chunks.length > 1) {
    const dropped = output.chunks.shift() ?? ''
    output.bytes -= Buffer.byteLength(dropped, 'utf8')
  }
}

/** The working directory a new shell starts in: the requested one if it is a directory, else the home directory. */
export function resolveCwd(requested: string | undefined): string {
  const home = homedir()
  if (requested === undefined || requested.trim() === '') {
    return home
  }
  try {
    return statSync(requested).isDirectory() ? requested : home
  } catch {
    return home
  }
}

/** A minimal environment for the shell: an allowlist of inherited variables plus the terminal's own. */
export function shellEnv(): Record<string, string> {
  const env: Record<string, string> = { TERM: 'xterm-256color', COLORTERM: 'truecolor' }
  for (const key of INHERITED_ENV) {
    const value = process.env[key]
    if (value !== undefined) {
      env[key] = value
    }
  }
  return env
}
