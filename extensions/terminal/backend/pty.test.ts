import { describe, it, expect } from 'bun:test'
import { EventEmitter } from 'node:events'
import { createPtyManager } from './pty.ts'

function mockBridge() {
  const sent: any[] = []
  const stdout = new EventEmitter()
  return {
    sent,
    stdin: {
      write(data: string) {
        sent.push(JSON.parse(data))
      },
    },
    stdout,
    kill() {
      // noop
    },
    simulateOutput(sid: string, data: string) {
      stdout.emit('data', JSON.stringify({ type: 'output', sid, data }) + '\n')
    },
  }
}

describe('createPtyManager', () => {
  it('opens a session, forwards input, and closes', () => {
    const bridge = mockBridge()
    const mgr = createPtyManager({
      maxSessions: 2,
      idleAfterMs: 60_000,
      spawnBridge: () => bridge,
    })

    const sid = mgr.open('sid-1', 80, 24, '/tmp', 'user')
    expect(sid).toBe('sid-1')
    expect(bridge.sent).toContainEqual({ type: 'open', sid: 'sid-1', cols: 80, rows: 24, cwd: '/tmp' })

    mgr.input('sid-1', 'echo hi\r')
    expect(bridge.sent).toContainEqual({ type: 'input', sid: 'sid-1', data: 'echo hi\r' })

    mgr.close('sid-1')
    expect(bridge.sent).toContainEqual({ type: 'close', sid: 'sid-1' })

    // Reopening the same sid after close works (detach did not kill the PTY).
    const sid2 = mgr.open('sid-1', 80, 24, '/tmp', 'user')
    expect(sid2).toBe('sid-1')
  })

  it('reattaches an existing session without throwing (replay)', () => {
    const bridge = mockBridge()
    const mgr = createPtyManager({
      maxSessions: 2,
      idleAfterMs: 60_000,
      spawnBridge: () => bridge,
    })

    mgr.open('sid-1', 80, 24, '/tmp', 'user')
    // Reopening the same sid reattaches; the bridge sends replay then live output.
    const sid2 = mgr.open('sid-1', 80, 24, '/tmp', 'user')
    expect(sid2).toBe('sid-1')
    expect(bridge.sent).toHaveLength(2) // two 'open' forwards
    expect(bridge.sent[0]).toEqual({ type: 'open', sid: 'sid-1', cols: 80, rows: 24, cwd: '/tmp' })
    expect(bridge.sent[1]).toEqual({ type: 'open', sid: 'sid-1', cols: 80, rows: 24, cwd: '/tmp' })
  })

  it('enforces max sessions per user', () => {
    const bridge = mockBridge()
    const mgr = createPtyManager({
      maxSessions: 1,
      idleAfterMs: 60_000,
      spawnBridge: () => bridge,
    })

    mgr.open('sid-1', 80, 24, '/tmp', 'user')
    expect(() => mgr.open('sid-2', 80, 24, '/tmp', 'user')).toThrow('max sessions')
  })

  it('emits output received from the bridge to subscribers', () => {
    const bridge = mockBridge()
    const mgr = createPtyManager({
      maxSessions: 2,
      idleAfterMs: 60_000,
      spawnBridge: () => bridge,
    })

    let received: string[] = []
    mgr.onOutput('sid-1', data => received.push(data))
    mgr.open('sid-1', 80, 24, '/tmp', 'user')

    // Simulate the bridge sending output to stdout.
    bridge.simulateOutput('sid-1', 'hello\r\n')
    expect(received).toContain('hello\r\n')
  })

  it('stops accepting input after close', () => {
    const bridge = mockBridge()
    const mgr = createPtyManager({
      maxSessions: 2,
      idleAfterMs: 60_000,
      spawnBridge: () => bridge,
    })

    mgr.open('sid-1', 80, 24, '/tmp', 'user')
    mgr.close('sid-1')
    expect(() => mgr.input('sid-1', 'echo hi\r')).toThrow('not found')
  })
})
