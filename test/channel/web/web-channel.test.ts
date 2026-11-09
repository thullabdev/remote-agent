import { beforeEach, expect, test } from 'bun:test'
import type { PromptBody } from '../../../mod/remote-agent/hooks/protocol.ts'
import type { ButtonData, PromptView } from '../../../src/channel/types.ts'
import { AwayMode, Notifier } from '../../../src/bridge/notifier.ts'
import { Store } from '../../../src/bridge/store.ts'
import { ChatLog } from '../../../src/channel/web/chat-log.ts'
import type { ServerEvent } from '../../../src/channel/web/protocol.ts'
import { PushService, type PushEvent } from '../../../src/channel/web/push.ts'
import { WebChannel } from '../../../src/channel/web/web-channel.ts'

let clock = 1_000
let store: Store
let chatLog: ChatLog
let channel: WebChannel
const logged: string[] = []

const view: PromptView = {
  promptId: 'p1',
  title: 'Allow Bash?',
  items: [
    {
      text: 'Run ls?',
      buttons: [
        { label: 'Yes', data: { kind: 'answer', promptId: 'p1', questionIndex: 0, optionIndex: 0 } },
        { label: 'No', data: { kind: 'answer', promptId: 'p1', questionIndex: 0, optionIndex: 1 } },
      ],
    },
    {
      text: 'Run pwd?',
      buttons: [{ label: 'Yes', data: { kind: 'answer', promptId: 'p1', questionIndex: 1, optionIndex: 0 } }],
    },
  ],
}

beforeEach(() => {
  clock = 1_000
  logged.length = 0
  store = new Store(':memory:', () => clock)
  chatLog = new ChatLog(store, () => clock)
  channel = new WebChannel(
    chatLog,
    message => {
      logged.push(message)
    },
    store,
  )
})

test('createThread returns a c_ id and lists the chat', async () => {
  const thread = await channel.createThread('remote-agent')

  expect(thread).toMatch(/^c_[0-9a-f-]{36}$/)
  const chat = chatLog.getChat(thread)
  expect(chat?.title).toBe('remote-agent')
  expect(chat?.status).toBe('active')
  expect(chatLog.listChats().map(item => item.id)).toContain(thread)
})

test('sendText to null lands in General as a command reply', async () => {
  const ref = await channel.sendText(null, 'Started', null)

  const message = chatLog.findMessage(ref)
  expect(message?.chatId).toBe('general')
  expect(message?.kind).toBe('command_reply')
  expect(message).toMatchObject({ kind: 'command_reply', text: 'Started' })
})

test('sendText to a chat lands there as a system message', async () => {
  const thread = await channel.createThread('app')

  const ref = await channel.sendText(thread, 'Session ended', 'ignored-ref')

  const message = chatLog.findMessage(ref)
  expect(message).toMatchObject({ chatId: thread, kind: 'system', text: 'Session ended' })
})

test('sendButtons creates a picker with choice indexes', async () => {
  const pick = (choice: number): ButtonData => ({ kind: 'launch', pickerId: 'pk1', choice })

  const ref = await channel.sendButtons(null, 'Pick a project', [
    { label: 'app', data: pick(0) },
    { label: 'lib', data: pick(1) },
  ])

  expect(chatLog.findMessage(ref)).toMatchObject({
    chatId: 'general',
    kind: 'picker',
    pickerId: 'pk1',
    text: 'Pick a project',
    buttons: [
      { label: 'app', choice: 0 },
      { label: 'lib', choice: 1 },
    ],
  })
})

test('sendButtons rejects a button that is not a launch button', async () => {
  await expect(
    channel.sendButtons(null, 'Oops', [{ label: 'Yes', data: { kind: 'answer', promptId: 'p1', questionIndex: 0, optionIndex: 0 } }]),
  ).rejects.toThrow()
})

test('sendPrompt returns one ref per item and the messages are pending prompts', async () => {
  const thread = await channel.createThread('app')

  const refs = await channel.sendPrompt(thread, view)

  expect(refs).toHaveLength(2)
  const first = chatLog.findMessage(refs[0] ?? '')
  const second = chatLog.findMessage(refs[1] ?? '')
  expect(first).toMatchObject({
    chatId: thread,
    kind: 'prompt',
    promptId: 'p1',
    title: 'Allow Bash?',
    status: 'pending',
    resolution: null,
    body: {
      kind: 'question',
      questions: [
        {
          question: 'Run ls?',
          multiSelect: false,
          options: [{ label: 'Yes' }, { label: 'No' }],
          answered: null,
        },
      ],
    },
  })
  expect(second).toMatchObject({ kind: 'prompt', status: 'pending' })
})

test('markResolved flips the messages to answered with the note', async () => {
  const thread = await channel.createThread('app')
  const refs = await channel.sendPrompt(thread, view)

  await channel.markResolved(thread, refs, 'Answered on the laptop')

  for (const ref of refs) {
    expect(chatLog.findMessage(ref)).toMatchObject({
      kind: 'prompt',
      status: 'answered',
      resolution: { note: 'Answered on the laptop', source: 'remote' },
    })
  }
  expect(chatLog.listMessages(thread, { limit: 10 }).messages.map(message => message.kind)).toEqual(['prompt', 'prompt'])
})

test('closeThread marks ended and keeps history readable', async () => {
  const thread = await channel.createThread('app')
  await channel.sendText(thread, 'Working', null)

  await channel.closeThread(thread)

  expect(chatLog.getChat(thread)?.status).toBe('ended')
  expect(chatLog.listMessages(thread, { limit: 10 }).messages.map(message => message.kind)).toEqual(['system'])
})

test('renameThread updates the chat title', async () => {
  const thread = await channel.createThread('old')

  await channel.renameThread(thread, 'new')

  expect(chatLog.getChat(thread)?.title).toBe('new')
})

test('start stores the handlers and stop clears them', async () => {
  const handlers = {
    onButton: async () => 'ok',
    onText: async () => null,
    onCommand: async () => null,
  }
  expect(channel.handlers).toBeNull()

  await channel.start(handlers)
  expect(channel.handlers).toBe(handlers)

  await channel.stop()
  expect(channel.handlers).toBeNull()
  expect(logged).toEqual(['web channel stopped'])
})

const webSession = { sessionId: 'abcdef1234', cwd: '/home/u/app' }
const turn = (text: string) => ({ kind: 'turn_complete' as const, text, durationMs: 1_000, isAborted: false })

function wired(): Notifier {
  return new Notifier(store, channel, new AwayMode(true), () => {}, channel)
}

function insertPrompt(id: string, body: PromptBody) {
  store.insertPrompt(id, webSession.sessionId, body)
  return store.getPrompt(id)!
}

function chatsWithoutGeneral() {
  return chatLog.listChats().filter(chat => chat.id !== 'general')
}

test('a permission prompt body is stored with the full untruncated summary', async () => {
  store.upsertSession(webSession)
  const command = 'x'.repeat(50_000)
  const prompt = insertPrompt('p:big', { kind: 'permission', tool: 'Bash', input: { command }, reason: 'build it' })

  const refs = channel.promptCreated(prompt, store.getSession(webSession.sessionId)!)

  expect(refs).toHaveLength(1)
  const message = chatLog.findMessage(refs[0]!)
  expect(message).toMatchObject({
    kind: 'prompt',
    promptId: 'p:big',
    status: 'pending',
    body: { kind: 'permission', tool: 'Bash', reason: 'build it', agentId: null },
  })
  const body = message?.kind === 'prompt' ? message.body : null
  expect(body?.kind === 'permission' ? body.summary : '').toBe(`$ ${command}`)
})

test('a Question prompt creates one message per question with options', async () => {
  store.upsertSession(webSession)
  const prompt = insertPrompt('q:1', {
    kind: 'question',
    questions: [
      { question: 'Which db?', header: 'Storage', multiSelect: false, options: [{ label: 'sqlite', description: 'local file' }, { label: 'pg', description: '' }] },
      { question: 'Which tests?', header: 'Testing', multiSelect: true, options: [{ label: 'unit', description: '' }] },
    ],
  })

  const refs = channel.promptCreated(prompt, store.getSession(webSession.sessionId)!)

  expect(refs).toHaveLength(2)
  expect(chatLog.findMessage(refs[0]!)).toMatchObject({
    kind: 'prompt',
    body: {
      kind: 'question',
      questions: [
        {
          question: 'Which db?',
          header: 'Storage',
          multiSelect: false,
          options: [
            { label: 'sqlite', description: 'local file' },
            { label: 'pg', description: '' },
          ],
          answered: null,
        },
      ],
    },
  })
  expect(chatLog.findMessage(refs[1]!)).toMatchObject({
    kind: 'prompt',
    body: { kind: 'question', questions: [{ question: 'Which tests?', multiSelect: true, answered: null }] },
  })
})

test('resolution marks each question message answered', async () => {
  store.upsertSession(webSession)
  const notifierWired = wired()
  const prompt = insertPrompt('q:2', {
    kind: 'question',
    questions: [
      { question: 'Which db?', header: 'Storage', multiSelect: false, options: [{ label: 'sqlite', description: '' }] },
      { question: 'Which tests?', header: 'Testing', multiSelect: false, options: [{ label: 'unit', description: '' }] },
    ],
  })
  await notifierWired.promptCreated(prompt)
  const refs = store.listPromptMessageRefs('q:2')
  store.resolvePrompt('q:2', { kind: 'question', answers: { 'Which db?': 'sqlite', 'Which tests?': 'unit' } }, 'remote')

  await notifierWired.promptResolved(store.getPrompt('q:2')!)

  const first = chatLog.findMessage(refs[0]!)
  const second = chatLog.findMessage(refs[1]!)
  expect(first).toMatchObject({ status: 'answered', resolution: { note: 'Answered (remote): sqlite / unit', source: 'remote' } })
  expect(first?.kind === 'prompt' && first.body.kind === 'question' ? first.body.questions[0]?.answered : null).toBe('sqlite')
  expect(second?.kind === 'prompt' && second.body.kind === 'question' ? second.body.questions[0]?.answered : null).toBe('unit')
})

test('turn_complete appends agent_text when no transcript probe says active, and nothing when it does', async () => {
  store.upsertSession(webSession)
  const session = store.getSession(webSession.sessionId)!

  channel.report(session, turn('Done: tests pass'))
  expect(chatsWithoutGeneral()).toHaveLength(1)
  const chatId = chatsWithoutGeneral()[0]!.id
  expect(chatLog.listMessages(chatId, { limit: 10 }).messages.map(message => message.kind)).toEqual(['agent_text'])
  expect(chatLog.listMessages(chatId, { limit: 10 }).messages[0]).toMatchObject({ kind: 'agent_text', markdown: 'Done: tests pass' })

  channel.setTranscriptProbe(() => true)
  channel.report(session, turn('Second turn'))
  channel.report(session, turn(''))
  expect(chatLog.listMessages(chatId, { limit: 10 }).messages).toHaveLength(1)
})

// CL-18(b) (docs/ui-critique-chat-list-review.md): lifecycle messages are history for the list, not something to read.
test('the Session started and Session ended messages do not count as unread, but stay in the log', () => {
  store.upsertSession(webSession)
  const session = store.getSession(webSession.sessionId)!
  channel.sessionSeen(session)
  const chatId = store.getSession(webSession.sessionId)!.chatId!

  channel.report(session, { kind: 'session_started' })
  channel.report(session, { kind: 'session_ended', reason: 'exit' })

  expect(chatLog.getChat(chatId)?.unread).toBe(0)
  const texts = chatLog.listMessages(chatId, { limit: 50 }).messages.flatMap(message => (message.kind === 'system' ? [message.text] : []))
  expect(texts).toEqual([`Session started in ${webSession.cwd}`, 'Session ended (exit)'])
})

test('a reminder that a prompt is still waiting still counts as unread', async () => {
  store.upsertSession(webSession)
  const session = store.getSession(webSession.sessionId)!
  const prompt = insertPrompt('p9', { kind: 'permission', tool: 'Bash', input: { command: 'ls' } })

  channel.promptReminder(prompt, session)

  expect(chatLog.getChat(store.getSession(webSession.sessionId)!.chatId!)?.unread).toBe(1)
})

test('first mod request for an unseen session creates exactly one chat', () => {
  store.upsertSession(webSession)
  const session = store.getSession(webSession.sessionId)!

  channel.sessionSeen(session)
  channel.sessionSeen(session)

  expect(chatsWithoutGeneral()).toHaveLength(1)
  expect(store.getSession(webSession.sessionId)?.chatId).toBe(chatsWithoutGeneral()[0]!.id)
  expect(store.getSession(webSession.sessionId)?.threadId).toBe(chatsWithoutGeneral()[0]!.id)
})

test('chat survives endSession and history is still listed', async () => {
  const notifierWired = wired()
  await notifierWired.report({ session: webSession, report: { kind: 'session_started' } })
  await notifierWired.report({ session: webSession, report: { kind: 'session_ended', reason: 'exit' } })

  const chat = chatsWithoutGeneral()[0]!
  expect(chat.status).toBe('ended')
  expect(store.getSession(webSession.sessionId)?.chatId).toBe(chat.id)
  expect(chatLog.listMessages(chat.id, { limit: 10 }).messages.map(message => message.kind)).toEqual(['system', 'system'])
})

test('a resumed non-spawned session keeps its one chat after being ended and seen again', async () => {
  const notifierWired = wired()
  await notifierWired.report({ session: webSession, report: { kind: 'session_started' } })
  const chatId = chatsWithoutGeneral()[0]!.id
  await notifierWired.report({ session: webSession, report: { kind: 'session_ended', reason: 'exit' } })

  await notifierWired.report({ session: webSession, report: turn('back again') })
  const resumedThread = await notifierWired.ensureThread(webSession.sessionId)

  expect(resumedThread).toBe(chatId)
  expect(chatsWithoutGeneral()).toHaveLength(1)
  expect(chatLog.getChat(chatId)?.status).toBe('active')
})

test('a late request for an ended spawned session creates no chat and keeps it ended', async () => {
  const notifierWired = wired()
  store.createSpawnedSession({ id: 'sp1', cwd: '/home/u/Sites/api', tmuxName: 'ra-sp1' })
  const spawned = { sessionId: 'sp1', cwd: '/home/u/Sites/api' }
  await notifierWired.ensureThread('sp1')
  await notifierWired.closeSession('sp1')
  const chatsBefore = chatsWithoutGeneral().length

  await notifierWired.report({ session: spawned, report: turn('late') })
  notifierWired.sessionSeen('sp1')

  expect(chatsWithoutGeneral()).toHaveLength(chatsBefore)
  expect(chatsWithoutGeneral().every(chat => chat.status === 'ended')).toBe(true)
})

function seenSession() {
  store.upsertSession(webSession)
  const session = store.getSession(webSession.sessionId)!
  channel.sessionSeen(session)
  return session
}

function busyOf(sessionId: string): boolean | undefined {
  const chatId = store.getSession(sessionId)?.chatId
  return chatId === null || chatId === undefined ? undefined : chatLog.getChat(chatId)?.busy
}

test('busy flips true on instructionDelivered and false on turn_complete and on session end', () => {
  const session = seenSession()
  const first = store.enqueueInstruction(webSession.sessionId, 'add tests')
  channel.instructionQueued(first, session)

  channel.instructionDelivered(first.id)
  expect(busyOf(webSession.sessionId)).toBe(true)

  channel.report(session, turn('done'))
  expect(busyOf(webSession.sessionId)).toBe(false)

  const second = store.enqueueInstruction(webSession.sessionId, 'one more')
  channel.instructionQueued(second, session)
  channel.instructionDelivered(second.id)
  expect(busyOf(webSession.sessionId)).toBe(true)

  channel.chatEnded(session)
  expect(busyOf(webSession.sessionId)).toBe(false)
})

test('busy also turns on for an instruction queued outside the web channel', () => {
  seenSession()
  const instruction = store.enqueueInstruction(webSession.sessionId, 'from telegram')

  channel.instructionDelivered(instruction.id)

  expect(busyOf(webSession.sessionId)).toBe(true)
})

test('a repeated busy value emits no chat.updated', () => {
  seenSession()
  const events: string[] = []
  chatLog.subscribe(event => events.push(event.type))

  channel.busyChanged(webSession.sessionId, true)
  channel.busyChanged(webSession.sessionId, true)
  channel.busyChanged(webSession.sessionId, false)
  channel.busyChanged(webSession.sessionId, false)

  expect(events.filter(type => type === 'chat.updated')).toHaveLength(2)
})

test('busyChanged for an unknown session is a no-op', () => {
  const events: string[] = []
  chatLog.subscribe(event => events.push(event.type))

  expect(() => channel.busyChanged('no-such-session', true)).not.toThrow()
  expect(events).toEqual([])
})

test('delivering an instruction twice is idempotent (one message.updated)', () => {
  const session = seenSession()
  const instruction = store.enqueueInstruction(webSession.sessionId, 'add tests')
  channel.instructionQueued(instruction, session)
  const events: string[] = []
  chatLog.subscribe(event => events.push(event.type))

  channel.instructionDelivered(instruction.id)
  channel.instructionDelivered(instruction.id)

  expect(events.filter(type => type === 'message.updated')).toHaveLength(1)
})

test('an instruction delivered for an unknown instruction id is a no-op', () => {
  const events: string[] = []
  chatLog.subscribe(event => events.push(event.type))

  expect(() => channel.instructionDelivered('no-such-instruction')).not.toThrow()
  expect(events).toEqual([])
})

test('a late instruction delivery after chatEnded leaves the chat not busy', () => {
  const session = seenSession()
  const instruction = store.enqueueInstruction(webSession.sessionId, 'late')
  channel.instructionQueued(instruction, session)
  channel.chatEnded(session)
  const busyEvents: boolean[] = []
  chatLog.subscribe(event => {
    if (event.type === 'chat.updated' && event.chat.busy) {
      busyEvents.push(event.chat.busy)
    }
  })

  channel.instructionDelivered(instruction.id)

  expect(busyOf(webSession.sessionId)).toBe(false)
  expect(busyEvents).toEqual([])
})

test('ending a busy session emits one chat.updated', () => {
  const session = seenSession()
  const instruction = store.enqueueInstruction(webSession.sessionId, 'add tests')
  channel.instructionQueued(instruction, session)
  channel.instructionDelivered(instruction.id)
  expect(busyOf(webSession.sessionId)).toBe(true)
  const chatUpdates: boolean[] = []
  chatLog.subscribe(event => {
    if (event.type === 'chat.updated') {
      chatUpdates.push(event.chat.busy)
    }
  })

  channel.chatEnded(session)

  expect(chatUpdates).toEqual([false])
  expect(busyOf(webSession.sessionId)).toBe(false)
})

test('sessionSeen attaches the transcript reader and chatEnded detaches it', () => {
  const attached: string[] = []
  const detached: string[] = []
  channel.setTranscriptAttacher(
    sessionId => {
      attached.push(sessionId)
    },
    sessionId => {
      detached.push(sessionId)
    },
  )
  store.upsertSession(webSession)
  const session = store.getSession(webSession.sessionId)!

  channel.sessionSeen(session)
  expect(attached).toEqual([webSession.sessionId])
  expect(store.getSession(webSession.sessionId)?.chatId).not.toBeNull()

  channel.chatEnded(store.getSession(webSession.sessionId)!)
  expect(detached).toEqual([webSession.sessionId])
})

const permissionBody: PromptBody = { kind: 'permission', tool: 'Bash', input: { command: 'ls' } }
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

/** Installs a push notifier that records every event it is handed, and returns the record. */
function recordPushes(): PushEvent[] {
  const pushes: PushEvent[] = []
  channel.setPushNotifier(async event => {
    pushes.push(event)
  })
  return pushes
}

function sessionRow() {
  store.upsertSession(webSession)
  return store.getSession(webSession.sessionId)!
}

test('a stale prompt creates one system message and one push', () => {
  const session = sessionRow()
  const prompt = insertPrompt('p:stale', permissionBody)
  const pushes = recordPushes()

  channel.promptReminder(prompt, session)

  const chatId = store.getSession(webSession.sessionId)!.chatId!
  const chat = chatLog.getChat(chatId)!
  const messages = chatLog.listMessages(chatId, { limit: 10 }).messages
  expect(messages.map(message => message.kind)).toEqual(['system'])
  expect(messages[0]).toMatchObject({ kind: 'system', text: `Still waiting for your answer (${chat.title})` })
  expect(pushes).toMatchObject([{ kind: 'prompt', chatId, title: chat.title }])
})

test('a turn_complete in Away mode pushes, out of Away mode does not', () => {
  // WebChannel always hands a turn_complete to notify; the Away filter lives in PushService (see the integration test below).
  const session = sessionRow()
  const pushes = recordPushes()

  channel.report(session, turn('Done: tests pass'))
  channel.report(session, turn('Second turn'))

  expect(pushes).toMatchObject([
    { kind: 'report', text: 'Done: tests pass' },
    { kind: 'report', text: 'Second turn' },
  ])
})

test('a turn_complete in Away mode is pushed by a real PushService, out of Away mode it is not', async () => {
  const session = sessionRow()
  let away = false
  const sent: string[] = []
  const push = new PushService({
    chatLog,
    hub: { anyActive: () => false },
    away: { isAway: () => away },
    vapid: { publicKey: 'pub-key', privateKey: 'priv-key', subject: 'mailto:ops@example.com' },
    send: async (_subscription, payload) => {
      sent.push(payload)
      return { status: 201 }
    },
    log: message => {
      logged.push(message)
    },
  })
  chatLog.addPushSubscription({ endpoint: 'https://push.example/a', keys: { p256dh: 'p256dh-a', auth: 'auth-a' } })
  channel.setPushNotifier(event => push.notify(event))

  channel.report(session, turn('Out of Away'))
  await settle()
  expect(sent).toEqual([])

  away = true
  channel.report(session, turn('In Away'))
  await settle()
  expect(sent).toHaveLength(1)
  expect(JSON.parse(sent[0]!)).toMatchObject({ kind: 'report', preview: 'In Away' })
})

test('a multi-question prompt pushes once', () => {
  const session = sessionRow()
  const pushes = recordPushes()
  const prompt = insertPrompt('q:multi', {
    kind: 'question',
    questions: [
      { question: 'Which db?', header: 'Storage', multiSelect: false, options: [{ label: 'sqlite', description: '' }] },
      { question: 'Which tests?', header: 'Testing', multiSelect: false, options: [{ label: 'unit', description: '' }] },
    ],
  })

  const refs = channel.promptCreated(prompt, session)

  expect(refs).toHaveLength(2)
  expect(pushes).toMatchObject([{ kind: 'prompt', text: 'Which db?' }])
})

test('a push failure is logged and does not affect the stored message', async () => {
  const session = sessionRow()
  channel.setPushNotifier(async () => {
    throw new Error('push service down')
  })
  const prompt = insertPrompt('p:fail', permissionBody)

  const refs = channel.promptCreated(prompt, session)
  await settle()

  expect(logged).toEqual(['web push failed'])
  expect(chatLog.findMessage(refs[0]!)).toMatchObject({ kind: 'prompt', status: 'pending', promptId: 'p:fail' })
})

test('session_started and session_ended push as reports', () => {
  const session = sessionRow()
  const pushes = recordPushes()

  channel.report(session, { kind: 'session_started' })
  channel.report(session, { kind: 'session_ended', reason: 'exit' })

  expect(pushes).toMatchObject([
    { kind: 'report', text: 'Session started' },
    { kind: 'report', text: 'Session ended' },
  ])
})

test("an empty turn_complete text pushes 'Turn finished'", () => {
  const session = sessionRow()
  const pushes = recordPushes()

  channel.report(session, turn(''))

  expect(pushes).toMatchObject([{ kind: 'report', text: 'Turn finished' }])
})

test('a turn_complete pushes its text even when the transcript reader is active', () => {
  const session = sessionRow()
  const pushes = recordPushes()
  channel.setTranscriptProbe(() => true)

  channel.report(session, turn('Done from the reader'))

  expect(pushes).toMatchObject([{ kind: 'report', text: 'Done from the reader' }])
  const chatId = store.getSession(webSession.sessionId)!.chatId!
  expect(chatLog.listMessages(chatId, { limit: 10 }).messages).toEqual([])
})

test('setPushNotifier(null) disables pushing', () => {
  const session = sessionRow()
  const pushes = recordPushes()
  channel.report(session, turn('Before'))

  channel.setPushNotifier(null)
  channel.report(session, turn('After'))
  channel.promptCreated(insertPrompt('p:off', permissionBody), session)

  expect(pushes).toMatchObject([{ kind: 'report', text: 'Before' }])
})

test('a report that creates the chat also attaches the transcript reader', () => {
  const attached: string[] = []
  channel.setTranscriptAttacher(sessionId => {
    attached.push(sessionId)
  })
  store.upsertSession(webSession)

  channel.report(store.getSession(webSession.sessionId)!, { kind: 'session_started' })

  expect(attached).toContain(webSession.sessionId)
  expect(store.getSession(webSession.sessionId)?.chatId).not.toBeNull()
})

test('usageChanged broadcasts an ephemeral usage.updated event without touching the chat log', () => {
  const sent: ServerEvent[] = []
  channel.setUsageBroadcaster(event => sent.push(event))
  const seqBefore = chatLog.currentSeq()

  channel.usageChanged({ accounts: [], chats: {} })

  expect(sent).toEqual([{ type: 'usage.updated', usage: { accounts: [], chats: {} } }])
  expect(chatLog.currentSeq()).toBe(seqBefore)
})

test('usageChanged without a broadcaster does nothing', () => {
  expect(() => channel.usageChanged({ accounts: [], chats: {} })).not.toThrow()
})
