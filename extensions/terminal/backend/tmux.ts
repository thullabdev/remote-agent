import { statSync } from 'node:fs'
import { homedir } from 'node:os'

/** The dedicated tmux server for terminal sessions. Separate from the default server, where Claude sessions live. */
export const TMUX_SOCKET = 'remote-agent-terminal'

const SID = /^[A-Za-z0-9_-]{1,80}$/

/** Environment for every tmux process, and so for every shell it starts. An allowlist: bridge secrets never reach a shell. */
const INHERITED_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR'] as const

export class TmuxError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message)
  }
}

export type TmuxRun = { code: number; stdout: string; stderr: string }

/** Runs a tmux command on the dedicated socket. Arguments are an argv array; nothing is passed through a shell. */
export async function runTmux(args: string[]): Promise<TmuxRun> {
  const proc = Bun.spawn(['tmux', '-L', TMUX_SOCKET, ...args], { env: tmuxEnv(), stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const code = await proc.exited
  return { code, stdout, stderr }
}

/** The tmux session name for a terminal session id. Validates the id before it becomes a tmux argument. */
export function sessionNameFor(sid: string): string {
  if (!SID.test(sid)) {
    throw new Error(`invalid session id "${sid}"`)
  }
  return `ra-term-${sid}`
}

export function tmuxEnv(): Record<string, string> {
  const env: Record<string, string> = { TERM: 'xterm-256color', COLORTERM: 'truecolor' }
  for (const key of INHERITED_ENV) {
    const value = process.env[key]
    if (value !== undefined) {
      env[key] = value
    }
  }
  if (env.HOME === undefined) {
    env.HOME = homedir()
  }
  return env
}

let available: boolean | null = null

/** Whether the tmux binary runs at all. Checked once; a missing tmux is a clear error, not a crash. */
export async function tmuxAvailable(): Promise<boolean> {
  if (available === null) {
    try {
      const proc = Bun.spawn(['tmux', '-V'], { env: tmuxEnv(), stdout: 'ignore', stderr: 'ignore' })
      available = (await proc.exited) === 0
    } catch {
      available = false
    }
  }
  return available
}

/**
 * Creates a detached tmux session running `shell` as a login shell, in `cwd`. The window follows the attached client's size,
 * and the status bar is off so the terminal looks like a terminal.
 */
export async function createSession(input: { name: string; cwd: string; cols: number; rows: number; shell: string }): Promise<void> {
  if (!isDirectory(input.cwd)) {
    // tmux starts a session in a missing directory without complaint, so the check is ours.
    throw new TmuxError(`folder does not exist: ${input.cwd}`, 1)
  }
  const created = await runTmux(['new-session', '-d', '-s', input.name, '-c', input.cwd, '-x', String(input.cols), '-y', String(input.rows), input.shell, '-l'])
  if (created.code !== 0) {
    throw new TmuxError(created.stderr.trim() || 'tmux could not start the session', created.code)
  }
  await runTmux(['set-option', '-t', input.name, 'window-size', 'latest'])
  await runTmux(['set-option', '-t', input.name, 'status', 'off'])
}

export async function hasSession(name: string): Promise<boolean> {
  return (await runTmux(['has-session', '-t', `=${name}`])).code === 0
}

/** Kills a session. A session that is already gone is not an error. */
export async function killSession(name: string): Promise<void> {
  await runTmux(['kill-session', '-t', `=${name}`])
}

/** The visible screen and up to `lines` lines of scrollback, with colour, ready to write to a terminal (CRLF line ends). */
export async function captureScreen(name: string, lines: number): Promise<string> {
  const result = await runTmux(['capture-pane', '-p', '-e', '-S', `-${lines}`, '-t', `=${name}:`])
  if (result.code !== 0) {
    return ''
  }
  return result.stdout.replace(/\n/g, '\r\n')
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** The argv that attaches a terminal to a tmux session. Run it under Bun.spawn with a terminal, never through a shell. */
export function attachArgv(name: string): string[] {
  return ['tmux', '-L', TMUX_SOCKET, 'attach-session', '-t', `=${name}`]
}
