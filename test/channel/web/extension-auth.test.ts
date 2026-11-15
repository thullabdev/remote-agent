import { describe, it, expect } from 'bun:test'
import { authorize } from '../../../src/channel/web/auth.ts'

const allowedLogin = 'user@example.com'
const origins = ['https://box.tail.ts.net']
const config = { allowedLogin, origins, token: null }

describe('extension route auth', () => {
  it('refuses a WebSocket upgrade with missing Tailscale login', () => {
    const req = new Request('http://127.0.0.1:8787/api/extensions/remote-agent.terminal/ws', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        Origin: 'https://box.tail.ts.net',
      },
    })
    const result = authorize(req, config)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(401)
    expect(result.reason).toBe('missing identity')
  })

  it('refuses a WebSocket upgrade with a disallowed login', () => {
    const req = new Request('http://127.0.0.1:8787/api/extensions/remote-agent.terminal/ws', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        Origin: 'https://box.tail.ts.net',
        'Tailscale-User-Login': 'evil@example.com',
      },
    })
    const result = authorize(req, config)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(403)
    expect(result.reason).toBe('login not allowed')
  })

  it('allows an allowlisted login on an allowed origin', () => {
    const req = new Request('http://127.0.0.1:8787/api/extensions/remote-agent.terminal/ws', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        Origin: 'https://box.tail.ts.net',
        'Tailscale-User-Login': 'user@example.com',
      },
    })
    const result = authorize(req, config)
    expect(result.ok).toBe(true)
  })

  it('refuses an extension WebSocket upgrade from a disallowed origin', () => {
    const req = new Request('http://127.0.0.1:8787/api/extensions/remote-agent.terminal/ws', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        Origin: 'https://evil.example.com',
        'Tailscale-User-Login': 'user@example.com',
      },
    })
    const result = authorize(req, config)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(403)
    expect(result.reason).toBe('origin not allowed')
  })
})
