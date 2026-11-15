import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import type { Server } from 'bun'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validatePluginManifest } from '../../../src/extension-sdk/index.ts'
import { createExtensionStorageHost } from '../../../src/channel/web/extension-storage.ts'
import pluginJson from '../plugin.json'
import { onActivate, onDeactivate, TERMINAL_WS_PATH } from './index.ts'
import { createSessionRepository, type SessionRepository } from './sessions.ts'
import { createSession, hasSession, killSession, runTmux, sessionNameFor } from './tmux.ts'

type Handlers = {
  open?: (ws: unknown) => void
  message?: (ws: unknown, raw: string | Buffer) => void
  close?: (ws: unknown) => void
}

const OWNER = 'owner@example.com'

async function until(check: () => boolean, timeoutMs = 8000): Promise<void> {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('timed out')
    }
    await Bun.sleep(40)
  }
}

describe('terminal WebSocket route on stored sessions', () => {
  let server: Server<unknown>
  let url: string
  let handlers: Handlers
  let repo: SessionRepository
  let dir: string
  const created: string[] = []

  beforeAll(() => {
    process.env.REMOTE_AGENT_WEB_ALLOWED_LOGIN = OWNER
    process.env.SHELL = '/bin/sh'
    dir = mkdtempSync(join(tmpdir(), 'ra-ws-'))
    const db = new Database(':memory:', { strict: true })
    const manifest = validatePluginManifest(pluginJson)
    const host = createExtensionStorageHost(db)
    host.prepare(manifest, [])
    const storage = host.storageFor(manifest)
    repo = createSessionRepository(storage, Date.now)

    let captured: Handlers | undefined
    onActivate({
      frontend: { registerPanel: () => {} },
      backend: {
        storage,
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

  afterAll(async () => {
    server.stop(true)
    onDeactivate()
    for (const name of created.splice(0)) {
      await killSession(name)
    }
    rmSync(dir, { recursive: true, force: true })
    delete process.env.REMOTE_AGENT_WEB_ALLOWED_LOGIN
  })

  afterEach(() => {
    // Each test opens its own sockets and closes them; nothing to do between tests.
  })

  /** Creates a real tmux session and its stored row, as the HTTP route would. */
  async function sessionFor(owner = OWNER, cwd = dir): Promise<{ sid: string; name: string }> {
    const sid = `term-${crypto.randomUUID()}`
    const name = sessionNameFor(sid)
    await createSession({ name, cwd, cols: 80, rows: 24, shell: '/bin/sh' })
    created.push(name)
    repo.create({ sid, owner, launchCwd: cwd, chatId: null, tmuxName: name })
    return { sid, name }
  }

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
    const send = (message: Record<string, unknown>) => socket.send(JSON.stringify(message))
    const find = (type: string) => messages.find(m => m.type === type)
    return { socket, messages, ready, send, find }
  }

  it('attaches to the stored session and reports the stored folder, not one the client sends', async () => {
    const { sid, name } = await sessionFor()
    await runTmux(['send-keys', '-t', `=${name}:`, 'echo before-reload-marker', 'Enter'])
    await Bun.sleep(300)
    const client = connect()
    await client.ready

    client.send({ type: 'open', sid, cols: 80, rows: 24, cwd: '/etc' })

    await until(() => client.find('replay') !== undefined)
    expect(client.find('ready')).toMatchObject({ sid, cwd: dir, created: false })
    expect(String(client.find('replay')?.data)).toContain('before-reload-marker')
    client.socket.close()
  })

  it('carries input to the shell and output back', async () => {
    const { sid } = await sessionFor()
    const client = connect()
    await client.ready
    client.send({ type: 'open', sid, cols: 80, rows: 24 })
    await until(() => client.find('replay') !== undefined)

    client.send({ type: 'input', sid, data: 'echo ws-$((6*7))\r' })

    await until(() => client.messages.some(m => m.type === 'output' && String(m.data).includes('ws-42')))
    client.socket.close()
  })

  it('says not found for an unknown id, a closed one, and another owner\'s', async () => {
    const other = await sessionFor('someone@else.com')
    const closed = await sessionFor()
    repo.close(closed.sid, 'user')
    const client = connect()
    await client.ready

    client.send({ type: 'open', sid: 'term-nope', cols: 80, rows: 24 })
    client.send({ type: 'open', sid: closed.sid, cols: 80, rows: 24 })
    client.send({ type: 'open', sid: other.sid, cols: 80, rows: 24 })

    await until(() => client.messages.filter(m => m.type === 'error').length === 3)
    for (const error of client.messages.filter(m => m.type === 'error')) {
      expect(error.code).toBe('not_found')
    }
    expect(client.find('ready')).toBeUndefined()
    client.socket.close()
  })

  it('marks a session missing when its tmux session is gone, and refuses to open it', async () => {
    const { sid, name } = await sessionFor()
    await killSession(name)
    const client = connect()
    await client.ready

    client.send({ type: 'open', sid, cols: 80, rows: 24 })

    await until(() => client.find('error') !== undefined)
    expect(client.find('error')).toMatchObject({ code: 'not_found' })
    expect(repo.get(sid)?.closeReason).toBe('missing')
    client.socket.close()
  })

  it('kills the tmux session and records the close when the owner closes it', async () => {
    const { sid, name } = await sessionFor()
    const client = connect()
    await client.ready
    client.send({ type: 'open', sid, cols: 80, rows: 24 })
    await until(() => client.find('replay') !== undefined)

    client.send({ type: 'close', sid })

    await until(() => repo.get(sid)?.closedAt !== null)
    expect(repo.get(sid)?.closeReason).toBe('user')
    expect(await hasSession(name)).toBe(false)
    client.socket.close()
  })

  it('keeps the shell running when the socket goes, and reattaches to it', async () => {
    const { sid, name } = await sessionFor()
    const first = connect()
    await first.ready
    first.send({ type: 'open', sid, cols: 80, rows: 24 })
    await until(() => first.find('replay') !== undefined)
    first.socket.close()
    await Bun.sleep(300)

    expect(await hasSession(name)).toBe(true)
    expect(repo.get(sid)?.lastAttachedAt).not.toBeNull()

    const second = connect()
    await second.ready
    second.send({ type: 'open', sid, cols: 80, rows: 24 })
    await until(() => second.find('ready') !== undefined)
    expect(second.find('ready')).toMatchObject({ sid, created: false })
    second.socket.close()
  })

  it('refuses a second open on the same socket, and rejects a frame that breaks the protocol', async () => {
    const { sid } = await sessionFor()
    const client = connect()
    await client.ready

    client.send({ type: 'open', sid, cols: 80, rows: 24 })
    await until(() => client.find('replay') !== undefined)
    client.send({ type: 'open', sid, cols: 80, rows: 24 })
    client.send({ type: 'open', sid: '../../etc', cols: 80, rows: 24 })

    await until(() => client.messages.filter(m => m.type === 'error').length >= 2)
    const errors = client.messages.filter(m => m.type === 'error').map(m => String(m.message))
    expect(errors).toContain('this connection already has a terminal open')
    expect(errors).toContain('invalid terminal message')
    client.socket.close()
  })
})
