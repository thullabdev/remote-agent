import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import type { Server } from 'bun'
import { onActivate, onDeactivate, TERMINAL_WS_PATH } from './index.ts'

type Handlers = {
  open?: (ws: unknown) => void
  message?: (ws: unknown, raw: string | Buffer) => void
  close?: (ws: unknown) => void
}

const OWNER = 'owner@example.com'

describe('terminal WebSocket route', () => {
  let server: Server<unknown>
  let url: string
  let handlers: Handlers

  beforeAll(() => {
    process.env.REMOTE_AGENT_WEB_ALLOWED_LOGIN = OWNER
    process.env.SHELL = '/bin/sh'
    let captured: Handlers | undefined
    onActivate({
      frontend: { registerPanel: () => {} },
      backend: {
        registerHttpRoute: () => {},
        registerWebSocketRoute: (path, routeHandlers) => {
          expect(path).toBe(TERMINAL_WS_PATH)
          captured = routeHandlers as Handlers
        },
      },
    })
    if (captured === undefined) {
      throw new Error('route not registered')
    }
    handlers = captured
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request, srv) {
        return srv.upgrade(request, { data: {} }) ? undefined : new Response('no upgrade', { status: 400 })
      },
      websocket: {
        open: ws => handlers.open?.(ws),
        message: (ws, raw) => handlers.message?.(ws, raw as string | Buffer),
        close: ws => handlers.close?.(ws),
      },
    })
    url = `ws://127.0.0.1:${server.port}/`
  })

  afterAll(() => {
    server.stop(true)
    onDeactivate()
    delete process.env.REMOTE_AGENT_WEB_ALLOWED_LOGIN
  })

  /** A client that records every message and can wait for one that matches. */
  function connect() {
    const messages: Array<Record<string, unknown>> = []
    const socket = new WebSocket(url)
    socket.onmessage = event => {
      messages.push(JSON.parse(String(event.data)))
    }
    const ready = new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve()
      socket.onerror = () => reject(new Error('socket error'))
    })
    async function until(predicate: (all: Array<Record<string, unknown>>) => boolean, timeoutMs = 5000) {
      const started = Date.now()
      while (!predicate(messages)) {
        if (Date.now() - started > timeoutMs) {
          throw new Error(`timed out; received ${JSON.stringify(messages)}`)
        }
        await Bun.sleep(20)
      }
    }
    return { socket, messages, ready, until }
  }

  it('opens a shell, returns output, and replays it on reattach from a new connection', async () => {
    const sid = `sid-${crypto.randomUUID()}`
    const first = connect()
    await first.ready
    first.socket.send(JSON.stringify({ type: 'open', sid, cols: 80, rows: 24 }))
    await first.until(all => all.some(m => m.type === 'ready'))
    first.socket.send(JSON.stringify({ type: 'input', sid, data: 'echo ws-$((6*7))\n' }))
    await first.until(all => all.some(m => m.type === 'output' && String(m.data).includes('ws-42')))

    first.socket.close()
    await Bun.sleep(50)

    const second = connect()
    await second.ready
    second.socket.send(JSON.stringify({ type: 'open', sid, cols: 80, rows: 24 }))
    await second.until(all => all.some(m => m.type === 'replay'))
    const replay = second.messages.find(m => m.type === 'replay')
    expect(String(replay?.data)).toContain('ws-42')
    expect(second.messages.find(m => m.type === 'ready')).toMatchObject({ created: false })

    second.socket.send(JSON.stringify({ type: 'close', sid }))
    second.socket.close()
  })

  it('starts the shell in the cwd it is given and reports it back', async () => {
    const sid = `sid-${crypto.randomUUID()}`
    const client = connect()
    await client.ready
    client.socket.send(JSON.stringify({ type: 'open', sid, cols: 80, rows: 24, cwd: '/tmp' }))
    await client.until(all => all.some(m => m.type === 'ready'))
    expect(client.messages.find(m => m.type === 'ready')).toMatchObject({ cwd: '/tmp', created: true })
    client.socket.send(JSON.stringify({ type: 'close', sid }))
    client.socket.close()
  })

  it('rejects a frame that does not match the protocol, without opening anything', async () => {
    const client = connect()
    await client.ready
    client.socket.send(JSON.stringify({ type: 'open', sid: '../../etc', cols: 80, rows: 24 }))
    await client.until(all => all.some(m => m.type === 'error'))
    expect(client.messages.some(m => m.type === 'ready')).toBe(false)
    client.socket.close()
  })

  it('refuses input for a session that is not open on this connection', async () => {
    const client = connect()
    await client.ready
    client.socket.send(JSON.stringify({ type: 'input', sid: 'sid-not-open', data: 'x' }))
    await client.until(all => all.some(m => m.type === 'error'))
    expect(client.messages[0]).toMatchObject({ type: 'error', sid: 'sid-not-open' })
    client.socket.close()
  })
})
