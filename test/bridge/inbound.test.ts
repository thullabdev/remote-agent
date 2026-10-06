import { beforeEach, expect, test } from 'bun:test'
import type { QuestionItem } from '../../mod/remote-agent/hooks/protocol.ts'
import { Inbound, parseQuestionReply } from '../../src/bridge/inbound.ts'
import { AwayMode, Notifier } from '../../src/bridge/notifier.ts'
import { PromptService } from '../../src/bridge/prompts.ts'
import { Store } from '../../src/bridge/store.ts'
import { FakeChannel, flush } from '../support/fake-channel.ts'

const session = { sessionId: 's1', cwd: '/home/u/app' }
const single: QuestionItem = { question: 'DB?', header: 'DB', multiSelect: false, options: [{ label: 'SQLite', description: '' }, { label: 'Postgres', description: '' }] }
const multi: QuestionItem = { question: 'Extras?', header: 'X', multiSelect: true, options: [{ label: 'Docs', description: '' }, { label: 'Tests', description: '' }, { label: 'CI', description: '' }] }

let store: Store
let channel: FakeChannel
let prompts: PromptService
let notifier: Notifier
let inbound: Inbound

beforeEach(async () => {
  store = new Store(':memory:')
  channel = new FakeChannel()
  notifier = new Notifier(store, channel, new AwayMode(true))
  prompts = new PromptService(store, notifier, { reminderAfterMs: 60_000 })
  inbound = new Inbound(store, prompts, notifier)
})

test('parseQuestionReply maps numbers to labels and keeps free text', () => {
  expect(parseQuestionReply(single, '2')).toBe('Postgres')
  expect(parseQuestionReply(single, ' use MySQL ')).toBe('use MySQL')
  expect(parseQuestionReply(single, '1,2')).toBe('1,2')
  expect(parseQuestionReply(single, '9')).toBe('9')
  expect(parseQuestionReply(multi, '1, 3')).toBe('Docs, CI')
})

test('permission buttons answer allow/deny and a double tap is refused', async () => {
  prompts.create({ promptId: 'p:1', session, body: { kind: 'permission', tool: 'Bash', input: {} } })
  expect(await inbound.onButton({ promptId: 'p:1', questionIndex: 0, optionIndex: 0 })).toBe('Allowed')
  expect(await inbound.onButton({ promptId: 'p:1', questionIndex: 0, optionIndex: 1 })).toBe('Already answered.')
  expect(prompts.state('p:1')).toEqual({ status: 'answered', answer: { kind: 'permission', decision: 'allow' }, source: 'remote' })
})

test('question buttons record the chosen label', async () => {
  prompts.create({ promptId: 'q:1', session, body: { kind: 'question', questions: [single] } })
  expect(await inbound.onButton({ promptId: 'q:1', questionIndex: 0, optionIndex: 1 })).toBe('Answered: Postgres')
  expect(prompts.state('q:1')).toMatchObject({ status: 'answered', answer: { answers: { 'DB?': 'Postgres' } } })
})

test('unknown prompts and options are reported', async () => {
  expect(await inbound.onButton({ promptId: 'nope', questionIndex: 0, optionIndex: 0 })).toBe('This prompt no longer exists.')
  prompts.create({ promptId: 'q:1', session, body: { kind: 'question', questions: [single] } })
  expect(await inbound.onButton({ promptId: 'q:1', questionIndex: 0, optionIndex: 5 })).toBe('Unknown option.')
})

test('reply to a question message answers it', async () => {
  prompts.create({ promptId: 'q:1', session, body: { kind: 'question', questions: [multi] } })
  await flush()
  const ref = channel.prompts[0]!.refs[0]!
  expect(await inbound.onText({ thread: 't1', replyTo: ref, text: '2,3' })).toBe('Answered: Tests, CI')
})

test('reply to a permission message: words allow/deny, anything else denies with feedback', async () => {
  prompts.create({ promptId: 'p:1', session, body: { kind: 'permission', tool: 'Bash', input: {} } })
  prompts.create({ promptId: 'p:2', session, body: { kind: 'permission', tool: 'Bash', input: {} } })
  await flush()
  expect(await inbound.onText({ thread: 't1', replyTo: channel.prompts[0]!.refs[0]!, text: 'Yes' })).toBe('Allowed')
  expect(await inbound.onText({ thread: 't1', replyTo: channel.prompts[1]!.refs[0]!, text: 'use pnpm instead' })).toBe('Denied')
  expect(prompts.state('p:2')).toMatchObject({ answer: { decision: 'deny', message: 'use pnpm instead' } })
})

test('other text in a session thread is queued as an instruction', async () => {
  store.upsertSession(session)
  store.setSessionThread('s1', 't1')
  expect(await inbound.onText({ thread: 't1', replyTo: null, text: 'now add tests' })).toBe('📥 Queued. It will be sent when the session is idle.')
  expect(store.listPendingInstructions('s1').map(instruction => instruction.text)).toEqual(['now add tests'])
})

test('text outside a session thread is refused', async () => {
  expect(await inbound.onText({ thread: null, replyTo: null, text: 'hi' })).toBe('Send instructions inside a session topic.')
  expect(await inbound.onText({ thread: 'gone', replyTo: null, text: 'hi' })).toBe('This session has ended.')
})

test('commands toggle away mode and report status', async () => {
  expect(await inbound.onCommand({ name: 'back', thread: null })).toBe('🏠 Away mode off: only prompts will be sent.')
  expect(notifier.away.isAway()).toBe(false)
  expect(await inbound.onCommand({ name: 'away', thread: null })).toBe('🛫 Away mode on: prompts and reports will be sent.')
  store.upsertSession(session)
  prompts.create({ promptId: 'p:1', session, body: { kind: 'permission', tool: 'Bash', input: {} } })
  expect(await inbound.onCommand({ name: 'status', thread: null })).toBe('Away mode: on\nActive sessions: 1\n• app · s1\nPending prompts: 1')
  expect(await inbound.onCommand({ name: 'nope', thread: null })).toBe('Unknown command. Try /away, /back or /status.')
})
