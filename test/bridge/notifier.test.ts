import { beforeEach, expect, test } from 'bun:test'
import type { PromptBody } from '../../mod/remote-agent/hooks/protocol.ts'
import { AwayMode, Notifier } from '../../src/bridge/notifier.ts'
import { Store } from '../../src/bridge/store.ts'
import { FakeChannel } from '../support/fake-channel.ts'

const session = { sessionId: 'abcdef1234', cwd: '/home/u/app' }
const permission: PromptBody = { kind: 'permission', tool: 'Bash', input: { command: 'ls' } }

let store: Store
let channel: FakeChannel
let notifier: Notifier

beforeEach(() => {
  store = new Store(':memory:')
  channel = new FakeChannel()
  notifier = new Notifier(store, channel, new AwayMode(true))
  store.upsertSession(session)
})

function addPrompt(id: string) {
  store.insertPrompt(id, session.sessionId, permission)
  return store.getPrompt(id)!
}

test('creates one thread for concurrent prompts', async () => {
  channel.createThreadDelayMs = 20
  await Promise.all([notifier.promptCreated(addPrompt('p:1')), notifier.promptCreated(addPrompt('p:2'))])
  expect(channel.threads).toEqual([{ ref: 't1', title: 'app · abcdef12', closed: false }])
  expect(channel.prompts.map(sent => sent.thread)).toEqual(['t1', 't1'])
  expect(store.getSession(session.sessionId)?.threadId).toBe('t1')
  expect(store.findPromptMessage(channel.prompts[0]!.refs[0]!)).toEqual({ promptId: 'p:1', questionIndex: 0 })
})

test('promptResolved removes buttons once and posts the note', async () => {
  await notifier.promptCreated(addPrompt('p:1'))
  store.resolvePrompt('p:1', { kind: 'permission', decision: 'allow' }, 'local')
  await notifier.promptResolved(store.getPrompt('p:1')!)
  await notifier.promptResolved(store.getPrompt('p:1')!)
  expect(channel.resolved).toEqual([{ thread: 't1', messages: channel.prompts[0]!.refs, note: '✅ Allowed (local)' }])
})

test('a prompt answered before its message was sent is marked resolved right after sending', async () => {
  const prompt = addPrompt('p:1')
  store.resolvePrompt('p:1', { kind: 'permission', decision: 'deny' }, 'local')
  await notifier.promptResolved(store.getPrompt('p:1')!)
  await notifier.promptCreated(prompt)
  expect(channel.resolved).toHaveLength(1)
  expect(channel.resolved[0]!.note).toBe('❌ Denied (local)')
})

test('reminder replies to the prompt message', async () => {
  await notifier.promptCreated(addPrompt('p:1'))
  await notifier.promptReminder(store.getPrompt('p:1')!)
  expect(channel.texts.at(-1)).toEqual({ thread: 't1', text: '⏰ Still waiting for your answer (app · abcdef12)', replyTo: channel.prompts[0]!.refs[0]! })
})

test('turn reports are sent only in away mode', async () => {
  await notifier.report({ session, report: { kind: 'turn_complete', text: 'ok', durationMs: 1_000, isAborted: false } })
  expect(channel.texts.map(sent => sent.text)).toEqual(['✅ Turn finished after 1s\n\nok'])
  notifier.away.set(false)
  await notifier.report({ session, report: { kind: 'turn_complete', text: 'ok', durationMs: 1_000, isAborted: false } })
  expect(channel.texts).toHaveLength(1)
})

test('session end closes and forgets the thread', async () => {
  await notifier.report({ session, report: { kind: 'session_started' } })
  await notifier.report({ session, report: { kind: 'session_ended', reason: 'exit' } })
  expect(channel.threads[0]!.closed).toBe(true)
  expect(channel.texts.map(sent => sent.text)).toEqual(['🟢 Session started in /home/u/app', '⚪ Session ended (exit)'])
  const ended = store.getSession(session.sessionId)!
  expect(ended.threadId).toBeNull()
  expect(ended.endedAt).not.toBeNull()
})

test('session end closes the thread silently when not away', async () => {
  await notifier.ensureThread(session.sessionId)
  notifier.away.set(false)
  await notifier.report({ session, report: { kind: 'session_ended', reason: 'clear' } })
  expect(channel.threads[0]!.closed).toBe(true)
  expect(channel.texts).toEqual([])
})

test('instructionDelivered confirms in the thread', async () => {
  await notifier.ensureThread(session.sessionId)
  const instruction = store.enqueueInstruction(session.sessionId, 'add tests')
  await notifier.instructionDelivered(instruction)
  expect(channel.texts.at(-1)?.text).toBe('📨 Delivered: add tests')
})
