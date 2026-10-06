import { beforeEach, expect, test } from 'bun:test'
import type { CreatePromptRequest } from '../../mod/remote-agent/hooks/protocol.ts'
import { BadRequest } from '../../src/bridge/errors.ts'
import { PromptService, type PromptEvents } from '../../src/bridge/prompts.ts'
import { Store, type PromptRow } from '../../src/bridge/store.ts'
import { flush } from '../support/fake-channel.ts'

class RecordingEvents implements PromptEvents {
  created: string[] = []
  resolved: string[] = []
  reminded: string[] = []
  async promptCreated(prompt: PromptRow) {
    this.created.push(prompt.id)
  }
  async promptResolved(prompt: PromptRow) {
    this.resolved.push(prompt.id)
  }
  async promptReminder(prompt: PromptRow) {
    this.reminded.push(prompt.id)
  }
}

const session = { sessionId: 's1', cwd: '/home/u/app' }
const permission: CreatePromptRequest = { promptId: 'p:1', session, body: { kind: 'permission', tool: 'Bash', input: { command: 'ls' } } }
const twoQuestions: CreatePromptRequest = {
  promptId: 'q:1',
  session,
  body: {
    kind: 'question',
    questions: [
      { question: 'A?', header: 'A', multiSelect: false, options: [{ label: 'a1', description: '' }, { label: 'a2', description: '' }] },
      { question: 'B?', header: 'B', multiSelect: false, options: [{ label: 'b1', description: '' }, { label: 'b2', description: '' }] },
    ],
  },
}

let clock: number
let events: RecordingEvents
let service: PromptService

beforeEach(() => {
  clock = 0
  events = new RecordingEvents()
  const store = new Store(':memory:', () => clock)
  service = new PromptService(store, events, { reminderAfterMs: 30 * 60_000, now: () => clock })
})

test('create is idempotent and announces a prompt once', async () => {
  expect(service.create(permission)).toEqual({ status: 'pending' })
  expect(service.create(permission)).toEqual({ status: 'pending' })
  await flush()
  expect(events.created).toEqual(['p:1'])
})

test('first answer wins', async () => {
  service.create(permission)
  const first = service.answer('p:1', { kind: 'permission', decision: 'allow' }, 'local')
  const second = service.answer('p:1', { kind: 'permission', decision: 'deny' }, 'remote')
  expect(first?.accepted).toBe(true)
  expect(second).toEqual({ accepted: false, state: { status: 'answered', answer: { kind: 'permission', decision: 'allow' }, source: 'local' } })
  await flush()
  expect(events.resolved).toEqual(['p:1'])
})

test('answer of the wrong kind is a bad request', () => {
  service.create(permission)
  expect(() => service.answer('p:1', { kind: 'question', answers: {} }, 'local')).toThrow(BadRequest)
})

test('unknown prompts are undefined', async () => {
  expect(service.answer('nope', { kind: 'permission', decision: 'allow' }, 'local')).toBeUndefined()
  expect(await service.waitFor('nope', 10)).toBeUndefined()
})

test('waitFor resolves as soon as the prompt is answered', async () => {
  service.create(permission)
  const waiting = service.waitFor('p:1', 5_000)
  service.answer('p:1', { kind: 'permission', decision: 'deny' }, 'remote')
  expect(await waiting).toEqual({ status: 'answered', answer: { kind: 'permission', decision: 'deny' }, source: 'remote' })
})

test('waitFor returns pending after the timeout', async () => {
  service.create(permission)
  expect(await service.waitFor('p:1', 20)).toEqual({ status: 'pending' })
})

test('multi-question prompts complete when every question is answered', () => {
  service.create(twoQuestions)
  expect(service.answerQuestionPart('q:1', 0, 'a2')).toEqual({ accepted: true, state: { status: 'pending' } })
  expect(service.answerQuestionPart('q:1', 1, 'b1')).toEqual({
    accepted: true,
    state: { status: 'answered', answer: { kind: 'question', answers: { 'A?': 'a2', 'B?': 'b1' } }, source: 'remote' },
  })
  expect(service.answerQuestionPart('q:1', 0, 'a1')?.accepted).toBe(false)
})

test('answerQuestionPart rejects a bad question index', () => {
  service.create(twoQuestions)
  expect(() => service.answerQuestionPart('q:1', 7, 'x')).toThrow(BadRequest)
})

test('remindStale reminds each old pending prompt once', async () => {
  service.create(permission)
  clock = 31 * 60_000
  await service.remindStale()
  await service.remindStale()
  expect(events.reminded).toEqual(['p:1'])
})
