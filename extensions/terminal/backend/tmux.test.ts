import { describe, it, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { attachArgv, captureScreen, createSession, hasSession, killSession, parseForegroundCommands, runTmux, sessionNameFor, TmuxError, TMUX_SOCKET, tmuxAvailable } from './tmux.ts'

const names: string[] = []

async function sleepUntil(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const started = Date.now()
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('timed out')
    }
    await Bun.sleep(50)
  }
}

describe('tmux runtime', () => {
  afterEach(async () => {
    for (const name of names.splice(0)) {
      await killSession(name)
    }
  })

  function fresh(suffix: string): string {
    const name = sessionNameFor(`test-${suffix}-${crypto.randomUUID()}`)
    names.push(name)
    return name
  }

  it('creates, finds, and kills a session on the dedicated socket', async () => {
    expect(await tmuxAvailable()).toBe(true)
    const name = fresh('life')
    await createSession({ name, cwd: '/tmp', cols: 80, rows: 24, shell: '/bin/sh' })
    expect((await runTmux(['show-options', '-gv', 'mouse'])).stdout.trim()).toBe('on')

    expect(await hasSession(name)).toBe(true)
    await killSession(name)
    expect(await hasSession(name)).toBe(false)
    expect(await hasSession('ra-term-does-not-exist')).toBe(false)
    expect(TMUX_SOCKET).toBe('remote-agent-terminal')
  })

  it('runs the shell with an allowlisted environment, not the bridge environment', async () => {
    process.env.RA_TEST_SECRET = 'do-not-leak'
    try {
      const name = fresh('env')
      await createSession({ name, cwd: '/tmp', cols: 80, rows: 24, shell: '/bin/sh' })
      await runTmux(['send-keys', '-t', `=${name}:`, 'echo "[$RA_TEST_SECRET]" done-marker', 'Enter'])

      await sleepUntil(async () => (await captureScreen(name, 50)).includes('done-marker'))
      const screen = await captureScreen(name, 50)
      expect(screen).toContain('[]')
      expect(screen).not.toContain('do-not-leak')
    } finally {
      delete process.env.RA_TEST_SECRET
    }
  })

  it('starts the shell in the directory it is given', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ra-tmux-cwd-'))
    try {
      const name = fresh('cwd')
      await createSession({ name, cwd: dir, cols: 80, rows: 24, shell: '/bin/sh' })
      await runTmux(['send-keys', '-t', `=${name}:`, 'pwd; echo pwd-marker', 'Enter'])

      await sleepUntil(async () => (await captureScreen(name, 50)).includes('pwd-marker'))
      expect(await captureScreen(name, 50)).toContain(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports a clear error for a directory that does not exist, and creates nothing', async () => {
    const name = fresh('bad-cwd')
    let caught: unknown = null
    try {
      await createSession({ name, cwd: '/definitely/not/a/dir/ra', cols: 80, rows: 24, shell: '/bin/sh' })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(TmuxError)
    expect(await hasSession(name)).toBe(false)
  })

  it('refuses ids that are not safe tmux names, before any process runs', () => {
    expect(() => sessionNameFor('a;rm -rf /')).toThrow('invalid session id')
    expect(() => sessionNameFor('has space')).toThrow('invalid session id')
    expect(() => sessionNameFor('')).toThrow('invalid session id')
    expect(sessionNameFor('term-abc123')).toBe('ra-term-term-abc123')
  })

  it('attaches with an argv array, never a shell string', () => {
    const argv = attachArgv('ra-term-x')
    expect(argv).toEqual(['tmux', '-L', 'remote-agent-terminal', 'attach-session', '-t', '=ra-term-x'])
    expect(argv.some(part => part.includes(' '))).toBe(false)
  })
})

describe('foreground commands', () => {
  it('reads the first pane of each session and skips blank lines', () => {
    const parsed = parseForegroundCommands('ra-term-a\tvim\nra-term-a\tzsh\nra-term-b\tzsh\n\nno-tab-here\n')
    expect([...parsed]).toEqual([
      ['ra-term-a', 'vim'],
      ['ra-term-b', 'zsh'],
    ])
  })

  it('ignores a pane with no command', () => {
    expect([...parseForegroundCommands('ra-term-a\t\n')]).toEqual([])
  })
})
