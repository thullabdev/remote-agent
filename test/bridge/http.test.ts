import { beforeEach, expect, test } from 'bun:test'
import { createHandler } from '../../src/bridge/http.ts'
import { Inbound } from '../../src/bridge/inbound.ts'
import { AwayMode, Notifier } from '../../src/bridge/notifier.ts'
import { PromptService } from '../../src/bridge/prompts.ts'
import { Store } from '../../src/bridge/store.ts'
import { FakeChannel, flush } from '../support/fake-channel.ts'

const session = { sessionId: 's1', cwd: '/home/u/app' }
const permissionRequest = { promptId: 'p:toolu_1', session, body: { kind: 'permission', tool: 'Bash', input: { command: 'rm -rf build' } } }

let handle: (request: Request) => Promise<Response>
let channel: FakeChannel
let inbound: Inbound
let store: Store
let logged: string[]

function call(method: string, path: string, body?: unknown): Promise<Response> {
  return handle(new Request(`http://bridge${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) }))
}

beforeEach(() => {
  store = new Store(':memory:')
  channel = new FakeChannel()
  const notifier = new Notifier(store, channel, new AwayMode(true))
  const prompts = new PromptService(store, notifier, { reminderAfterMs: 60_000 })
  inbound = new Inbound(store, prompts, notifier)
  logged = []
  handle = createHandler({ prompts, notifier, store, log: message => logged.push(message) })
})

test('health', async () => {
  expect(await (await call('GET', '/health')).json()).toEqual({ ok: true })
})

test('remote answer reaches a long-polling session', async () => {
  expect(await (await call('POST', '/prompts', permissionRequest)).json()).toEqual({ status: 'pending' })
  await flush()
  expect(channel.prompts).toHaveLength(1)
  const polling = call('GET', '/prompts/p%3Atoolu_1?waitMs=5000')
  await inbound.onButton({ promptId: 'p:toolu_1', questionIndex: 0, optionIndex: 0 })
  expect(await (await polling).json()).toEqual({ status: 'answered', answer: { kind: 'permission', decision: 'allow' }, source: 'remote' })
})

test('a late local answer is rejected and told the winner', async () => {
  await call('POST', '/prompts', permissionRequest)
  await inbound.onButton({ promptId: 'p:toolu_1', questionIndex: 0, optionIndex: 1 })
  const response = await call('POST', '/prompts/p%3Atoolu_1/answer', { answer: { kind: 'permission', decision: 'allow' } })
  expect(await response.json()).toEqual({ accepted: false, state: { status: 'answered', answer: { kind: 'permission', decision: 'deny' }, source: 'remote' } })
})

test('a local answer resolves the telegram message', async () => {
  await call('POST', '/prompts', permissionRequest)
  await flush()
  const response = await call('POST', '/prompts/p%3Atoolu_1/answer', { answer: { kind: 'permission', decision: 'allow' } })
  expect(((await response.json()) as { accepted: boolean }).accepted).toBe(true)
  await flush()
  expect(channel.resolved.map(resolved => resolved.note)).toEqual(['✅ Allowed (local)'])
})

test('waitMs is capped and pending is returned on timeout', async () => {
  await call('POST', '/prompts', permissionRequest)
  const started = Date.now()
  expect(await (await call('GET', '/prompts/p%3Atoolu_1?waitMs=30')).json()).toEqual({ status: 'pending' })
  expect(Date.now() - started).toBeLessThan(1_000)
})

test('unknown prompts are 404', async () => {
  expect((await call('GET', '/prompts/nope')).status).toBe(404)
  expect((await call('POST', '/prompts/nope/answer', { answer: { kind: 'permission', decision: 'allow' } })).status).toBe(404)
})

test('malformed bodies and mismatched kinds are 400', async () => {
  expect((await call('POST', '/prompts', { promptId: 'x' })).status).toBe(400)
  await call('POST', '/prompts', permissionRequest)
  expect((await call('POST', '/prompts/p%3Atoolu_1/answer', { answer: { kind: 'question', answers: {} } })).status).toBe(400)
})

test('reports are accepted asynchronously', async () => {
  const response = await call('POST', '/reports', { session, report: { kind: 'turn_complete', text: 'done', durationMs: 2_000, isAborted: false } })
  expect(response.status).toBe(202)
  await flush()
  expect(channel.texts.map(sent => sent.text)).toEqual(['✅ Turn finished after 2s\n\ndone'])
})

test('instructions are listed until acknowledged', async () => {
  store.upsertSession(session)
  store.setSessionThread('s1', 't1')
  await inbound.onText({ thread: 't1', replyTo: null, text: 'continue' })
  const [instruction] = (await (await call('GET', '/sessions/s1/instructions')).json()) as { id: string; text: string }[]
  expect(instruction?.text).toBe('continue')
  expect((await call('POST', `/instructions/${instruction!.id}/delivered`)).status).toBe(204)
  expect(await (await call('GET', '/sessions/s1/instructions')).json()).toEqual([])
  expect((await call('POST', '/instructions/nope/delivered')).status).toBe(404)
  await flush()
  expect(channel.texts.at(-1)?.text).toBe('📨 Delivered: continue')
})

test('unknown routes are 404', async () => {
  expect((await call('GET', '/nope')).status).toBe(404)
})
