import { beforeEach, expect, test } from 'bun:test'
import type { PromptBody } from '../../mod/remote-agent/hooks/protocol.ts'
import type { ButtonData, PromptView } from '../../src/channel/types.ts'
import { AwayMode, Notifier } from '../../src/bridge/notifier.ts'
import { Store } from '../../src/bridge/store.ts'
import { ChatLog } from '../../src/web/chat-log.ts'
import { WebChannel } from '../../src/web/web-channel.ts'

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
