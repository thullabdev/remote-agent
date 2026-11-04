import { beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { QuestionItem } from '../../mod/remote-agent/hooks/protocol.ts'
import type { ButtonData, ChannelHandlers, InboundCommand, InboundText } from '../../src/channel/types.ts'
import { createApi } from '../../src/web/api.ts'
import { Inbound } from '../../src/bridge/inbound.ts'
import { Launcher } from '../../src/bridge/launcher.ts'
import { AwayMode, Notifier } from '../../src/bridge/notifier.ts'
import { PromptService } from '../../src/bridge/prompts.ts'
import { BAD_MODEL, CONFIG_UNREADABLE, NOT_TRUSTED, Spawner } from '../../src/bridge/spawner.ts'
import { Store } from '../../src/bridge/store.ts'
import { TrustedFolders } from '../../src/bridge/trusted.ts'
import { ChatLog } from '../../src/web/chat-log.ts'
import { WebChannel } from '../../src/web/web-channel.ts'
import type { PushSubscriptionRecord } from '../../src/web/protocol.ts'
import { flush } from '../support/fake-channel.ts'
import { FakeTmux } from '../support/fake-tmux.ts'

type Api = ReturnType<typeof createApi>
type ApiDeps = Parameters<typeof createApi>[0]

let clock = 1_000
let store: Store
let chatLog: ChatLog
let channel: WebChannel
let away: AwayMode
let api: Api
let handlers: ChannelHandlers | null
let pushDeps: ApiDeps['push']
let spawnerDep: ApiDeps['spawner']
let projectsDep: ApiDeps['projects']
let tmux: FakeTmux
let home: string
let configPath: string
const pushCalls: { subscribed: PushSubscriptionRecord[]; unsubscribed: string[] } = { subscribed: [], unsubscribed: [] }
const logged: string[] = []
const spawnerCalls: (string | null)[] = []
const handled: { buttons: ButtonData[]; texts: InboundText[]; commands: InboundCommand[] } = { buttons: [], texts: [], commands: [] }

const single: QuestionItem = { question: 'DB?', header: 'DB', multiSelect: false, options: [{ label: 'SQLite', description: '' }, { label: 'Postgres', description: '' }] }

function fakeHandlers(): ChannelHandlers {
  return {
    onButton: async press => {
      handled.buttons.push(press)
      return 'Answered: SQLite'
    },
    onText: async message => {
      handled.texts.push(message)
      return 'Answered: Postgres'
    },
    onCommand: async command => {
      handled.commands.push(command)
      return command.name === 'status' ? 'Away mode: off' : null
    },
  }
}

function stubSpawner(): ApiDeps['spawner'] {
  return {
    end: async thread => {
      spawnerCalls.push(thread)
      return 'Session ended.'
    },
    newCommand: async () => null,
    fork: async () => 'Forking api. Open its topic.',
  }
}

function build(): void {
  api = createApi({
    chatLog,
    handlers: () => handlers,
    store,
    away,
    spawner: spawnerDep,
    projects: projectsDep,
    sink: channel,
    log: message => {
      logged.push(message)
    },
    push: pushDeps,
  })
}

/** Swaps the stub for a real Spawner over a temp home with one trusted folder (`api`) and one untrusted (`secret`). */
async function useRealSpawner(): Promise<void> {
  home = await realpath(await mkdtemp(`${tmpdir()}/ra-api-`))
  await mkdir(`${home}/Sites/api`, { recursive: true })
  await mkdir(`${home}/Sites/secret`, { recursive: true })
  configPath = `${home}/.claude.json`
  await writeFile(configPath, JSON.stringify({ projects: {
    [`${home}/Sites/api`]: { hasTrustDialogAccepted: true },
    [`${home}/Sites/secret`]: { hasTrustDialogAccepted: false },
  } }))
  tmux = new FakeTmux()
  const trusted = new TrustedFolders({ configPath, home, projects: ['~/Sites/api', '~/Sites/secret'] })
  const notifier = new Notifier(store, channel, away, message => logged.push(message), channel)
  spawnerDep = new Spawner({
    store,
    channel,
    notifier,
    launcher: new Launcher(tmux.run),
    trusted,
    log: () => {},
    schedule: () => () => {},
    sleep: async () => {},
    newId: () => crypto.randomUUID(),
  })
  projectsDep = () => trusted.configuredProjects()
  build()
}

function req(method: string, path: string, body?: unknown, raw?: string): Request {
  const init: RequestInit = { method, headers: { 'content-type': 'application/json' } }
  if (raw !== undefined) {
    init.body = raw
  } else if (body !== undefined) {
    init.body = JSON.stringify(body)
  }
  return new Request(`http://localhost${path}`, init)
}

async function call(method: string, path: string, body?: unknown, raw?: string): Promise<{ status: number; body: any }> {
  const response = await api(req(method, path, body, raw))
  if (response === null) {
    throw new Error(`${path} was not handled by the API`)
  }
  return { status: response.status, body: await response.json() }
}

function seedSession(id = 's1'): string {
  store.upsertSession({ sessionId: id, cwd: '/home/u/app' })
  const session = store.getSession(id)
  if (session === undefined) {
    throw new Error('seed failed')
  }
  channel.sessionSeen(session)
  const chatId = store.getSession(id)?.chatId
  if (chatId === null || chatId === undefined) {
    throw new Error('session has no chat')
  }
  return chatId
}

beforeEach(() => {
  clock = 1_000
  logged.length = 0
  spawnerCalls.length = 0
  handled.buttons.length = 0
  handled.texts.length = 0
  handled.commands.length = 0
  store = new Store(':memory:', () => clock)
  chatLog = new ChatLog(store, () => clock)
  channel = new WebChannel(chatLog, message => logged.push(message), store)
  away = new AwayMode(false)
  handlers = fakeHandlers()
  spawnerDep = stubSpawner()
  projectsDep = undefined
  pushDeps = undefined
  pushCalls.subscribed.length = 0
  pushCalls.unsubscribed.length = 0
  build()
})

test('returns null for a path outside /api', async () => {
  expect(await api(req('GET', '/index.html'))).toBeNull()
})

test('GET /api/state returns seq, away and General first', async () => {
  const chatId = seedSession()
  await channel.createThread('older')
  chatLog.appendMessage(chatId, { kind: 'system', text: 'hello' })
  away.set(true)

  const { status, body } = await call('GET', '/api/state')

  expect(status).toBe(200)
  expect(body.seq).toBe(chatLog.currentSeq())
  expect(body.away).toBe(true)
  expect(body.chats[0].id).toBe('general')
  expect(body.chats.map((chat: { id: string }) => chat.id)).toContain(chatId)
  expect(body.chats[1].id).toBe(chatId)
})

test('messages paginate with before/limit', async () => {
  const thread = await channel.createThread('app')
  const seqs = [1, 2, 3, 4, 5].map(index => chatLog.appendMessage(thread, { kind: 'system', text: `m${index}` }).seq)

  const first = await call('GET', `/api/chats/${thread}/messages?limit=2`)
  expect(first.body.messages.map((message: { text: string }) => message.text)).toEqual(['m4', 'm5'])
  expect(first.body.hasMore).toBe(true)

  const older = await call('GET', `/api/chats/${thread}/messages?before=${seqs[3]}&limit=2`)
  expect(older.body.messages.map((message: { text: string }) => message.text)).toEqual(['m2', 'm3'])
  expect(older.body.hasMore).toBe(true)
})

test('POST messages in a session chat enqueues an instruction and returns a queued user_text', async () => {
  const chatId = seedSession()

  const { status, body } = await call('POST', `/api/chats/${chatId}/messages`, { clientId: 'c1', text: 'run the tests' })

  expect(status).toBe(200)
  expect(body.message).toMatchObject({ chatId, kind: 'user_text', text: 'run the tests', status: 'queued' })
  expect(store.listPendingInstructions('s1')).toHaveLength(1)
  expect(handled.texts).toHaveLength(0)
})

test('the same clientId twice returns one message and queues one instruction', async () => {
  const chatId = seedSession()

  const first = await call('POST', `/api/chats/${chatId}/messages`, { clientId: 'c1', text: 'run the tests' })
  const second = await call('POST', `/api/chats/${chatId}/messages`, { clientId: 'c1', text: 'run the tests' })

  expect(second.body.message.id).toBe(first.body.message.id)
  expect(store.listPendingInstructions('s1')).toHaveLength(1)
  expect(chatLog.listMessages(chatId, { limit: 50 }).messages).toHaveLength(1)
})

test('a queued user_text becomes delivered when its instruction is delivered', async () => {
  const chatId = seedSession()
  const sent = await call('POST', `/api/chats/${chatId}/messages`, { clientId: 'c9', text: 'go' })

  channel.instructionDelivered(store.listPendingInstructions('s1')[0]!.id)

  const current = chatLog.findMessage(sent.body.message.id)
  expect(current).toMatchObject({ kind: 'user_text', status: 'delivered' })
})

test('POST messages "/status" in General runs the command and a command_reply appears', async () => {
  const { status, body } = await call('POST', '/api/chats/general/messages', { clientId: 'g1', text: '/status' })

  expect(status).toBe(200)
  expect(body.message).toMatchObject({ chatId: 'general', kind: 'user_text', text: '/status', status: 'delivered', instructionId: null })
  expect(handled.commands).toEqual([{ name: 'status', args: '', thread: null }])
  const replies = chatLog.listMessages('general', { limit: 50 }).messages.filter(message => message.kind === 'command_reply')
  expect(replies.map(message => (message.kind === 'command_reply' ? message.text : ''))).toEqual(['Away mode: off'])
})

test('General text without a slash gets the command hint and runs no command', async () => {
  await call('POST', '/api/chats/general/messages', { clientId: 'g2', text: 'hello there' })

  expect(handled.commands).toHaveLength(0)
  const replies = chatLog.listMessages('general', { limit: 50 }).messages.filter(message => message.kind === 'command_reply')
  expect(replies.map(message => (message.kind === 'command_reply' ? message.text : ''))).toEqual([
    'Send a command like /new, /status, /away, /back.',
  ])
})

test('the same General clientId twice runs the command once', async () => {
  await call('POST', '/api/chats/general/messages', { clientId: 'g3', text: '/status' })
  await call('POST', '/api/chats/general/messages', { clientId: 'g3', text: '/status' })

  expect(handled.commands).toHaveLength(1)
})

test('actions with an option index answers the prompt via onButton', async () => {
  const chatId = seedSession()

  const { status, body } = await call('POST', `/api/chats/${chatId}/actions`, { promptId: 'p1', questionIndex: 0, optionIndex: 1 })

  expect(status).toBe(200)
  expect(body).toEqual({ toast: 'Answered: SQLite' })
  expect(handled.buttons).toEqual([{ kind: 'answer', promptId: 'p1', questionIndex: 0, optionIndex: 1 }])
})

test('actions with a picker choice call onButton with a launch button', async () => {
  const chatId = seedSession()

  const { body } = await call('POST', `/api/chats/${chatId}/actions`, { pickerId: 'pk1', choice: 2 })

  expect(body).toEqual({ toast: 'Answered: SQLite' })
  expect(handled.buttons).toEqual([{ kind: 'launch', pickerId: 'pk1', choice: 2 }])
})

test('two simultaneous actions on the same prompt: exactly one accepted toast and one "Already answered.", and the prompt message ends answered once', async () => {
  const notifier = new Notifier(store, channel, away, message => logged.push(message), channel)
  const prompts = new PromptService(store, notifier, { reminderAfterMs: 60_000, now: () => clock, log: message => logged.push(message) })
  const inbound = new Inbound(store, prompts, notifier)
  handlers = inbound
  build()
  prompts.create({ promptId: 'q:1', session: { sessionId: 's1', cwd: '/home/u/app' }, body: { kind: 'question', questions: [single] } })
  await flush()
  const chatId = store.getSession('s1')?.chatId
  if (chatId === null || chatId === undefined) {
    throw new Error('session has no chat')
  }
  const press = { promptId: 'q:1', questionIndex: 0, optionIndex: 1 }

  const [first, second] = await Promise.all([call('POST', `/api/chats/${chatId}/actions`, press), call('POST', `/api/chats/${chatId}/actions`, press)])
  await flush()

  const toasts = [first.body.toast, second.body.toast].sort()
  expect(toasts).toEqual(['Already answered.', 'Answered: Postgres'])
  const prompt = chatLog.listMessages(chatId, { limit: 50 }).messages.filter(message => message.kind === 'prompt')
  expect(prompt).toHaveLength(1)
  expect(prompt[0]).toMatchObject({ kind: 'prompt', status: 'answered' })
})

test('reply with free text resolves a question', async () => {
  const chatId = seedSession()
  const messageRef = chatLog.appendMessage(chatId, { kind: 'system', text: 'question' }).id
  store.insertPrompt('q:9', 's1', { kind: 'question', questions: [single] })
  store.addPromptMessage('q:9', messageRef, 0)

  const { status, body } = await call('POST', '/api/prompts/q:9/reply', { questionIndex: 0, text: 'use Postgres' })

  expect(status).toBe(200)
  expect(body).toEqual({ toast: 'Answered: Postgres' })
  expect(handled.texts).toEqual([{ thread: chatId, replyTo: messageRef, text: 'use Postgres' }])
})

test('reply to an unknown prompt or question index returns 404', async () => {
  seedSession()
  expect((await call('POST', '/api/prompts/nope/reply', { questionIndex: 0, text: 'x' })).status).toBe(404)
  store.insertPrompt('q:8', 's1', { kind: 'question', questions: [single] })
  expect((await call('POST', '/api/prompts/q:8/reply', { questionIndex: 3, text: 'x' })).status).toBe(404)
})

test('read moves the cursor and unread drops', async () => {
  const chatId = seedSession()
  chatLog.appendMessage(chatId, { kind: 'agent_text', markdown: 'one' })
  const last = chatLog.appendMessage(chatId, { kind: 'agent_text', markdown: 'two' })
  expect(chatLog.getChat(chatId)?.unread).toBe(2)

  const { status, body } = await call('POST', `/api/chats/${chatId}/read`, { seq: last.seq })

  expect(status).toBe(200)
  expect(body).toEqual({ ok: true })
  expect(chatLog.getChat(chatId)?.unread).toBe(0)
})

test('PUT /api/away flips the flag', async () => {
  const { status, body } = await call('PUT', '/api/away', { away: true })

  expect(status).toBe(200)
  expect(body).toEqual({ away: true })
  expect(away.isAway()).toBe(true)
})

test('end on a non-spawned session returns 409', async () => {
  const chatId = seedSession()

  const { status, body } = await call('POST', `/api/chats/${chatId}/end`)

  expect(status).toBe(409)
  expect(body.error).toBe('Only sessions started by the Bridge can be ended remotely.')
  expect(spawnerCalls).toHaveLength(0)
})

test('end on a spawned session ends it through the spawner and returns its toast', async () => {
  store.createSpawnedSession({ id: 's2', cwd: '/home/u/app', tmuxName: 'ra-2' })
  channel.sessionSeen(store.getSession('s2')!)
  const chatId = store.getSession('s2')!.chatId!
  const threadId = store.getSession('s2')!.threadId

  const { status, body } = await call('POST', `/api/chats/${chatId}/end`)

  expect(status).toBe(200)
  expect(body).toEqual({ toast: 'Session ended.' })
  expect(spawnerCalls).toEqual([threadId])
})

test('an unknown chat id returns 404', async () => {
  expect((await call('GET', '/api/chats/nope/messages')).status).toBe(404)
  expect((await call('POST', '/api/chats/nope/messages', { clientId: 'c', text: 'hi' })).status).toBe(404)
  expect((await call('POST', '/api/chats/nope/read', { seq: 1 })).status).toBe(404)
  expect((await call('POST', '/api/chats/nope/end')).status).toBe(404)
})

test('invalid JSON returns 400', async () => {
  const chatId = seedSession()

  const { status, body } = await call('POST', `/api/chats/${chatId}/messages`, undefined, '{not json')

  expect(status).toBe(400)
  expect(typeof body.error).toBe('string')
})

test('a body that fails the schema returns 400', async () => {
  const chatId = seedSession()

  expect((await call('POST', `/api/chats/${chatId}/messages`, { clientId: 'c1' })).status).toBe(400)
  expect((await call('PUT', '/api/away', { away: 'yes' })).status).toBe(400)
})

test('a session chat that has ended refuses a new message with 409', async () => {
  const chatId = seedSession()
  store.endSession('s1')

  const { status, body } = await call('POST', `/api/chats/${chatId}/messages`, { clientId: 'c1', text: 'hi' })

  expect(status).toBe(409)
  expect(body).toEqual({ error: 'This session has ended.' })
})

test('General returns 503 when no handlers are attached', async () => {
  handlers = null

  expect((await call('POST', '/api/chats/general/messages', { clientId: 'g', text: '/status' })).status).toBe(503)
})

test('an unknown /api route answers JSON 404', async () => {
  const { status, body } = await call('GET', '/api/nothing-here')

  expect(status).toBe(404)
  expect(typeof body.error).toBe('string')
})

const pushSubscription = { endpoint: 'https://push.example/device', keys: { p256dh: 'p256', auth: 'auth' } }

function usePush(): void {
  pushDeps = {
    publicKey: () => 'vapid-public',
    subscribe: sub => {
      pushCalls.subscribed.push(sub)
    },
    unsubscribe: endpoint => {
      pushCalls.unsubscribed.push(endpoint)
    },
  }
  build()
}

test('routes answer 404 when push is not configured', async () => {
  expect((await call('GET', '/api/push/key')).status).toBe(404)
  expect((await call('POST', '/api/push/subscriptions', { subscription: pushSubscription })).status).toBe(404)
  expect((await call('DELETE', '/api/push/subscriptions', { endpoint: pushSubscription.endpoint })).status).toBe(404)
})

test('push routes return the key, register and unregister a device', async () => {
  usePush()
  expect(await call('GET', '/api/push/key')).toEqual({ status: 200, body: { key: 'vapid-public' } })
  const subscribed = await call('POST', '/api/push/subscriptions', { subscription: { ...pushSubscription, expirationTime: null } })
  expect(subscribed).toEqual({ status: 200, body: { ok: true } })
  expect(pushCalls.subscribed).toEqual([pushSubscription])
  const removed = await call('DELETE', '/api/push/subscriptions', { endpoint: pushSubscription.endpoint })
  expect(removed).toEqual({ status: 200, body: { ok: true } })
  expect(pushCalls.unsubscribed).toEqual([pushSubscription.endpoint])
})

test('a non-https subscription is rejected with 400', async () => {
  usePush()
  const response = await call('POST', '/api/push/subscriptions', {
    subscription: { endpoint: 'http://push.example/device', keys: { p256dh: 'p256', auth: 'auth' } },
  })
  expect(response.status).toBe(400)
  expect(pushCalls.subscribed).toEqual([])
})

test('projects lists only trusted configured folders', async () => {
  await useRealSpawner()
  const { status, body } = await call('GET', '/api/projects')
  expect(status).toBe(200)
  expect(body).toEqual({ projects: [{ label: 'api', cwd: `${home}/Sites/api` }] })
})

test('start rejects an untrusted cwd with the NOT_TRUSTED text', async () => {
  await useRealSpawner()
  const { status, body } = await call('POST', '/api/projects/start', { cwd: `${home}/Sites/secret` })
  expect(status).toBe(409)
  expect(body).toEqual({ error: NOT_TRUSTED })
  expect(tmux.calls).toEqual([])
})

test('start passes the model through and refuses a bad model or a missing cwd', async () => {
  await useRealSpawner()
  const started = await call('POST', '/api/projects/start', { cwd: `${home}/Sites/api`, model: 'opus' })
  expect(started.status).toBe(200)
  expect(started.body).toEqual({ toast: '🚀 Starting api with opus. Open its topic.' })
  expect(tmux.calls[0]?.slice(-2)).toEqual(['--model', 'opus'])

  const bad = await call('POST', '/api/projects/start', { cwd: `${home}/Sites/api`, model: 'gpt-5' })
  expect(bad.status).toBe(400)
  expect(bad.body).toEqual({ error: BAD_MODEL })

  expect((await call('POST', '/api/projects/start', {})).status).toBe(400)
  expect((await call('POST', '/api/projects/start', { cwd: 'relative/path' })).status).toBe(400)
  expect(tmux.calls).toHaveLength(1)
})

test('clear hides history and a later message shows', async () => {
  const chatId = seedSession()
  chatLog.appendMessage(chatId, { kind: 'system', text: 'old' })
  const cleared = await call('POST', `/api/chats/${chatId}/clear`)
  expect(cleared).toEqual({ status: 200, body: { ok: true } })
  expect((await call('GET', `/api/chats/${chatId}/messages`)).body.messages).toEqual([])
  chatLog.appendMessage(chatId, { kind: 'system', text: 'new' })
  const after = await call('GET', `/api/chats/${chatId}/messages`)
  expect(after.body.messages.map((message: { text: string }) => message.text)).toEqual(['new'])
})

test('clear of an unknown chat is 404', async () => {
  expect((await call('POST', '/api/chats/nope/clear')).status).toBe(404)
})

test('fork starts a spawned session with the resume flags (fake tmux argv assertion) and creates a new chat', async () => {
  await useRealSpawner()
  store.upsertSession({ sessionId: 's1', cwd: `${home}/Sites/api` })
  channel.sessionSeen(store.getSession('s1')!)
  const chatId = store.getSession('s1')!.chatId!

  const { status, body } = await call('POST', `/api/chats/${chatId}/fork`)
  expect(status).toBe(200)
  expect(body).toEqual({ toast: 'Forking api. Open its topic.' })

  const argv = tmux.calls[0] ?? []
  const newId = argv[argv.indexOf('--session-id') + 1]!
  expect(newId).not.toBe('s1')
  expect(argv.slice(-6)).toEqual(['claude', '--resume', 's1', '--fork-session', '--session-id', newId])
  const forked = store.getSession(newId)!
  expect(forked).toMatchObject({ spawned: true, cwd: `${home}/Sites/api` })
  expect(forked.chatId).not.toBe(chatId)
  expect(chatLog.getChat(forked.chatId!)).toMatchObject({ spawned: true })
  expect(chatLog.listChats().filter(chat => chat.id !== 'general')).toHaveLength(2)
})

test('fork of an unknown chat is 404', async () => {
  expect((await call('POST', '/api/chats/nope/fork')).status).toBe(404)
  const general = await call('POST', '/api/chats/general/fork')
  expect(general.status).toBe(404)
})

test('fork of a session whose cwd is no longer trusted is 409', async () => {
  await useRealSpawner()
  store.upsertSession({ sessionId: 's1', cwd: `${home}/Sites/api` })
  channel.sessionSeen(store.getSession('s1')!)
  const chatId = store.getSession('s1')!.chatId!
  await writeFile(configPath, JSON.stringify({ projects: {} }))

  const { status, body } = await call('POST', `/api/chats/${chatId}/fork`)
  expect(status).toBe(409)
  expect(body).toEqual({ error: NOT_TRUSTED })
  expect(tmux.calls).toEqual([])
})

test('start and fork answer 503 with the text when the trusted folders cannot be read', async () => {
  await useRealSpawner()
  store.upsertSession({ sessionId: 's1', cwd: `${home}/Sites/api` })
  channel.sessionSeen(store.getSession('s1')!)
  const chatId = store.getSession('s1')!.chatId!
  await writeFile(configPath, 'this is not json')

  const started = await call('POST', '/api/projects/start', { cwd: `${home}/Sites/api` })
  expect(started.status).toBe(503)
  expect(started.body).toEqual({ error: CONFIG_UNREADABLE })
  const forked = await call('POST', `/api/chats/${chatId}/fork`)
  expect(forked.status).toBe(503)
  expect(forked.body).toEqual({ error: CONFIG_UNREADABLE })
  expect(tmux.calls).toEqual([])
})

test('routes answer 404 when the projects dep is absent', async () => {
  expect((await call('GET', '/api/projects')).status).toBe(404)
  expect((await call('POST', '/api/projects/start', { cwd: '/x' })).status).toBe(404)
})
