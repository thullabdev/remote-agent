import { attachArgv, captureScreen, tmuxEnv } from './tmux.ts'

/** Scrollback lines sent on every attach, on top of the visible screen. tmux keeps 2 000 by default. */
export const REPLAY_LINES = 2000
/** Upper bound on the replay payload. The oldest lines are dropped first. */
export const REPLAY_LIMIT_BYTES = 1024 * 1024

/** A terminal attached to a tmux session. Closing it leaves the session running. */
export type Attachment = {
  write(data: string): void
  resize(cols: number, rows: number): void
  /** Kills the attach client only. The tmux session keeps running. */
  detach(): void
  readonly closed: boolean
}

export type AttachInput = {
  /** The tmux session name, already validated by `sessionNameFor`. */
  name: string
  cols: number
  rows: number
  onOutput(data: string): void
  onExit(code: number | null): void
}

/** Attaches a Bun terminal to a tmux session. Output is decoded as a stream so split UTF-8 characters survive. */
export function attach(input: AttachInput): Attachment {
  const decoder = new TextDecoder('utf-8')
  let closed = false
  const proc = Bun.spawn(attachArgv(input.name), {
    env: tmuxEnv(),
    terminal: {
      cols: input.cols,
      rows: input.rows,
      name: 'xterm-256color',
      data: (_terminal, bytes) => {
        const text = decoder.decode(bytes, { stream: true })
        if (text !== '') {
          input.onOutput(text)
        }
      },
    },
  })
  const terminal = proc.terminal
  if (terminal === undefined) {
    throw new Error('Bun did not attach a terminal to the tmux client')
  }
  void proc.exited.then(code => {
    if (closed) {
      return
    }
    closed = true
    try {
      terminal.close()
    } catch {
      // Already closed.
    }
    input.onExit(code)
  })
  return {
    write(data) {
      if (!closed) {
        terminal.write(data)
      }
    },
    resize(cols, rows) {
      if (!closed) {
        terminal.resize(cols, rows)
      }
    },
    detach() {
      if (closed) {
        return
      }
      closed = true
      try {
        proc.kill()
      } catch {
        // Already exited.
      }
      try {
        terminal.close()
      } catch {
        // Already closed.
      }
    },
    get closed() {
      return closed
    },
  }
}

/**
 * The text to show before live output on attach: the screen and recent scrollback, capped at 1 MB. tmux redraws the screen
 * when the client attaches, so this only adds the history above it.
 */
export async function replayFor(name: string): Promise<string> {
  const text = await captureScreen(name, REPLAY_LINES)
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.byteLength <= REPLAY_LIMIT_BYTES) {
    return text
  }
  return bytes.subarray(bytes.byteLength - REPLAY_LIMIT_BYTES).toString('utf8')
}
