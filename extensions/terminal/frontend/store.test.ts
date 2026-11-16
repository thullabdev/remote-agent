import { describe, it, expect, beforeEach } from 'bun:test'
import { addSession, applySessionsFrame, currentSessions, eventsSocketUrl, removeSession, resetSessionsForTesting, terminalOf } from './store.ts'

describe('terminal session store', () => {
  beforeEach(() => {
    resetSessionsForTesting()
  })

  it('adds a session first, and replaces one with the same id instead of duplicating it', () => {
    addSession(terminalOf({ sid: 'a', cwd: '/x' }))
    addSession(terminalOf({ sid: 'b', cwd: '/y' }))
    addSession(terminalOf({ sid: 'a', cwd: '/x', createdAt: 5 }))

    expect(currentSessions().map(session => session.id)).toEqual(['a', 'b'])
  })

  it('removes a session by id', () => {
    addSession(terminalOf({ sid: 'a', cwd: '/x' }))
    removeSession('a')

    expect(currentSessions().map(session => session.id)).toEqual([])
  })

  it('maps the server view, including whether a browser has it open', () => {
    expect(terminalOf({ sid: 'a', cwd: '/x', attached: true, chatId: 'c', createdAt: 9 })).toEqual({
      id: 'a',
      cwd: '/x',
      login: '',
      connected: true,
      chatId: 'c',
      createdAt: 9,
    })
    expect(terminalOf({ sid: 'b', cwd: '/y' }).connected).toBe(false)
  })
})

describe('session events from the server', () => {
  beforeEach(() => {
    resetSessionsForTesting()
  })

  const view = { sid: 'a', cwd: '/x', project: 'x', chatId: null, createdAt: 3, lastAttachedAt: null, attached: true }

  it('replaces the list with a sessions frame, and reports the attached state', () => {
    addSession(terminalOf({ sid: 'stale', cwd: '/old' }))

    expect(applySessionsFrame(JSON.stringify({ type: 'sessions', sessions: [view] }))).toBe(true)

    expect(currentSessions()).toEqual([{ id: 'a', cwd: '/x', login: '', connected: true, chatId: null, createdAt: 3 }])
  })

  it('ignores frames it does not know, and anything that is not JSON', () => {
    addSession(terminalOf({ sid: 'kept', cwd: '/x' }))

    expect(applySessionsFrame('not json')).toBe(false)
    expect(applySessionsFrame(JSON.stringify({ type: 'output', data: 'x' }))).toBe(false)
    expect(applySessionsFrame(JSON.stringify({ type: 'sessions', sessions: 'nope' }))).toBe(false)

    expect(currentSessions().map(session => session.id)).toEqual(['kept'])
  })

  it('subscribes on the extension route, with wss on https', () => {
    expect(eventsSocketUrl({ protocol: 'http:', host: 'localhost:8787' } as Location)).toBe('ws://localhost:8787/api/extensions/remote-agent.terminal/events')
    expect(eventsSocketUrl({ protocol: 'https:', host: 'agent.example.ts.net' } as Location)).toBe('wss://agent.example.ts.net/api/extensions/remote-agent.terminal/events')
  })
})

