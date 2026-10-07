import { redactSecrets, truncate } from '../core/text.ts'

export type RunResult = { code: number; stdout: string; stderr: string }
export type Run = (argv: string[]) => Promise<RunResult>

/** A tmux or systemd-run call failed. The message is redacted and safe to post. */
export class LaunchError extends Error {}

const ERROR_MAX = 500
const GONE = /can't find session|no server running|session not found/i

/** Runs argv without a shell. A missing executable becomes a failed result, not an exception. */
export const runCommand: Run = async argv => {
  try {
    const child = Bun.spawn(argv, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    return { code, stdout, stderr }
  } catch (error) {
    return { code: 127, stdout: '', stderr: error instanceof Error ? error.message : String(error) }
  }
}

export function tmuxNameFor(sessionId: string): string {
  return `ra-${sessionId.slice(0, 8)}`
}

function failure(result: RunResult): LaunchError {
  const text = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`
  return new LaunchError(truncate(redactSecrets(text), ERROR_MAX))
}

/** Every tmux and systemd-run call a Spawned Session needs. */
export class Launcher {
  constructor(private readonly run: Run = runCommand) {}

  /** The scope keeps tmux (and claude) outside the Bridge service's cgroup, so restarting the Bridge does not kill them. */
  async launch(spec: { sessionId: string; cwd: string }): Promise<{ tmuxName: string }> {
    const tmuxName = tmuxNameFor(spec.sessionId)
    const result = await this.run([
      'systemd-run', '--user', '--scope', '--quiet', '--collect',
      'tmux', 'new-session', '-d', '-s', tmuxName, '-c', spec.cwd,
      'claude', '--session-id', spec.sessionId,
    ])
    if (result.code !== 0) {
      throw failure(result)
    }
    return { tmuxName }
  }

  async exists(name: string): Promise<boolean> {
    return (await this.run(['tmux', 'has-session', '-t', `=${name}`])).code === 0
  }

  async capture(name: string, lines: number): Promise<string> {
    const result = await this.run(['tmux', 'capture-pane', '-p', '-t', name])
    if (result.code !== 0) {
      throw failure(result)
    }
    return result.stdout.trimEnd().split('\n').slice(-lines).join('\n')
  }

  async sendExit(name: string): Promise<void> {
    const result = await this.run(['tmux', 'send-keys', '-t', name, '/exit', 'Enter'])
    if (result.code !== 0) {
      throw failure(result)
    }
  }

  async kill(name: string): Promise<void> {
    const result = await this.run(['tmux', 'kill-session', '-t', `=${name}`])
    if (result.code !== 0 && !GONE.test(result.stderr)) {
      throw failure(result)
    }
  }
}
