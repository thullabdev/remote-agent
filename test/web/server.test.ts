import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WebConfig } from '../../src/bridge/config.ts'
import { Store } from '../../src/bridge/store.ts'
import { ChatLog } from '../../src/web/chat-log.ts'
import { Hub } from '../../src/web/hub.ts'
import { startWebServer } from '../../src/web/server.ts'

const ORIGIN = 'https://agent.example.ts.net'
const LOGIN = 'me@example.com'
const headers = { Origin: ORIGIN, 'Tailscale-User-Login': LOGIN }

type Running = ReturnType<typeof startWebServer>

let clock = 1_000
let chatLog: ChatLog
let hub: Hub
let staticDir: string
let root: string
let running: Running | null
let api: ReturnType<typeof mock<(request: Request) => Promise<Response | null>>>
let logs: { message: string; error: unknown }[]
const log = (message: string, error?: unknown): void => {
  logs.push({ message, error })
}

function configFor(staticPath: string | null): WebConfig {
  return {
    port: 0,
    allowedLogin: LOGIN,
    origins: [ORIGIN],
    token: null,
    staticDir: staticPath,
    vapidSubject: 'mailto:ops@example.com',
  }
}

function start(staticPath: string | null = staticDir): Running {
  running = startWebServer({
    config: configFor(staticPath),
    chatLog,
    api,
    hub,
    log,
    port: 0,
  })
  return running
}

function url(path: string): string {
  return `http://127.0.0.1:${running?.port}${path}`
}

/** Buffers every frame so a test can await the next one with a timeout. */
class Inbox {
  private readonly frames: unknown[] = []
  private readonly waiters: ((frame: unknown) => void)[] = []

  constructor(readonly socket: WebSocket) {
    socket.onmessage = event => {
      const frame = JSON.parse(String(event.data))
      const waiter = this.waiters.shift()
      if (waiter) {
        waiter(frame)
      } else {
        this.frames.push(frame)
      }
    }
  }

  next(timeoutMs = 2_000): Promise<any> {
    const queued = this.frames.shift()
    if (queued !== undefined) {
      return Promise.resolve(queued)
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no frame arrived in time')), timeoutMs)
      this.waiters.push(frame => {
        clearTimeout(timer)
        resolve(frame)
      })
    })
  }
}

function connect(path = '/ws', extra: Record<string, string> = {}): Promise<Inbox> {
  const options = { headers: { ...headers, ...extra } }
  const socket = new WebSocket(url(path).replace('http://', 'ws://'), options as unknown as string[])
  const inbox = new Inbox(socket)
  return new Promise((resolve, reject) => {
    socket.onopen = () => resolve(inbox)
    socket.onerror = () => reject(new Error('websocket failed'))
  })
}

/** Skips chat.updated and other frames so a test can read the message events it cares about. */
async function nextMessage(inbox: Inbox): Promise<any> {
  for (;;) {
    const frame = await inbox.next()
    if (frame.type === 'message.created') {
      return frame
    }
  }
}

async function eventually(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time')
    }
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

beforeEach(async () => {
  clock = 1_000
  chatLog = new ChatLog(new Store(':memory:', () => clock), () => clock)
  hub = new Hub(chatLog, () => clock)
  root = await mkdtemp(join(tmpdir(), 'web-server-'))
  staticDir = join(root, 'static')
  await mkdir(staticDir)
  await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>app</title>')
  await writeFile(join(staticDir, 'app.js'), 'console.log("app")')
  await writeFile(join(root, 'secret.txt'), 'top secret')
  api = mock(async () => null)
  logs = []
  running = null
})

afterEach(async () => {
  running?.stop()
  await rm(root, { recursive: true, force: true })
})

test('unauthorized upgrade is refused with 403', async () => {
  start()

  const response = await fetch(url('/ws'), {
    headers: { Upgrade: 'websocket', Connection: 'Upgrade', Origin: ORIGIN, 'Tailscale-User-Login': 'intruder@example.com' },
  })

  expect(response.status).toBe(403)
})

test('connect with after=current gets hello and then live message.created', async () => {
  start()
  const inbox = await connect(`/ws?after=${chatLog.currentSeq()}`)

  expect(await inbox.next()).toEqual({ type: 'hello', seq: chatLog.currentSeq() })
  chatLog.appendMessage('general', { kind: 'system', text: 'live' })

  const frame = await nextMessage(inbox)
  expect(frame.message.text).toBe('live')
  inbox.socket.close()
})

test('connect with after older replays missed events in order', async () => {
  const before = chatLog.currentSeq()
  chatLog.appendMessage('general', { kind: 'system', text: 'one' })
  chatLog.appendMessage('general', { kind: 'system', text: 'two' })
  chatLog.appendMessage('general', { kind: 'system', text: 'three' })
  start()

  const inbox = await connect(`/ws?after=${before}`)

  expect(await inbox.next()).toEqual({ type: 'hello', seq: chatLog.currentSeq() })
  const replayed = []
  for (let index = 0; index < 3; index += 1) {
    replayed.push((await nextMessage(inbox)).message.text)
  }
  expect(replayed).toEqual(['one', 'two', 'three'])
  inbox.socket.close()
})

test('connect with after greater than the server seq receives resync', async () => {
  start()
  const inbox = await connect(`/ws?after=${chatLog.currentSeq() + 1_000}`)

  expect(await inbox.next()).toEqual({ type: 'hello', seq: chatLog.currentSeq() })
  expect(await inbox.next()).toEqual({ type: 'resync' })
  inbox.socket.close()
})

test('hello is sent first then replay then live events', async () => {
  const before = chatLog.currentSeq()
  chatLog.appendMessage('general', { kind: 'system', text: 'missed' })
  start()
  const inbox = await connect(`/ws?after=${before}`)

  expect((await inbox.next()).type).toBe('hello')
  expect((await nextMessage(inbox)).message.text).toBe('missed')
  chatLog.appendMessage('general', { kind: 'system', text: 'live' })
  expect((await nextMessage(inbox)).message.text).toBe('live')
  inbox.socket.close()
})

test('a 200 KB agent_text arrives whole in one WS event', async () => {
  start()
  const inbox = await connect(`/ws?after=${chatLog.currentSeq()}`)
  await inbox.next()
  const markdown = 'x'.repeat(200 * 1024)

  chatLog.appendMessage('general', { kind: 'agent_text', markdown })

  const frame = await nextMessage(inbox)
  expect(frame.message.markdown).toBe(markdown)
  inbox.socket.close()
})

test('presence updates anyActive, and closing the socket clears it', async () => {
  start()
  const inbox = await connect(`/ws?after=${chatLog.currentSeq()}`)
  await inbox.next()

  inbox.socket.send(JSON.stringify({ type: 'presence', visible: true, focused: true, chatId: 'general' }))
  inbox.socket.send(JSON.stringify({ type: 'ping' }))
  expect(await inbox.next()).toEqual({ type: 'pong' })
  expect(hub.anyActive()).toBe(true)

  inbox.socket.close()
  await eventually(() => !hub.anyActive())
})

test('ping gets pong', async () => {
  start()
  const inbox = await connect(`/ws?after=${chatLog.currentSeq()}`)
  await inbox.next()

  inbox.socket.send(JSON.stringify({ type: 'ping' }))

  expect(await inbox.next()).toEqual({ type: 'pong' })
  inbox.socket.close()
})

test('invalid client frames are ignored', async () => {
  start()
  const inbox = await connect(`/ws?after=${chatLog.currentSeq()}`)
  await inbox.next()

  inbox.socket.send('not json {')
  inbox.socket.send(JSON.stringify({ type: 'presence', visible: 'yes' }))
  inbox.socket.send(JSON.stringify({ type: 'unknown' }))
  inbox.socket.send(JSON.stringify({ type: 'ping' }))

  expect(await inbox.next()).toEqual({ type: 'pong' })
  expect(hub.anyActive()).toBe(false)
  inbox.socket.close()
})

test('binds to 127.0.0.1', () => {
  const server = start()

  expect(server.hostname).toBe('127.0.0.1')
})

test('static file is served and unknown path falls back to index.html', async () => {
  start()

  const script = await fetch(url('/app.js'), { headers })
  expect(script.status).toBe(200)
  expect(await script.text()).toBe('console.log("app")')

  const route = await fetch(url('/chats/general'), { headers })
  expect(route.status).toBe(200)
  expect(route.headers.get('Cache-Control')).toBe('no-cache')
  expect(await route.text()).toContain('<title>app</title>')
})

test('a static GET with Sec-Fetch-Site same-origin and no Origin returns the file', async () => {
  start()

  const response = await fetch(url('/app.js'), { headers: { 'Tailscale-User-Login': LOGIN, 'Sec-Fetch-Site': 'same-origin' } })

  expect(response.status).toBe(200)
  expect(await response.text()).toBe('console.log("app")')
})

test('static path traversal is rejected', async () => {
  start()

  for (const path of ['/%2e%2e/secret.txt', '/%2e%2e%2fsecret.txt', '/..%2fsecret.txt', '/%2e%2e%5csecret.txt', '/a%00.txt', '/%2e%2e%2fsecret']) {
    const response = await fetch(url(path), { headers })
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('top secret')
  }
  // Absolute-looking paths stay inside the static dir; with no extension they fall back to index.html.
  const absolute = await fetch(url('/%2fetc%2fpasswd'), { headers })
  expect(await absolute.text()).not.toContain('top secret')
})

test('an unauthenticated /api request is 401/403 and does not reach the api', async () => {
  start()

  const response = await fetch(url('/api/state'), { headers: { Origin: ORIGIN } })

  expect([401, 403]).toContain(response.status)
  expect(api).not.toHaveBeenCalled()
})

test('an api handler that throws gives a generic 500 and is logged', async () => {
  const failure = new Error('db exploded')
  api = mock(async () => {
    throw failure
  })
  start()

  const response = await fetch(url('/api/state'), { headers })

  expect(response.status).toBe(500)
  const body = await response.text()
  expect(JSON.parse(body)).toEqual({ error: 'internal error' })
  expect(body).not.toContain('db exploded')
  expect(logs).toEqual([{ message: 'web request failed', error: failure }])
})

test('a throwing static read gives a generic 500', async () => {
  start()
  const read = spyOn(Bun, 'file').mockImplementation(() => {
    throw new Error('disk gone')
  })
  try {
    const response = await fetch(url('/app.js'), { headers })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'internal error' })
    expect(logs.map(entry => entry.message)).toEqual(['web request failed'])
  } finally {
    read.mockRestore()
  }
})

test('a failing replay in open closes the socket and leaves no client in the hub', async () => {
  start()
  const replay = spyOn(chatLog, 'eventsAfter').mockImplementation(() => {
    throw new Error('db gone')
  })
  try {
    const socket = new WebSocket(url(`/ws?after=${chatLog.currentSeq()}`).replace('http://', 'ws://'), {
      headers,
    } as unknown as string[])
    const closed = new Promise<number>(resolve => {
      socket.onclose = event => resolve(event.code)
    })

    expect(await closed).toBe(1011)
    expect(hub.clientCount()).toBe(0)
    expect(logs.map(entry => entry.message)).toEqual(['web socket handshake failed'])
  } finally {
    replay.mockRestore()
  }
})

test('a broadcast failure never propagates to the ChatLog writer', () => {
  class ThrowingHub extends Hub {
    override broadcast(): void {
      throw new Error('hub broke')
    }
  }
  hub = new ThrowingHub(chatLog, () => clock)
  start()

  const message = chatLog.appendMessage('general', { kind: 'system', text: 'still saved' })

  expect(message.seq).toBeGreaterThan(0)
  expect(logs.map(entry => entry.message)).toContain('web broadcast failed')
})

test('a failed Bun.serve leaves no subscription or timer', () => {
  const first = start()
  const subscribe = spyOn(chatLog, 'subscribe')
  const timer = spyOn(globalThis, 'setInterval')
  try {
    expect(() => startWebServer({ config: configFor(staticDir), chatLog, api, hub, log, port: first.port })).toThrow()

    expect(subscribe).not.toHaveBeenCalled()
    expect(timer).not.toHaveBeenCalled()
  } finally {
    subscribe.mockRestore()
    timer.mockRestore()
  }
})
