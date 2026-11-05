import { redactSecrets, truncate } from '../core/text.ts'
import { claudeCodeAdapter, type AgentAdapter, type LaunchSpec } from './agent-adapter.ts'

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

/** Ids come from Claude Code and the Bridge, but a leading dash would let one be read as a flag. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/** Every tmux and systemd-run call a Spawned Session needs. The agent program comes from the adapter. */
export class Launcher {
  constructor(
    private readonly run: Run = runCommand,
    private readonly agent: AgentAdapter = claudeCodeAdapter,
  ) {}

  /** The scope keeps tmux (and the agent) outside the Bridge service's cgroup, so restarting the Bridge does not kill them. */
  async launch(spec: LaunchSpec): Promise<{ tmuxName: string }> {
    if (!SAFE_ID.test(spec.sessionId)) {
      throw new LaunchError(`refusing to launch: session id "${spec.sessionId}" is not a safe id`)
    }
    if (spec.resumeFrom !== undefined && !SAFE_ID.test(spec.resumeFrom)) {
      throw new LaunchError(`refusing to launch: resume id "${spec.resumeFrom}" is not a safe id`)
    }
    const tmuxName = tmuxNameFor(spec.sessionId)
    const result = await this.run([
      'env', '-u', 'TELEGRAM_BOT_TOKEN', '-u', 'TELEGRAM_CHAT_ID', '-u', 'TELEGRAM_ALLOWED_USER_ID',
      'systemd-run', '--user', '--scope', '--quiet', '--collect',
      'tmux', 'new-session', '-d', '-s', tmuxName, '-c', spec.cwd,
      ...this.agent.launchArgv(spec),
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
