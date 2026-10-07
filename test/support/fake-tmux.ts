import type { Run, RunResult } from '../../src/bridge/launcher.ts'

const OK: RunResult = { code: 0, stdout: '', stderr: '' }

function missing(name: string): RunResult {
  return { code: 1, stdout: '', stderr: `can't find session: ${name}` }
}

/** Simulates systemd-run + tmux: tracks which tmux sessions are alive. */
export class FakeTmux {
  calls: string[][] = []
  alive = new Set<string>()
  launchFails: string | null = null
  /** When false, `/exit` is ignored and only kill-session ends the session. */
  exitWorks = true
  screen = ''

  run: Run = async argv => {
    this.calls.push(argv)
    if (argv[0] === 'systemd-run') {
      if (this.launchFails !== null) {
        return { code: 1, stdout: '', stderr: this.launchFails }
      }
      this.alive.add(argv[argv.indexOf('-s') + 1] ?? '')
      return OK
    }
    const target = (argv[argv.indexOf('-t') + 1] ?? '').replace(/^=/, '')
    if (argv[1] === 'has-session') {
      return this.alive.has(target) ? OK : missing(target)
    }
    if (argv[1] === 'kill-session') {
      return this.alive.delete(target) ? OK : missing(target)
    }
    if (argv[1] === 'send-keys') {
      if (this.exitWorks) {
        this.alive.delete(target)
      }
      return OK
    }
    if (argv[1] === 'capture-pane') {
      return { code: 0, stdout: this.screen, stderr: '' }
    }
    return { code: 1, stdout: '', stderr: `unexpected: ${argv.join(' ')}` }
  }

  commands(): string[] {
    return this.calls.map(argv => (argv[0] === 'systemd-run' ? 'launch' : argv[1] ?? ''))
  }
}
