import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AwayMode } from '../../src/bridge/notifier.ts'
import { Store } from '../../src/bridge/store.ts'
import { ChatLog } from '../../src/web/chat-log.ts'
import { Hub } from '../../src/web/hub.ts'
import type { PushSubscriptionRecord } from '../../src/web/protocol.ts'
import { loadOrCreateVapid, PushService } from '../../src/web/push.ts'

type Sent = { subscription: PushSubscriptionRecord; payload: string; options: { urgency: 'high' | 'normal'; ttlSeconds: number } }

let clock = 1_000
let store: Store
let chatLog: ChatLog
let hub: Hub
let away: AwayMode
let sent: Sent[]
let logged: string[]
let status: (subscription: PushSubscriptionRecord) => Promise<{ status: number }>

const VAPID = { publicKey: 'pub-key', privateKey: 'priv-key', subject: 'mailto:ops@example.com' }
const subOf = (name: string): PushSubscriptionRecord => ({
  endpoint: `https://push.example/${name}`,
  keys: { p256dh: `p256dh-${name}`, auth: `auth-${name}` },
})

function service(): PushService {
  return new PushService({
    chatLog,
    hub,
    away,
    vapid: VAPID,
    send: async (subscription, payload, options) => {
      sent.push({ subscription, payload, options })
      return status(subscription)
    },
    log: message => {
      logged.push(message)
    },
  })
}

const prompt = { kind: 'prompt' as const, chatId: 'c1', title: 'Allow Bash?', text: 'ls -la' }
const report = { kind: 'report' as const, chatId: 'c1', title: 'Done', text: 'All tests pass.' }

beforeEach(() => {
  clock = 1_000
  store = new Store(':memory:', () => clock)
  chatLog = new ChatLog(store, () => clock)
  hub = new Hub(chatLog, () => clock)
  away = new AwayMode(false)
  sent = []
  logged = []
  status = async () => ({ status: 201 })
  chatLog.addPushSubscription(subOf('a'))
})

test('prompt pushes when nobody is active', async () => {
  await service().notify(prompt)
  expect(sent.map(item => item.subscription.endpoint)).toEqual([subOf('a').endpoint])
  expect(JSON.parse(sent[0]?.payload ?? '{}')).toEqual({ chatId: 'c1', title: 'Allow Bash?', preview: 'ls -la', kind: 'prompt' })
})

test('prompt does not push while a client is visible and focused', async () => {
  const id = hub.add({ send: () => {}, close: () => {}, getBufferedAmount: () => 0 })
  hub.setPresence(id, { visible: true, focused: true, chatId: 'c1' })
  await service().notify(prompt)
  expect(sent).toEqual([])
})

test('report pushes only in Away mode', async () => {
  await service().notify(report)
  expect(sent).toEqual([])
  away.set(true)
  await service().notify(report)
  expect(sent.map(item => JSON.parse(item.payload).kind)).toEqual(['report'])
})

test('410 removes the subscription', async () => {
  status = async () => ({ status: 410 })
  await service().notify(prompt)
  expect(chatLog.listPushSubscriptions()).toEqual([])
})

test('a throwing send is swallowed and others still get the push', async () => {
  chatLog.addPushSubscription(subOf('b'))
  const push = new PushService({
    chatLog,
    hub,
    away,
    vapid: VAPID,
    send: async subscription => {
      if (subscription.endpoint === subOf('a').endpoint) {
        throw new Error('network down')
      }
      sent.push({ subscription, payload: '', options: { urgency: 'high', ttlSeconds: 3600 } })
      return { status: 201 }
    },
    log: message => {
      logged.push(message)
    },
  })
  await expect(push.notify(prompt)).resolves.toBeUndefined()
  expect(sent.map(item => item.subscription.endpoint)).toEqual([subOf('b').endpoint])
  expect(logged.length).toBe(1)
})

test('preview is at most 140 characters while the stored message stays whole', async () => {
  const text = 'x'.repeat(300)
  const message = chatLog.appendMessage('general', { kind: 'agent_text', markdown: text })
  away.set(true)
  await service().notify({ kind: 'report', chatId: 'general', title: 'Long', text })
  const payload = JSON.parse(sent[0]?.payload ?? '{}')
  expect(payload.preview.length).toBe(140)
  const stored = chatLog.listMessages('general', { limit: 10 }).messages.find(item => item.id === message.id)
  expect(stored?.kind === 'agent_text' ? stored.markdown : '').toBe(text)
})

test('urgency and ttl differ for prompts and reports', async () => {
  away.set(true)
  await service().notify(prompt)
  await service().notify(report)
  expect(sent[0]?.options).toEqual({ urgency: 'high', ttlSeconds: 3600 })
  expect(sent[1]?.options).toEqual({ urgency: 'normal', ttlSeconds: 600 })
})

test('unsubscribe removes the subscription', () => {
  chatLog.addPushSubscription(subOf('b'))
  service().unsubscribe(subOf('a').endpoint)
  expect(chatLog.listPushSubscriptions().map(item => item.endpoint)).toEqual([subOf('b').endpoint])
})

test('subscribe stores the subscription and publicKey returns the VAPID public key', () => {
  const push = service()
  push.subscribe(subOf('c'))
  expect(chatLog.listPushSubscriptions().map(item => item.endpoint)).toContain(subOf('c').endpoint)
  expect(push.publicKey()).toBe(VAPID.publicKey)
})

test('the log never contains the full endpoint or keys', async () => {
  const secret = subOf('a')
  const push = new PushService({
    chatLog,
    hub,
    away,
    vapid: VAPID,
    send: async subscription => {
      throw new Error(`failed for ${subscription.endpoint} with ${subscription.keys.p256dh} and ${subscription.keys.auth}`)
    },
    log: (message, error) => {
      logged.push(`${message} ${String(error ?? '')}`)
    },
  })
  await push.notify(prompt)
  expect(logged.length).toBe(1)
  for (const line of logged) {
    expect(line).not.toContain(secret.endpoint)
    expect(line).not.toContain(secret.keys.p256dh)
    expect(line).not.toContain(secret.keys.auth)
  }
  expect(logged[0]).toContain('push.example')
})

test('the preview cuts on code points', async () => {
  const emoji = '😀'.repeat(150)
  away.set(true)
  await service().notify({ kind: 'report', chatId: 'c1', title: 'Emoji', text: emoji })
  const preview: string = JSON.parse(sent[0]?.payload ?? '{}').preview
  expect(Array.from(preview).length).toBe(140)
  expect(preview).toBe('😀'.repeat(140))
})

test('VAPID keys are created once and reused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ra-vapid-'))
  try {
    const dataDir = join(dir, 'nested', 'data')
    const first = await loadOrCreateVapid(dataDir)
    const second = await loadOrCreateVapid(dataDir)
    expect(second).toEqual(first)
    expect(first.publicKey.length).toBeGreaterThan(0)
    expect(first.privateKey.length).toBeGreaterThan(0)
    const mode = (await stat(join(dataDir, 'vapid.json'))).mode & 0o777
    expect(mode).toBe(0o600)
    expect(JSON.parse(await readFile(join(dataDir, 'vapid.json'), 'utf8'))).toEqual(first)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a corrupt VAPID file is an error and is not regenerated', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ra-vapid-'))
  try {
    await writeFile(join(dir, 'vapid.json'), '{not json')
    await expect(loadOrCreateVapid(dir)).rejects.toThrow(/vapid\.json/)
    expect(await readFile(join(dir, 'vapid.json'), 'utf8')).toBe('{not json')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

afterEach(() => {
  store?.close()
})
