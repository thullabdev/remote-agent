import { describe, it, expect, afterEach } from 'bun:test'
import { homedir } from 'node:os'
import { createPtyManager, resolveCwd, shellEnv, type OpenRequest, type PtyManager } from './pty.ts'

const quiet = () => {}

async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('timed out waiting for condition')
    }
    await Bun.sleep(20)
  }
}

describe('createPtyManager (Bun.Terminal)', () => {
  let manager: PtyManager | null = null

  afterEach(() => {
    manager?.dispose()
    manager = null
  })

  function sessionRequest(sid: string, overrides: Partial<OpenRequest> = {}) {
    const received: string[] = []
    const exits: Array<number | null> = []
    const request: OpenRequest = {
      sid,
      cols: 80,
      rows: 24,
      cwd: '/',
      ownerLogin: 'owner@example.com',
      onOutput: data => received.push(data),
      onExit: code => exits.push(code),
      ...overrides,
    }
    return { request, received, exits }
  }

  function newManager(maxSessions = 4, idleAfterMs = 60_000): PtyManager {
    manager = createPtyManager({ maxSessions, idleAfterMs, shell: '/bin/sh', log: quiet })
    return manager
  }

  it('runs a shell, streams its output, and keeps it in the replay buffer', async () => {
    const pty = newManager()
    const { request, received } = sessionRequest('sid-echo')
    const opened = pty.open(request)
    expect(opened.created).toBe(true)

    pty.input('sid-echo', 'owner@example.com', 'echo remote-agent-$((40+2))\n')
    await waitFor(() => received.join('').includes('remote-agent-42'))

    pty.detach('sid-echo', request.onOutput)
    const reattached = pty.open(sessionRequest('sid-echo').request)
    expect(reattached.created).toBe(false)
    expect(reattached.replay).toContain('remote-agent-42')
  })

  it('rejects a second live attachment to the same session', () => {
    const pty = newManager()
    pty.open(sessionRequest('sid-dup').request)
    expect(() => pty.open(sessionRequest('sid-dup').request)).toThrow('already open')
  })

  it('lets a new connection reattach after the old one detaches, without a second shell', () => {
    const pty = newManager()
    const first = sessionRequest('sid-reattach')
    pty.open(first.request)
    pty.detach('sid-reattach', first.request.onOutput)
    const second = pty.open(sessionRequest('sid-reattach').request)
    expect(second.created).toBe(false)
  })

  it('ignores a detach from a listener that is no longer attached', () => {
    const pty = newManager()
    const first = sessionRequest('sid-stale')
    pty.open(first.request)
    pty.detach('sid-stale', first.request.onOutput)
    const second = sessionRequest('sid-stale')
    pty.open(second.request)
    pty.detach('sid-stale', first.request.onOutput)
    expect(() => pty.open(sessionRequest('sid-stale').request)).toThrow('already open')
  })

  it('refuses another user access to a session', () => {
    const pty = newManager()
    pty.open(sessionRequest('sid-owned').request)
    pty.detach('sid-owned', () => {})
    expect(() => pty.open(sessionRequest('sid-owned', { ownerLogin: 'intruder@example.com' }).request)).toThrow('another user')
    expect(() => pty.input('sid-owned', 'intruder@example.com', 'id\n')).toThrow('another user')
    expect(() => pty.close('sid-owned', 'intruder@example.com')).toThrow('another user')
    expect(pty.has('sid-owned')).toBe(true)
  })

  it('enforces the session limit', () => {
    const pty = newManager(1)
    pty.open(sessionRequest('sid-1').request)
    expect(() => pty.open(sessionRequest('sid-2').request)).toThrow('too many terminal sessions')
  })

  it('close kills the shell and forgets the session; input afterwards fails', () => {
    const pty = newManager()
    pty.open(sessionRequest('sid-close').request)
    pty.close('sid-close', 'owner@example.com')
    expect(pty.has('sid-close')).toBe(false)
    expect(() => pty.input('sid-close', 'owner@example.com', 'x')).toThrow('not found')
  })

  it('reports a shell that exits on its own and removes the session', async () => {
    const pty = newManager()
    const { request, exits } = sessionRequest('sid-exit')
    pty.open(request)
    pty.input('sid-exit', 'owner@example.com', 'exit 3\n')
    await waitFor(() => exits.length === 1)
    expect(exits).toEqual([3])
    expect(pty.has('sid-exit')).toBe(false)
  })

  it('reaps a detached session after the idle timeout', async () => {
    const pty = newManager(4, 30)
    const { request } = sessionRequest('sid-idle')
    pty.open(request)
    pty.detach('sid-idle', request.onOutput)
    await waitFor(() => !pty.has('sid-idle'))
    expect(pty.has('sid-idle')).toBe(false)
  })

  it('resolves the working directory, falling back to the home directory', () => {
    expect(resolveCwd(undefined)).toBe(homedir())
    expect(resolveCwd('')).toBe(homedir())
    expect(resolveCwd('/definitely/not/a/dir/ra-test')).toBe(homedir())
    expect(resolveCwd('/')).toBe('/')
  })

  it('passes only allowlisted variables to the shell', () => {
    process.env.REMOTE_AGENT_TEST_SECRET = 'do-not-leak'
    try {
      const env = shellEnv()
      expect(env.TERM).toBe('xterm-256color')
      expect(env).not.toHaveProperty('REMOTE_AGENT_TEST_SECRET')
    } finally {
      delete process.env.REMOTE_AGENT_TEST_SECRET
    }
  })
})
