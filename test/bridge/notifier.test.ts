import { beforeEach, expect, test } from 'bun:test'
import type { PromptBody, Report } from '../../mod/remote-agent/hooks/protocol.ts'
import type { ChatSink } from '../../src/channel/chat-sink.ts'
import { AwayMode, Notifier } from '../../src/bridge/notifier.ts'
import { Store, type PromptRow, type SessionRow } from '../../src/bridge/store.ts'
import type { Message } from '../../src/channel/web/protocol.ts'
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

test('redeliverUndelivered re-sends a prompt whose first delivery failed', async () => {
  const sendPrompt = channel.sendPrompt.bind(channel)
  let calls = 0
  channel.sendPrompt = async (thread, view) => {
    calls += 1
    if (calls === 1) {
      throw new Error('telegram down')
    }
    return sendPrompt(thread, view)
  }
  const prompt = addPrompt('p:1')
  await expect(notifier.promptCreated(prompt)).rejects.toThrow('telegram down')
  expect(store.listPromptMessageRefs('p:1')).toEqual([])
  await notifier.redeliverUndelivered()
  expect(channel.prompts).toHaveLength(1)
  expect(store.listPromptMessageRefs('p:1')).toHaveLength(1)
  await notifier.redeliverUndelivered()
  expect(channel.prompts).toHaveLength(1)
})

test('redeliverUndelivered logs failures instead of throwing', async () => {
  const logged: string[] = []
  notifier = new Notifier(store, channel, new AwayMode(true), message => {
    logged.push(message)
  })
  channel.sendPrompt = async () => {
    throw new Error('still down')
  }
  addPrompt('p:1')
  await notifier.redeliverUndelivered()
  expect(logged).toEqual(['redelivery of p:1 failed'])
})

test('session end dismisses its pending prompts and strips their buttons', async () => {
  await notifier.promptCreated(addPrompt('p:1'))
  store.insertPrompt('q:1', session.sessionId, { kind: 'question', questions: [] })
  store.upsertSession({ sessionId: 'other', cwd: '/x' })
  store.insertPrompt('p:other', 'other', permission)
  await notifier.report({ session, report: { kind: 'session_ended', reason: 'exit' } })
  expect(store.getPrompt('p:1')).toMatchObject({
    status: 'answered',
    source: 'local',
    answer: { kind: 'permission', decision: 'deny', message: 'Session ended.' },
  })
  expect(store.getPrompt('q:1')).toMatchObject({ status: 'answered', answer: { kind: 'question', answers: {} } })
  expect(store.getPrompt('p:other')?.status).toBe('pending')
  expect(channel.resolved).toHaveLength(1)
  expect(channel.resolved[0]!.note).toBe('❌ Denied (local): Session ended.')
})

test('session end still closes the thread when the report cannot be sent', async () => {
  await notifier.ensureThread(session.sessionId)
  channel.sendText = async () => {
    throw new Error('send failed')
  }
  await expect(notifier.report({ session, report: { kind: 'session_ended', reason: 'exit' } })).rejects.toThrow('send failed')
  expect(channel.threads[0]!.closed).toBe(true)
  expect(store.getSession(session.sessionId)?.threadId).toBeNull()
})

const titled = { session, title: 'fix login' }

test('a topic created for an already named session carries the name', async () => {
  await notifier.updateTitle(titled)
  await notifier.promptCreated(addPrompt('p:1'))
  expect(channel.threads[0]!.title).toBe('app · abcdef12 · fix login')
})

test('renames an existing topic when the session name changes, and only then', async () => {
  await notifier.promptCreated(addPrompt('p:1'))
  await notifier.updateTitle(titled)
  expect(channel.threads[0]!.title).toBe('app · abcdef12 · fix login')
  channel.threads[0]!.title = 'edited by hand'
  await notifier.updateTitle(titled)
  expect(channel.threads[0]!.title).toBe('edited by hand')
  await notifier.updateTitle({ session, title: 'ship it' })
  expect(channel.threads[0]!.title).toBe('app · abcdef12 · ship it')
})

test('an empty name changes nothing', async () => {
  await notifier.promptCreated(addPrompt('p:1'))
  await notifier.updateTitle({ session, title: '  ' })
  expect(channel.threads[0]!.title).toBe('app · abcdef12')
})

test('a failed rename is logged, swallowed and retried on the next call', async () => {
  const logged: string[] = []
  notifier = new Notifier(store, channel, new AwayMode(true), message => {
    logged.push(message)
  })
  await notifier.promptCreated(addPrompt('p:1'))
  channel.renameFails = true
  await notifier.updateTitle(titled)
  expect(logged).toHaveLength(1)
  expect(channel.threads[0]!.title).toBe('app · abcdef12')
  channel.renameFails = false
  await notifier.updateTitle(titled)
  expect(channel.threads[0]!.title).toBe('app · abcdef12 · fix login')
})

test('closeSession ends the session and closes its thread silently, once', async () => {
  store.createSpawnedSession({ id: 'sp1', cwd: '/home/u/api', tmuxName: 'ra-sp1' })
  const thread = await notifier.ensureThread('sp1')
  const textsBefore = channel.texts.length
  await notifier.closeSession('sp1')
  await notifier.closeSession('sp1')
  expect(store.getSession('sp1')?.endedAt).not.toBeNull()
  expect(channel.threads.find(item => item.ref === thread)?.closed).toBe(true)
  expect(channel.texts.length).toBe(textsBefore)
  await notifier.closeSession('unknown')
})

test('late mod traffic for an ended spawned session creates no thread and keeps it ended', async () => {
  store.createSpawnedSession({ id: 'sp1', cwd: '/home/u/Sites/api', tmuxName: 'ra-sp1' })
  store.setSessionThread('sp1', 't-sp1')
  await notifier.closeSession('sp1')
  const late = { sessionId: 'sp1', cwd: '/home/u/Sites/api' }
  await notifier.report({ session: late, report: { kind: 'turn_complete', text: 'ok', durationMs: 1_000, isAborted: false } })
  store.upsertSession(late)
  store.insertPrompt('p:late', 'sp1', permission)
  await notifier.promptCreated(store.getPrompt('p:late')!)
  expect(store.getSession('sp1')?.endedAt).not.toBeNull()
  expect(store.getSession('sp1')?.threadId).toBeNull()
  expect(channel.threads).toEqual([])
  expect(channel.prompts).toEqual([])
  expect(channel.texts).toEqual([])
  expect(store.getPrompt('p:late')?.status).toBe('answered')
})

type SinkCall = string

/** Records what the Notifier asks of a ChatSink; the web channel's behaviour is tested in test/channel/web. */
class RecordingSink implements ChatSink {
  calls: SinkCall[] = []
  prompts: PromptRow[] = []
  refsToReturn = ['m-q1']
  existing: string | null = null

  existingChat(_session: SessionRow): string | null {
    return this.existing
  }

  sessionSeen(session: SessionRow): void {
    this.calls.push(`sessionSeen ${session.id}`)
  }

  promptCreated(prompt: PromptRow, _session: SessionRow): string[] {
    this.calls.push(`promptCreated ${prompt.id}`)
    this.prompts.push(prompt)
    return this.refsToReturn
  }

  promptResolved(prompt: PromptRow, refs: string[]): void {
    this.calls.push(`promptResolved ${prompt.id} ${refs.join(',')}`)
  }

  promptPartAnswered(prompt: PromptRow, ref: string, questionIndex: number, value: string): void {
    this.calls.push(`promptPartAnswered ${prompt.id} ${ref} #${questionIndex}=${value}`)
  }

  instructionQueued(): Message {
    throw new Error('not used by the Notifier')
  }

  instructionDelivered(instructionId: string): void {
    this.calls.push(`instructionDelivered ${instructionId}`)
  }

  report(_session: SessionRow, report: Report): void {
    this.calls.push(`report ${report.kind}`)
  }

  chatEnded(session: SessionRow): void {
    this.calls.push(`chatEnded ${session.id}`)
  }

  busyChanged(sessionId: string, busy: boolean): void {
    this.calls.push(`busyChanged ${sessionId} ${busy}`)
  }

  promptReminder(prompt: PromptRow, session: SessionRow): void {
    this.calls.push(`promptReminder ${prompt.id} ${session.id}`)
  }

  systemMessage(sessionId: string | null, text: string): void {
    this.calls.push(`systemMessage ${sessionId} ${text}`)
  }
}

test('report session_ended calls chatEnded and keeps the chat id', async () => {
  const sink = new RecordingSink()
  notifier = new Notifier(store, channel, new AwayMode(true), () => {}, sink)
  store.setSessionChat(session.sessionId, 'c-app')
  store.setSessionThread(session.sessionId, 'c-app')

  await notifier.report({ session, report: { kind: 'session_ended', reason: 'exit' } })

  expect(sink.calls).toEqual(['report session_ended', `chatEnded ${session.sessionId}`])
  expect(channel.texts).toEqual([])
  const ended = store.getSession(session.sessionId)!
  expect(ended.threadId).toBeNull()
  expect(ended.chatId).toBe('c-app')
  expect(ended.endedAt).not.toBeNull()
})

test('promptCreated passes the structured body to the sink', async () => {
  const sink = new RecordingSink()
  notifier = new Notifier(store, channel, new AwayMode(true), () => {}, sink)

  await notifier.promptCreated(addPrompt('p:1'))

  expect(sink.prompts.map(prompt => prompt.body)).toEqual([permission])
  expect(sink.prompts[0]!.id).toBe('p:1')
  expect(store.listPromptMessageRefs('p:1')).toEqual(['m-q1'])
  expect(channel.prompts).toEqual([])
})

test('instructionDelivered flips the message', async () => {
  const sink = new RecordingSink()
  notifier = new Notifier(store, channel, new AwayMode(true), () => {}, sink)
  const instruction = store.enqueueInstruction(session.sessionId, 'add tests')

  await notifier.instructionDelivered(instruction)

  expect(sink.calls).toEqual([`instructionDelivered ${instruction.id}`])
  expect(channel.texts).toEqual([])
})

test('promptResolved hands the prompt and its message refs to the sink', async () => {
  const sink = new RecordingSink()
  notifier = new Notifier(store, channel, new AwayMode(true), () => {}, sink)
  await notifier.promptCreated(addPrompt('p:1'))
  store.resolvePrompt('p:1', { kind: 'permission', decision: 'allow' }, 'local')

  await notifier.promptResolved(store.getPrompt('p:1')!)

  expect(sink.calls.filter(call => call.startsWith('promptResolved'))).toEqual(['promptResolved p:1 m-q1'])
  expect(channel.resolved).toEqual([])
})

test('a partly answered prompt tells the sink which question message was answered', async () => {
  const sink = new RecordingSink()
  sink.refsToReturn = ['m-q1', 'm-q2']
  notifier = new Notifier(store, channel, new AwayMode(true), () => {}, sink)
  await notifier.promptCreated(addPrompt('p:1'))

  await notifier.promptPartAnswered(store.getPrompt('p:1')!, 1, 'b2')
  await notifier.promptPartAnswered(store.getPrompt('p:1')!, 5, 'nope')

  expect(sink.calls.filter(call => call.startsWith('promptPartAnswered'))).toEqual(['promptPartAnswered p:1 m-q2 #1=b2'])
})

test('no sink: notifier behaviour is unchanged and prompts still go through the channel', async () => {
  await notifier.promptCreated(addPrompt('p:1'))

  expect(channel.prompts.map(sent => sent.thread)).toEqual(['t1'])
  expect(store.listPromptMessageRefs('p:1')).toEqual(channel.prompts[0]!.refs)
})

test('no sink: promptReminder still uses channel.sendText', async () => {
  await notifier.promptCreated(addPrompt('p:1'))

  await notifier.promptReminder(store.getPrompt('p:1')!)

  expect(channel.texts.at(-1)?.text).toBe('⏰ Still waiting for your answer (app · abcdef12)')
})

test('promptReminder with a sink hands the prompt and session to the sink, not to the channel', async () => {
  const sink = new RecordingSink()
  notifier = new Notifier(store, channel, new AwayMode(true), () => {}, sink)
  store.setSessionThread(session.sessionId, 'c-app')
  const prompt = addPrompt('p:1')

  await notifier.promptReminder(prompt)

  expect(sink.calls).toEqual([`promptReminder p:1 ${session.sessionId}`])
  expect(channel.texts).toEqual([])
})

test('AwayMode.subscribe fires only on change and survives a throwing listener', () => {
  const away = new AwayMode(false)
  const seen: boolean[] = []
  away.subscribe(() => {
    throw new Error('boom')
  })
  const unsubscribe = away.subscribe(value => {
    seen.push(value)
  })

  away.set(false)
  away.set(true)
  away.set(true)
  unsubscribe()
  away.set(false)

  expect(seen).toEqual([true])
  expect(away.isAway()).toBe(false)
})

function sinkNotifier(sink: ChatSink, logged: string[] = []): Notifier {
  return new Notifier(store, channel, new AwayMode(true), message => {
    logged.push(message)
  }, sink)
}

test('endSession closes the thread even when the sink throws', async () => {
  const sink = new RecordingSink()
  notifier = sinkNotifier(sink)
  await notifier.ensureThread(session.sessionId)
  sink.report = () => {
    throw new Error('sink report down')
  }
  sink.chatEnded = () => {
    throw new Error('sink chatEnded down')
  }
  await notifier.report({ session, report: { kind: 'session_ended', reason: 'exit' } })
  expect(channel.threads[0]!.closed).toBe(true)
  const ended = store.getSession(session.sessionId)!
  expect(ended.threadId).toBeNull()
  expect(ended.endedAt).not.toBeNull()
})

test('a throwing sink.report does not stop the Telegram-style flow', async () => {
  const sink = new RecordingSink()
  const logged: string[] = []
  notifier = sinkNotifier(sink, logged)
  sink.report = () => {
    throw new Error('sink report down')
  }
  await expect(notifier.report({ session, report: { kind: 'turn_complete', text: 'ok', durationMs: 1_000, isAborted: false } })).resolves.toBeUndefined()
  await notifier.promptCreated(addPrompt('p:1'))
  expect(sink.calls).toContain('promptCreated p:1')
  expect(store.listPromptMessageRefs('p:1')).toEqual(['m-q1'])
  expect(logged).toEqual(['chat sink report failed'])
})

test('a throwing sink.instructionDelivered is logged and does not throw', async () => {
  const sink = new RecordingSink()
  const logged: string[] = []
  notifier = sinkNotifier(sink, logged)
  sink.instructionDelivered = () => {
    throw new Error('sink down')
  }
  const instruction = store.enqueueInstruction(session.sessionId, 'add tests')
  await expect(notifier.instructionDelivered(instruction)).resolves.toBeUndefined()
  expect(logged).toEqual(['chat sink instructionDelivered failed'])
})

test('a throwing sink.promptResolved is logged and the prompt is not handed over twice', async () => {
  const sink = new RecordingSink()
  const logged: string[] = []
  notifier = sinkNotifier(sink, logged)
  await notifier.promptCreated(addPrompt('p:1'))
  store.resolvePrompt('p:1', { kind: 'permission', decision: 'allow' }, 'local')
  let calls = 0
  sink.promptResolved = () => {
    calls += 1
    throw new Error('sink down')
  }
  await expect(notifier.promptResolved(store.getPrompt('p:1')!)).resolves.toBeUndefined()
  await notifier.promptResolved(store.getPrompt('p:1')!)
  expect(calls).toBe(1)
  expect(logged).toEqual(['chat sink promptResolved failed'])
})

test('a throwing sink.sessionSeen does not fail ensureThread, and the thread is stored', async () => {
  const sink = new RecordingSink()
  const logged: string[] = []
  notifier = sinkNotifier(sink, logged)
  sink.sessionSeen = () => {
    throw new Error('sink down')
  }
  await expect(notifier.ensureThread(session.sessionId)).resolves.toBe('t1')
  expect(store.getSession(session.sessionId)?.threadId).toBe('t1')
  expect(logged).toEqual(['chat sink sessionSeen failed'])
})

test('a throwing sink.promptCreated propagates and stores no refs, so redelivery can retry', async () => {
  const sink = new RecordingSink()
  notifier = sinkNotifier(sink)
  let failing = true
  const created = sink.promptCreated.bind(sink)
  sink.promptCreated = (prompt, sessionRow) => {
    if (failing) {
      throw new Error('sink down')
    }
    return created(prompt, sessionRow)
  }
  addPrompt('p:1')
  await expect(notifier.promptCreated(store.getPrompt('p:1')!)).rejects.toThrow('sink down')
  expect(store.listPromptMessageRefs('p:1')).toEqual([])
  failing = false
  await notifier.redeliverUndelivered()
  expect(store.listPromptMessageRefs('p:1')).toHaveLength(1)
})
