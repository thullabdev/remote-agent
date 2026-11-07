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
  killFails: string | null = null
  sendKeysFails: string | null = null
  /** Runs when a pane capture starts, to interleave other work. */
  onCapture: (() => Promise<void>) | null = null
  /** When false, `/exit` is ignored and only kill-session ends the session. */
  exitWorks = true
  screen = ''

  run: Run = async argv => {
    this.calls.push(argv)
    if (argv.includes('new-session')) {
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
      if (this.killFails !== null) {
        return { code: 1, stdout: '', stderr: this.killFails }
      }
      return this.alive.delete(target) ? OK : missing(target)
    }
    if (argv[1] === 'send-keys') {
      if (this.sendKeysFails !== null) {
        return { code: 1, stdout: '', stderr: this.sendKeysFails }
      }
      if (this.exitWorks) {
        this.alive.delete(target)
      }
      return OK
    }
    if (argv[1] === 'capture-pane') {
      await this.onCapture?.()
      return { code: 0, stdout: this.screen, stderr: '' }
    }
    return { code: 1, stdout: '', stderr: `unexpected: ${argv.join(' ')}` }
  }

  commands(): string[] {
    return this.calls.map(argv => (argv.includes('new-session') ? 'launch' : argv[1] ?? ''))
  }
}
