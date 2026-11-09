import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AwayMode } from '../../../src/bridge/notifier.ts'
import { Store } from '../../../src/bridge/store.ts'
import { ChatLog } from '../../../src/channel/web/chat-log.ts'
import { Hub } from '../../../src/channel/web/hub.ts'
import type { PushSubscriptionRecord } from '../../../src/channel/web/protocol.ts'
import { loadOrCreateVapid, PushService } from '../../../src/channel/web/push.ts'

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

test('a secret in a permission prompt is redacted in the push preview', async () => {
  const secret = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX'
  await service().notify({ kind: 'prompt', chatId: 'c1', title: 'Allow Bash?', text: `curl -H x ${secret}` })
  const payload = JSON.parse(sent[0]?.payload ?? '{}')
  expect(payload.preview).not.toContain(secret)
  expect(payload.preview).toContain('[REDACTED]')
})

test('redaction happens before the cap, so a secret straddling the 140 boundary leaks no prefix', async () => {
  const secret = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX'
  await service().notify({ kind: 'prompt', chatId: 'c1', title: 'Allow Bash?', text: `${'x'.repeat(130)} ${secret}` })
  const preview: string = JSON.parse(sent[0]?.payload ?? '{}').preview
  expect(preview).not.toContain('sk-ant')
  expect(preview).not.toContain('ABCDEF')
  expect(preview.length).toBeLessThanOrEqual(140)
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

test("a never-resolving send does not block the others and notify still resolves", async () => {
  chatLog.addPushSubscription(subOf('b'))
  const delivered: string[] = []
  const push = new PushService({
    chatLog,
    hub,
    away,
    vapid: VAPID,
    sendTimeoutMs: 20,
    send: subscription => {
      if (subscription.endpoint === subOf('a').endpoint) {
        return new Promise(() => {})
      }
      delivered.push(subscription.endpoint)
      return Promise.resolve({ status: 201 })
    },
    log: message => {
      logged.push(message)
    },
  })
  const setSpy = spyOn(globalThis, 'setTimeout')
  const clearSpy = spyOn(globalThis, 'clearTimeout')
  try {
    await push.notify(prompt)
    const started = setSpy.mock.results.map(result => result.value as unknown)
    const cleared = clearSpy.mock.calls.map(call => call[0] as unknown)
    for (const timer of started) {
      expect(cleared).toContain(timer)
    }
  } finally {
    setSpy.mockRestore()
    clearSpy.mockRestore()
  }
  expect(delivered).toEqual([subOf('b').endpoint])
  expect(chatLog.listPushSubscriptions().map(item => item.endpoint)).toContain(subOf('a').endpoint)
  expect(logged.some(line => line.includes('timed out') && line.includes('push.example'))).toBe(true)
})

test('a 404 prunes', async () => {
  status = async () => ({ status: 404 })
  await service().notify(prompt)
  expect(chatLog.listPushSubscriptions()).toEqual([])
})

test('a 500 or 429 does not prune the subscription', async () => {
  for (const code of [500, 429]) {
    status = async () => ({ status: code })
    await service().notify(prompt)
  }
  expect(chatLog.listPushSubscriptions().map(item => item.endpoint)).toEqual([subOf('a').endpoint])
})

test('a non-2xx status is logged with the host only', async () => {
  status = async () => ({ status: 500 })
  await service().notify(prompt)
  expect(logged.length).toBe(1)
  expect(logged[0]).toContain('push.example')
  expect(logged[0]).toContain('500')
  expect(logged[0]).not.toContain(subOf('a').endpoint)
  expect(logged[0]).not.toContain('/a')
})

test('a very long title keeps the payload under 4 KB', async () => {
  const longChat = 'c'.repeat(10_000)
  chatLog.createChat({ id: longChat, sessionId: null, title: 'long' })
  await service().notify({ kind: 'prompt', chatId: longChat, title: 'T'.repeat(10_000), text: 'hi' })
  const payload = sent[0]?.payload ?? ''
  expect(payload.length).toBeLessThan(4096)
  const parsed = JSON.parse(payload)
  expect(Array.from(parsed.title).length).toBe(100)
  expect(parsed.chatId.length).toBe(100)
})

test("a concurrent create keeps the first file's keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ra-vapid-'))
  try {
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => loadOrCreateVapid(dir)))
    for (const result of results) {
      expect(result).toEqual(results[0] as { publicKey: string; privateKey: string })
    }
    expect(JSON.parse(await readFile(join(dir, 'vapid.json'), 'utf8'))).toEqual(results[0])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

afterEach(() => {
  store?.close()
})

test('a prompt push carries the prompt id so the notification can open the chat at it', async () => {
  await service().notify({ ...prompt, promptId: 'p7' })
  expect(JSON.parse(sent[0]?.payload ?? '{}')).toEqual({ chatId: 'c1', title: 'Allow Bash?', preview: 'ls -la', kind: 'prompt', promptId: 'p7' })
})

test('a report push has no prompt id', async () => {
  away.set(true)
  await service().notify(report)
  expect(Object.keys(JSON.parse(sent[0]?.payload ?? '{}'))).not.toContain('promptId')
})
