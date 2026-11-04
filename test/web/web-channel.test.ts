import { beforeEach, expect, test } from 'bun:test'
import type { ButtonData, PromptView } from '../../src/channel/types.ts'
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
  channel = new WebChannel(chatLog, message => {
    logged.push(message)
  })
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
