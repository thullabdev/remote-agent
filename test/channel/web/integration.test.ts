import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createBridge, type Bridge } from '../../../src/bridge/app.ts'
import { loadConfig, type Config } from '../../../src/bridge/config.ts'
import { Launcher } from '../../../src/bridge/launcher.ts'
import { ChatLog } from '../../../src/channel/web/chat-log.ts'
import type { ServerEvent } from '../../../src/channel/web/protocol.ts'
import { transcriptPath } from '../../../src/channel/web/transcript/path.ts'
import { FakeTmux } from '../../support/fake-tmux.ts'

const LOGIN = 'mod@example.com'
const ORIGIN = 'https://remote-agent.example.ts.net'
const CWD = '/home/u/app'
const JSON_HEADERS = { 'content-type': 'application/json' }
const FIXTURE = join(import.meta.dir, '../../support/transcripts/finished-session.jsonl')

let home: string
let bridge: Bridge | null
let logs: string[]

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ra-int-'))
  bridge = null
  logs = []
})

afterEach(async () => {
  mock.restore()
  await bridge?.stop()
  bridge = null
  await rm(home, { recursive: true, force: true })
})

/** A web-only config from the env parser, with the web port moved to an ephemeral one (the parser accepts 1-65535 only). */
function webConfig(env: Record<string, string> = {}): Config {
  const base = loadConfig({
    HOME: home,
    REMOTE_AGENT_CHANNELS: 'web',
    REMOTE_AGENT_SOCKET: join(home, 's.sock'),
    REMOTE_AGENT_DB: join(home, 'state', 'bridge.db'),
    REMOTE_AGENT_WEB_ALLOWED_LOGIN: LOGIN,
    REMOTE_AGENT_WEB_ORIGINS: ORIGIN,
    REMOTE_AGENT_VAPID_SUBJECT: 'mailto:owner@example.com',
    ...env,
  })
  if (base.web === null) {
    throw new Error('the web channel is expected to be selected')
  }
  return { ...base, web: { ...base.web, port: 0 } }
}

async function boot(config: Config = webConfig()): Promise<Bridge> {
  const started = await createBridge(config, {
    log: message => {
      logs.push(message)
    },
    tmux: new Launcher(new FakeTmux().run),
  })
  bridge = started
  await started.start()
  return started
}

function webPort(): number {
  if (bridge?.webPort == null) {
    throw new Error('the web server is not running')
  }
  return bridge.webPort
}

/** The mod's side: HTTP over the Unix socket. */
function mod(path: string, init: RequestInit = {}): Promise<Response> {
  if (bridge === null) {
    throw new Error('the bridge is not running')
  }
  return fetch(`http://bridge${path}`, { ...init, unix: bridge.socketPath } as RequestInit)
}

/** The browser's side: HTTP on the loopback port with the identity and origin the tailnet proxy would add. */
function web(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = { Origin: ORIGIN, 'Tailscale-User-Login': LOGIN, ...(init.headers as Record<string, string> | undefined) }
  return fetch(`http://127.0.0.1:${webPort()}${path}`, { ...init, headers })
}

/** Everything one WebSocket client has received; `until` resolves on the first frame that matches, event-driven rather than polled. */
class Feed {
  readonly frames: ServerEvent[] = []
  private readonly waiters = new Set<() => void>()

  constructor(readonly socket: WebSocket) {
    socket.onmessage = event => {
      this.frames.push(JSON.parse(String(event.data)) as ServerEvent)
      for (const check of [...this.waiters]) {
        check()
      }
    }
  }

  until(predicate: (frame: ServerEvent) => boolean, what: string, timeoutMs = 5_000): Promise<ServerEvent> {
    return new Promise<ServerEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(check)
        reject(new Error(`timed out after ${timeoutMs} ms waiting for ${what}`))
      }, timeoutMs)
      const check = (): void => {
        const found = this.frames.find(predicate)
        if (found !== undefined) {
          clearTimeout(timer)
          this.waiters.delete(check)
          resolve(found)
        }
      }
      this.waiters.add(check)
      check()
    })
  }
}

function connect(query = ''): Promise<Feed> {
  const socket = new WebSocket(`ws://127.0.0.1:${webPort()}/ws${query}`, {
    headers: { Origin: ORIGIN, 'Tailscale-User-Login': LOGIN },
  } as unknown as string[])
  const feed = new Feed(socket)
  return new Promise((resolve, reject) => {
    socket.onopen = () => {
      resolve(feed)
    }
    socket.onerror = () => {
      reject(new Error('websocket failed'))
    }
  })
}

async function postPrompt(promptId: string, sessionId: string): Promise<void> {
  const response = await mod('/prompts', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      promptId,
      session: { sessionId, cwd: CWD },
      body: { kind: 'permission', tool: 'Bash', input: { command: 'ls' } },
    }),
  })
  expect(response.status).toBe(200)
}

test('a Prompt posted by the mod appears over the WebSocket, an answer reaches the long poll, and a reconnect replays nothing twice', async () => {
  await boot()
  const first = await connect()
  await postPrompt('p:int1', 'sess-int')
  const created = await first.until(
    frame => frame.type === 'message.created' && frame.message.kind === 'prompt' && frame.message.promptId === 'p:int1',
    'the prompt message',
  )
  if (created.type !== 'message.created') {
    throw new Error('unreachable')
  }
  const chatId = created.message.chatId

  const poll = mod('/prompts/p%3Aint1?waitMs=5000')
  const answered = await web(`/api/chats/${encodeURIComponent(chatId)}/actions`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ promptId: 'p:int1', questionIndex: 0, optionIndex: 0 }),
  })
  expect(answered.status).toBe(200)
  const state = await (await poll).json()
  expect(state).toMatchObject({ status: 'answered', answer: { kind: 'permission', decision: 'allow' } })
  await first.until(
    frame => frame.type === 'message.updated' && frame.message.kind === 'prompt' && frame.message.status === 'answered',
    'the answered prompt',
  )

  const lastSeq = first.frames.reduce((max, frame) => ('seq' in frame ? Math.max(max, frame.seq) : max), 0)
  first.socket.close()
  const second = await connect(`?after=${lastSeq}`)
  await postPrompt('p:int2', 'sess-int')
  await second.until(frame => frame.type === 'message.created' && frame.message.kind === 'prompt' && frame.message.promptId === 'p:int2', 'the second prompt')

  const replayed = second.frames.filter(frame => frame.type === 'message.created').map(frame => (frame.type === 'message.created' && frame.message.kind === 'prompt' ? frame.message.promptId : ''))
  expect(replayed).toEqual(['p:int2'])
  expect(second.frames.every(frame => frame.type === 'hello' || ('seq' in frame && frame.seq > lastSeq))).toBe(true)
  second.socket.close()
})

test('Telegram vars are not needed when only web is selected', async () => {
  const config = webConfig()
  expect(config.telegram).toBeNull()
  await boot(config)
  expect(bridge?.webPort).toBeGreaterThan(0)
  const health = await mod('/health')
  expect(health.status).toBe(200)
  expect(await health.json()).toEqual({ ok: true })
})

test('a web handler exception returns 500 and the Unix socket still answers /health', async () => {
  await boot()
  spyOn(ChatLog.prototype, 'listChats').mockImplementation(() => {
    throw new Error('disk gone')
  })

  const failed = await web('/api/state')
  expect(failed.status).toBe(500)
  expect(await failed.json()).toEqual({ error: 'Something went wrong.' })
  expect(logs).toContain('web API request failed')

  const health = await mod('/health')
  expect(health.status).toBe(200)
})

test('a transcript file appearing under home/.claude/projects/... is tailed into the chat', async () => {
  await boot()
  const feed = await connect()
  const reported = await mod('/reports', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ session: { sessionId: 'sess-tr', cwd: CWD }, report: { kind: 'session_started' } }),
  })
  expect(reported.status).toBe(202)
  const started = await feed.until(
    frame => frame.type === 'message.created' && frame.message.kind === 'system' && frame.message.text.startsWith('Session started'),
    'the session start message',
  )
  if (started.type !== 'message.created') {
    throw new Error('unreachable')
  }
  const chatId = started.message.chatId

  const path = transcriptPath(home, CWD, 'sess-tr')
  await mkdir(dirname(path), { recursive: true })
  await copyFile(FIXTURE, path)

  const reply = await feed.until(
    frame => frame.type === 'message.created' && frame.message.chatId === chatId && frame.message.kind === 'agent_text',
    'the agent text from the transcript',
    10_000,
  )
  expect(reply).toMatchObject({ type: 'message.created', message: { kind: 'agent_text', markdown: 'Listing them now.' } })
  feed.socket.close()
})

test('with both channels selected only the web channel starts, and the choice is logged once', async () => {
  const config = webConfig({
    REMOTE_AGENT_CHANNELS: 'telegram,web',
    TELEGRAM_BOT_TOKEN: '123456:ABC_def-ghi',
    TELEGRAM_CHAT_ID: '-1001234567890',
    TELEGRAM_ALLOWED_USER_ID: '42',
  })
  await boot(config)
  expect(bridge?.webPort).toBeGreaterThan(0)
  expect(logs.filter(line => line === 'both channels selected; starting the web channel only')).toHaveLength(1)
  const health = await mod('/health')
  expect(health.status).toBe(200)
})

test('stop with an open WebSocket closes it and does not throw', async () => {
  await boot()
  const feed = await connect()
  const closed = new Promise<void>(resolve => {
    feed.socket.onclose = () => {
      resolve()
    }
  })
  await expect(bridge?.stop()).resolves.toBeUndefined()
  bridge = null
  await closed
  expect(feed.socket.readyState).toBe(WebSocket.CLOSED)
})

test('a refused origin is logged with the origin that was sent', async () => {
  await boot()
  const response = await fetch(`http://127.0.0.1:${webPort()}/`, {
    headers: { Origin: 'https://phone.example.ts.net:8443', 'Tailscale-User-Login': LOGIN, 'Sec-Fetch-Site': 'cross-site' },
  })
  expect(response.status).toBe(403)
  expect(logs).toContain('web request refused: GET / 403 origin not allowed origin="https://phone.example.ts.net:8443" fetch-site="cross-site" fetch-mode="(absent)" fetch-dest="(absent)"')
})
