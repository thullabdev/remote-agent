import { beforeEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Store } from '../../../src/bridge/store.ts'
import { ChatLog, TOOL_RESULT_MAX } from '../../../src/channel/web/chat-log.ts'
import type { Message, ServerEvent } from '../../../src/channel/web/protocol.ts'
import { TranscriptReader, type TranscriptReaderDeps } from '../../../src/channel/web/transcript/reader.ts'
import { transcriptPath } from '../../../src/channel/web/transcript/path.ts'
import { WebChannel } from '../../../src/channel/web/web-channel.ts'

const HOME = '/home/u'
const CWD = '/home/u/app'
const SID = 'sess-reader-1'
const PATH = transcriptPath(HOME, CWD, SID)
const encoder = new TextEncoder()
const turn = { kind: 'turn_complete' as const, text: '', durationMs: 1_000, isAborted: false }

let clock = 1_000
let logged: string[]

beforeEach(() => {
  clock = 1_000
  logged = []
})

function iso(second: number): string {
  return new Date(Date.UTC(2026, 0, 1, 10, 0, second)).toISOString()
}

const line = (value: object): string => `${JSON.stringify(value)}\n`
const prompt = (uuid: string, text: string, second = 0) => line({ type: 'user', uuid, timestamp: iso(second), message: { role: 'user', content: text } })
const assistantText = (uuid: string, text: string, second = 0) =>
  line({ type: 'assistant', uuid, timestamp: iso(second), message: { role: 'assistant', content: [{ type: 'text', text }] } })
const toolUse = (uuid: string, id: string, second = 0) =>
  line({
    type: 'assistant',
    uuid,
    timestamp: iso(second),
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'ls' } }] },
  })
const toolResult = (uuid: string, id: string, text: string, second = 0, isError = false) =>
  line({
    type: 'user',
    uuid,
    timestamp: iso(second),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: isError }] },
  })
const turnEnd = (uuid: string, second = 0) => line({ type: 'system', subtype: 'turn_duration', durationMs: 1000, uuid, timestamp: iso(second) })
const fixture = (name: string): string => readFileSync(join(import.meta.dir, '../../support/transcripts', name), 'utf8')

type Overrides = Partial<TranscriptReaderDeps> & { files?: Map<string, Uint8Array> }

function setup(overrides: Overrides = {}) {
  const { files: providedFiles, ...deps } = overrides
  const store = new Store(':memory:', () => clock)
  const chatLog = new ChatLog(store, () => clock)
  const channel = new WebChannel(
    chatLog,
    message => {
      logged.push(message)
    },
    store,
  )
  const files = providedFiles ?? new Map<string, Uint8Array>()
  const busy: boolean[] = []
  const reader = new TranscriptReader({
    chatLog,
    store,
    home: HOME,
    log: message => {
      logged.push(message)
    },
    onBusy: (sessionId, value) => {
      busy.push(value)
      channel.busyChanged(sessionId, value)
    },
    poll: () => () => {},
    readFrom: async (path, offset, length) => {
      const content = files.get(path)
      return content === undefined ? null : content.slice(offset, offset + length)
    },
    statSize: async path => files.get(path)?.length ?? null,
    ...deps,
  })
  channel.setTranscriptProbe(sessionId => reader.isActive(sessionId))
  return { store, chatLog, channel, files, reader, busy }
}

type Harness = ReturnType<typeof setup>

/** A Session with its chat, as sessionSeen makes it; the reader is attached to it. */
function startSession(h: Harness): string {
  h.store.upsertSession({ sessionId: SID, cwd: CWD })
  h.channel.sessionSeen(h.store.getSession(SID)!)
  h.reader.attach(SID)
  return h.store.getSession(SID)!.chatId!
}

function messagesOf(h: Harness, chatId: string): Message[] {
  return h.chatLog.listMessages(chatId, { limit: 20_000 }).messages
}

function write(h: Harness, text: string): void {
  h.files.set(PATH, encoder.encode(text))
}

test('attach backfills the whole file once', async () => {
  const h = setup()
  const chatId = startSession(h)
  write(h, prompt('p-1', 'first') + assistantText('a-1', 'second') + assistantText('a-2', 'third'))

  await h.reader.ingestOnce(SID)
  await h.reader.ingestOnce(SID)

  expect(messagesOf(h, chatId).map(message => message.kind)).toEqual(['user_text', 'agent_text', 'agent_text'])
  expect(h.reader.isActive(SID)).toBe(true)
})

test('a line without a trailing newline is not ingested until completed', async () => {
  const h = setup()
  const chatId = startSession(h)
  const complete = prompt('p-1', 'done line')
  const partial = assistantText('a-1', 'still typing')
  write(h, complete + partial.slice(0, -1))

  await h.reader.ingestOnce(SID)
  expect(messagesOf(h, chatId).map(message => message.kind)).toEqual(['user_text'])

  write(h, complete + partial)
  await h.reader.ingestOnce(SID)
  expect(messagesOf(h, chatId).map(message => message.kind)).toEqual(['user_text', 'agent_text'])
})

test('detach then attach again (Bridge restart) adds no duplicate messages', async () => {
  const h = setup()
  const chatId = startSession(h)
  write(h, prompt('p-1', 'hello') + toolUse('a-1', 'toolu_r') + toolResult('u-2', 'toolu_r', 'out', 3) + assistantText('a-2', 'bye'))
  await h.reader.ingestOnce(SID)
  const before = messagesOf(h, chatId)
  const events: ServerEvent[] = []
  h.chatLog.subscribe(event => {
    events.push(event)
  })

  h.reader.detach(SID)
  h.reader.attach(SID)
  await h.reader.ingestOnce(SID)

  expect(messagesOf(h, chatId)).toEqual(before)
  expect(events.filter(event => event.type === 'message.created' || event.type === 'message.updated')).toEqual([])
})

test('tool_use then tool_result updates one tool_run message', async () => {
  const h = setup()
  const chatId = startSession(h)
  write(h, toolUse('a-1', 'toolu_x', 1))

  await h.reader.ingestOnce(SID)
  expect(messagesOf(h, chatId)).toMatchObject([{ kind: 'tool_run', tool: 'Bash', status: 'running', result: null, durationMs: null }])

  write(h, toolUse('a-1', 'toolu_x', 1) + toolResult('u-1', 'toolu_x', 'listing', 4))
  await h.reader.ingestOnce(SID)

  const runs = messagesOf(h, chatId)
  expect(runs).toHaveLength(1)
  expect(runs[0]).toMatchObject({ kind: 'tool_run', status: 'done', result: 'listing', resultTruncated: false, durationMs: 3_000 })
})

test('a tool_result whose tool_use was never seen is stored as a finished unknown tool run', async () => {
  const h = setup()
  const chatId = startSession(h)
  write(h, toolResult('u-1', 'toolu_orphan', 'late output', 2, true))

  await h.reader.ingestOnce(SID)

  expect(messagesOf(h, chatId)).toMatchObject([{ kind: 'tool_run', tool: 'unknown', status: 'error', result: 'late output' }])
})

test('a 1 MB tool_result is stored capped at 20 000 chars with resultTruncated', async () => {
  const h = setup()
  const chatId = startSession(h)
  write(h, toolUse('a-1', 'toolu_big') + toolResult('u-1', 'toolu_big', 'x'.repeat(1_000_000), 2))

  await h.reader.ingestOnce(SID)

  const [run] = messagesOf(h, chatId)
  expect(run).toMatchObject({ kind: 'tool_run', status: 'done', resultTruncated: true })
  expect(run?.kind === 'tool_run' ? run.result?.startsWith('x'.repeat(TOOL_RESULT_MAX)) : false).toBe(true)
  expect(run?.kind === 'tool_run' ? (run.result?.length ?? 0) : 0).toBeLessThan(TOOL_RESULT_MAX + 100)
})

test('one transcript line with text and two tool_use blocks yields three messages', async () => {
  const h = setup()
  const chatId = startSession(h)
  write(
    h,
    line({
      type: 'assistant',
      uuid: 'a-multi',
      timestamp: iso(1),
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Two checks' },
          { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'a' } },
          { type: 'tool_use', id: 'toolu_2', name: 'Grep', input: { pattern: 'b' } },
        ],
      },
    }),
  )

  await h.reader.ingestOnce(SID)

  expect(messagesOf(h, chatId).map(message => message.kind)).toEqual(['agent_text', 'tool_run', 'tool_run'])
})

test('busy turns true on a user entry and false on turn_end', async () => {
  const h = setup()
  const chatId = startSession(h)
  write(h, prompt('p-1', 'go', 1))

  await h.reader.ingestOnce(SID)
  expect(h.chatLog.getChat(chatId)?.busy).toBe(true)

  write(h, prompt('p-1', 'go', 1) + assistantText('a-1', 'done', 2) + turnEnd('s-1', 3))
  await h.reader.ingestOnce(SID)
  expect(h.chatLog.getChat(chatId)?.busy).toBe(false)
})

// Phase 0 baseline for CL-15 (docs/ui-critique-chat-list-review.md): documents today's behaviour. Flip the expectation when the list learns a "needs you" state.
test('a chat waiting on a pending permission prompt is still reported busy', async () => {
  const h = setup()
  const chatId = startSession(h)
  write(h, prompt('p-1', 'run it', 1) + toolUse('a-1', 'tool-1', 2))
  await h.reader.ingestOnce(SID)

  h.chatLog.appendMessage(chatId, {
    kind: 'prompt',
    promptId: 'perm-1',
    title: 'Allow Bash?',
    body: { kind: 'permission', tool: 'Bash', summary: 'ls', reason: null, agentId: null },
    status: 'pending',
    resolution: null,
  })

  const chat = h.chatLog.getChat(chatId)
  expect(chat?.busy).toBe(true)
  expect(messagesOf(h, chatId).some(message => message.kind === 'prompt' && message.status === 'pending')).toBe(true)
})

test('a compaction after a finished turn leaves the chat idle and adds no message from the user', async () => {
  const h = setup()
  const chatId = startSession(h)
  const compactBoundary = line({ type: 'system', subtype: 'compact_boundary', uuid: 'c-1', timestamp: iso(4) })
  const compactSummary = line({
    type: 'user',
    uuid: 'c-2',
    timestamp: iso(5),
    isCompactSummary: true,
    isVisibleInTranscriptOnly: true,
    message: { role: 'user', content: 'This session is being continued from a previous conversation that ran out of context.' },
  })
  write(h, prompt('p-1', 'go', 1) + assistantText('a-1', 'done', 2) + turnEnd('s-1', 3))
  await h.reader.ingestOnce(SID)
  expect(h.chatLog.getChat(chatId)?.busy).toBe(false)

  write(h, prompt('p-1', 'go', 1) + assistantText('a-1', 'done', 2) + turnEnd('s-1', 3) + compactBoundary + compactSummary)
  await h.reader.ingestOnce(SID)

  expect(h.chatLog.getChat(chatId)?.busy).toBe(false)
  expect(messagesOf(h, chatId).map(message => message.kind)).toEqual(['user_text', 'agent_text'])
})

test('a transcript that ends on a compaction backfills to idle', async () => {
  const h = setup()
  const chatId = startSession(h)
  write(
    h,
    prompt('p-1', 'go', 1) +
      assistantText('a-1', 'done', 2) +
      turnEnd('s-1', 3) +
      line({ type: 'system', subtype: 'compact_boundary', uuid: 'c-1', timestamp: iso(4) }) +
      line({ type: 'user', uuid: 'c-2', timestamp: iso(5), isCompactSummary: true, message: { role: 'user', content: 'This session is being continued…' } }),
  )

  await h.reader.ingestOnce(SID)

  expect(h.chatLog.getChat(chatId)?.busy).toBe(false)
})

test('an old finished transcript backfills to idle', async () => {
  const h = setup()
  const chatId = startSession(h)
  h.channel.busyChanged(SID, true)
  write(h, fixture('finished-session.jsonl'))

  await h.reader.ingestOnce(SID)

  expect(h.chatLog.getChat(chatId)?.busy).toBe(false)
})

test('a mid-turn transcript backfills to busy', async () => {
  const h = setup()
  const chatId = startSession(h)
  write(h, fixture('mid-turn.jsonl'))

  await h.reader.ingestOnce(SID)

  expect(h.chatLog.getChat(chatId)?.busy).toBe(true)
  expect(messagesOf(h, chatId).map(message => message.kind)).toEqual(['user_text', 'tool_run'])
})

test('AskUserQuestion entries are skipped', async () => {
  const h = setup()
  const chatId = startSession(h)
  write(h, fixture('finished-session.jsonl'))

  await h.reader.ingestOnce(SID)

  const messages = messagesOf(h, chatId)
  expect(messages.map(message => message.kind)).toEqual(['user_text', 'agent_text', 'tool_run', 'agent_text'])
  expect(messages.some(message => message.kind === 'tool_run' && message.tool === 'unknown')).toBe(false)
  expect(messages.some(message => message.kind === 'tool_run' && message.tool === 'AskUserQuestion')).toBe(false)
  expect(messages[2]).toMatchObject({ kind: 'tool_run', tool: 'Bash', status: 'done', result: 'a.txt\nb.txt', durationMs: 1_000 })
})

test('a user line matching a delivered Instruction is not duplicated', async () => {
  const h = setup()
  const chatId = startSession(h)
  h.chatLog.appendMessage(
    chatId,
    { kind: 'user_text', text: 'add tests', status: 'delivered', instructionId: 'ins-1' },
    { sourceId: 'ins-1' },
  )
  write(h, prompt('p-1', 'add tests') + prompt('p-2', 'typed in the terminal'))

  await h.reader.ingestOnce(SID)

  const texts = messagesOf(h, chatId).map(message => (message.kind === 'user_text' ? message.text : null))
  expect(texts).toEqual(['add tests', 'typed in the terminal'])
})

test('file shrinking resets the offset without duplicates', async () => {
  const h = setup()
  const chatId = startSession(h)
  const first = assistantText('a-1', 'one')
  const second = assistantText('a-2', 'two')
  const third = assistantText('a-3', 'three')
  write(h, first + second + third)
  await h.reader.ingestOnce(SID)
  expect(messagesOf(h, chatId)).toHaveLength(3)

  write(h, first)
  await h.reader.ingestOnce(SID)
  expect(messagesOf(h, chatId)).toHaveLength(3)

  // Regrown past the old offset with new lines that sit before it: only a reset to 0 reads them.
  write(h, first + assistantText('a-4', 'four') + assistantText('a-5', 'five') + assistantText('a-6', 'six') + assistantText('a-7', 'seven'))
  await h.reader.ingestOnce(SID)
  expect(messagesOf(h, chatId).map(message => (message.kind === 'agent_text' ? message.markdown : ''))).toEqual([
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
  ])
})

test('concurrent ticks do not double-ingest', async () => {
  const h = setup()
  const chatId = startSession(h)
  write(h, prompt('p-1', 'once') + assistantText('a-1', 'twice'))
  let reads = 0
  const slowReader = new TranscriptReader({
    chatLog: h.chatLog,
    store: h.store,
    home: HOME,
    log: () => {},
    onBusy: () => {},
    poll: () => () => {},
    readFrom: async (path, offset, length) => {
      reads += 1
      await new Promise(resolve => setTimeout(resolve, 5))
      return h.files.get(path)?.slice(offset, offset + length) ?? null
    },
    statSize: async path => h.files.get(path)?.length ?? null,
  })
  slowReader.attach(SID)

  await Promise.all([slowReader.ingestOnce(SID), slowReader.ingestOnce(SID), slowReader.ingestOnce(SID)])

  expect(reads).toBe(1)
  expect(messagesOf(h, chatId)).toHaveLength(2)
})

test('a session with no chat yet is retried on the next tick', async () => {
  const h = setup()
  h.store.upsertSession({ sessionId: SID, cwd: CWD })
  h.reader.attach(SID)
  write(h, prompt('p-1', 'early bird'))

  await h.reader.ingestOnce(SID)
  expect(h.reader.isActive(SID)).toBe(false)

  h.channel.sessionSeen(h.store.getSession(SID)!)
  const chatId = h.store.getSession(SID)!.chatId!
  await h.reader.ingestOnce(SID)

  expect(h.reader.isActive(SID)).toBe(true)
  expect(messagesOf(h, chatId).map(message => message.kind)).toEqual(['user_text'])
})

test('a multi-byte character split across reads is decoded correctly', async () => {
  const h = setup()
  const chatId = startSession(h)
  const complete = prompt('p-1', 'first line')
  const second = assistantText('a-1', 'emoji 🙂 and café')
  const full = encoder.encode(complete + second)
  const emojiAt = full.indexOf(0xf0)
  h.files.set(PATH, full.slice(0, emojiAt + 2))

  await h.reader.ingestOnce(SID)
  expect(messagesOf(h, chatId).map(message => message.kind)).toEqual(['user_text'])

  h.files.set(PATH, full)
  await h.reader.ingestOnce(SID)
  const messages = messagesOf(h, chatId)
  expect(messages.map(message => message.kind)).toEqual(['user_text', 'agent_text'])
  expect(messages[1]).toMatchObject({ kind: 'agent_text', markdown: 'emoji 🙂 and café' })
})

test('missing file: isActive false, and turn_complete Report text is used instead', async () => {
  const h = setup()
  const chatId = startSession(h)
  await h.reader.ingestOnce(SID)
  expect(h.reader.isActive(SID)).toBe(false)

  h.channel.report(h.store.getSession(SID)!, { ...turn, text: 'Report fallback' })
  expect(messagesOf(h, chatId)).toMatchObject([{ kind: 'agent_text', markdown: 'Report fallback' }])

  write(h, assistantText('a-1', 'From the transcript'))
  await h.reader.ingestOnce(SID)
  expect(h.reader.isActive(SID)).toBe(true)

  h.channel.report(h.store.getSession(SID)!, { ...turn, text: 'Ignored now' })
  expect(messagesOf(h, chatId).map(message => (message.kind === 'agent_text' ? message.markdown : ''))).toEqual([
    'Report fallback',
    'From the transcript',
  ])
})

test('secrets in transcript text are redacted in the log', async () => {
  const h = setup()
  const chatId = startSession(h)
  write(h, assistantText('a-1', 'the key is sk-ant-api03-abcdefghijklmnop and TOKEN=hunter2222'))

  await h.reader.ingestOnce(SID)

  const [message] = messagesOf(h, chatId)
  expect(message?.kind === 'agent_text' ? message.markdown : '').not.toContain('sk-ant-api03-abcdefghijklmnop')
  expect(message?.kind === 'agent_text' ? message.markdown : '').not.toContain('hunter2222')
})

test('the reader stops appending once detached', async () => {
  const h = setup()
  const chatId = startSession(h)
  h.reader.detach(SID)
  write(h, assistantText('a-1', 'after detach'))

  await h.reader.ingestOnce(SID)

  expect(h.reader.isActive(SID)).toBe(false)
  expect(messagesOf(h, chatId)).toEqual([])
})

test('a file larger than the window is ingested in several reads without holding it all', async () => {
  const files = new Map<string, Uint8Array>()
  const requests: number[] = []
  const h = setup({
    files,
    readFrom: async (path, offset, length) => {
      requests.push(length)
      return files.get(path)?.slice(offset, offset + length) ?? null
    },
  })
  const chatId = startSession(h)
  let text = ''
  for (let index = 0; index < 1_100; index += 1) {
    text += assistantText(`a-${index}`, 'x'.repeat(4_000), index)
  }
  write(h, text)

  await h.reader.ingestOnce(SID)

  expect(requests.length).toBeGreaterThan(1)
  expect(Math.max(...requests)).toBeLessThanOrEqual(4 * 1024 * 1024)
  expect(messagesOf(h, chatId)).toHaveLength(1_100)
})

test('a single line larger than the window is still read', async () => {
  const h = setup()
  const chatId = startSession(h)
  write(h, assistantText('a-big', 'y'.repeat(5 * 1024 * 1024)))

  await h.reader.ingestOnce(SID)

  const [message] = messagesOf(h, chatId)
  expect(message?.kind === 'agent_text' ? message.markdown.length : 0).toBe(5 * 1024 * 1024)
})

test('a line larger than the maximum line size is logged and skipped, and the next line is read', async () => {
  const h = setup({ windowBytes: 64, maxLineBytes: 1_024 })
  const chatId = startSession(h)
  write(h, assistantText('a-huge', 'z'.repeat(3_000)) + assistantText('a-next', 'after the huge line'))

  await h.reader.ingestOnce(SID)

  expect(messagesOf(h, chatId)).toMatchObject([{ kind: 'agent_text', markdown: 'after the huge line' }])
  expect(logged.some(message => message.includes('skipped'))).toBe(true)
})

test('backfill reports busy once after the whole read', async () => {
  const h = setup({ windowBytes: 200 })
  startSession(h)
  write(h, prompt('p-1', 'go', 1) + assistantText('a-1', 'done', 2) + turnEnd('s-1', 3))

  await h.reader.ingestOnce(SID)

  expect(h.busy).toEqual([false])
})

test('a poison line is skipped and later lines are still ingested', async () => {
  const h = setup()
  const chatId = startSession(h)
  const original = h.chatLog.appendMessage.bind(h.chatLog)
  h.chatLog.appendMessage = (id, body, options) => {
    if (body.kind === 'agent_text' && body.markdown.includes('poison')) {
      throw new Error('disk full')
    }
    return original(id, body, options)
  }
  write(h, assistantText('a-poison', 'poison text') + assistantText('a-ok', 'after the failure'))

  await h.reader.ingestOnce(SID)

  expect(messagesOf(h, chatId)).toMatchObject([{ kind: 'agent_text', markdown: 'after the failure' }])
  expect(logged.some(message => message.includes('a-poison:0'))).toBe(true)
  expect(logged.some(message => message.includes('poison text'))).toBe(false)
  expect(h.reader.isActive(SID)).toBe(true)
})

test('after a restart a web instruction older than 20 others is still not duplicated', async () => {
  const h = setup()
  const chatId = startSession(h)
  h.chatLog.appendMessage(chatId, { kind: 'user_text', text: 'old one', status: 'delivered', instructionId: 'ins-old' }, { sourceId: 'ins-old' })
  for (let index = 0; index < 25; index += 1) {
    h.chatLog.appendMessage(
      chatId,
      { kind: 'user_text', text: `newer ${index}`, status: 'delivered', instructionId: `ins-${index}` },
      { sourceId: `ins-${index}` },
    )
  }
  write(h, prompt('p-old', 'old one'))
  await h.reader.ingestOnce(SID)

  h.reader.detach(SID)
  h.reader.attach(SID)
  await h.reader.ingestOnce(SID)

  const olds = messagesOf(h, chatId).filter(message => message.kind === 'user_text' && message.text === 'old one')
  expect(olds).toHaveLength(1)
})

test('two identical instructions match two transcript lines one-to-one', async () => {
  const h = setup()
  const chatId = startSession(h)
  h.chatLog.appendMessage(chatId, { kind: 'user_text', text: 'same', status: 'delivered', instructionId: 'ins-a' }, { sourceId: 'ins-a' })
  h.chatLog.appendMessage(chatId, { kind: 'user_text', text: 'same', status: 'delivered', instructionId: 'ins-b' }, { sourceId: 'ins-b' })
  write(h, prompt('p-1', 'same') + prompt('p-2', 'same') + prompt('p-3', 'same'))

  await h.reader.ingestOnce(SID)

  const users = messagesOf(h, chatId).flatMap(message => (message.kind === 'user_text' ? [message] : []))
  expect(users).toHaveLength(3)
  expect(users.filter(message => message.instructionId === null)).toHaveLength(1)
})

test('a terminal prompt equal to an already-matched instruction is shown', async () => {
  const h = setup()
  const chatId = startSession(h)
  h.chatLog.appendMessage(chatId, { kind: 'user_text', text: 'run it', status: 'delivered', instructionId: 'ins-1' }, { sourceId: 'ins-1' })
  write(h, prompt('p-1', 'run it'))
  await h.reader.ingestOnce(SID)

  write(h, prompt('p-1', 'run it') + prompt('p-2', 'run it'))
  await h.reader.ingestOnce(SID)

  const users = messagesOf(h, chatId).flatMap(message => (message.kind === 'user_text' ? [message] : []))
  expect(users.map(message => message.instructionId)).toEqual(['ins-1', null])
})

test('a local slash command while idle does not make the chat busy', async () => {
  const h = setup()
  const chatId = startSession(h)
  write(h, prompt('p-1', '<command-name>/cost</command-name>\n<command-message>cost</command-message>'))

  await h.reader.ingestOnce(SID)

  expect(h.chatLog.getChat(chatId)?.busy).toBe(false)
  expect(h.busy).not.toContain(true)
  expect(messagesOf(h, chatId)).toEqual([])
})

test('an interrupt marker ends the busy state', async () => {
  const h = setup()
  const chatId = startSession(h)
  write(h, prompt('p-1', 'go'))
  await h.reader.ingestOnce(SID)
  expect(h.chatLog.getChat(chatId)?.busy).toBe(true)

  write(h, prompt('p-1', 'go') + prompt('p-2', '[Request interrupted by user]'))
  await h.reader.ingestOnce(SID)

  expect(h.chatLog.getChat(chatId)?.busy).toBe(false)
  expect(messagesOf(h, chatId).map(message => message.kind)).toEqual(['user_text'])
})

test('a task-notification line is not shown and does not affect busy', async () => {
  const h = setup()
  const chatId = startSession(h)
  write(h, prompt('n-1', '<task-notification>\n<task-id>x</task-id>\n</task-notification>'))
  await h.reader.ingestOnce(SID)
  expect(messagesOf(h, chatId)).toEqual([])
  expect(h.chatLog.getChat(chatId)?.busy).toBe(false)

  write(
    h,
    prompt('n-1', '<task-notification>\n<task-id>x</task-id>\n</task-notification>') +
      prompt('p-1', 'go') +
      prompt('n-2', '<task-notification>done</task-notification>'),
  )
  await h.reader.ingestOnce(SID)

  expect(h.chatLog.getChat(chatId)?.busy).toBe(true)
  expect(messagesOf(h, chatId).map(message => message.kind)).toEqual(['user_text'])
})

test('a declined AskUserQuestion result is dropped even without answers', async () => {
  const h = setup()
  const chatId = startSession(h)
  const question = line({
    type: 'assistant',
    uuid: 'a-q',
    timestamp: iso(1),
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_decl', name: 'AskUserQuestion', input: { questions: [] } }] },
  })
  write(h, question + toolResult('u-q', 'toolu_decl', 'The user declined to answer', 2))

  await h.reader.ingestOnce(SID)

  expect(messagesOf(h, chatId)).toEqual([])
})

test('close stops the poll timer of every attached session', () => {
  const stopped: string[] = []
  const h = setup({
    poll: () => () => {
      stopped.push('tick')
    },
  })
  h.reader.attach('sess-a')
  h.reader.attach('sess-b')

  h.reader.close()

  expect(stopped).toEqual(['tick', 'tick'])
  h.reader.attach('sess-c')
  h.reader.close()
  expect(stopped).toHaveLength(3)
})

/** The time the reader attaches in the backfill tests: 10:00:30. Entries stamped before 10:00:28 are history. */
const ATTACHED_AT = Date.UTC(2026, 0, 1, 10, 0, 30)
const stampOf = (second: number): number => Date.UTC(2026, 0, 1, 10, 0, second)

test('backfilled messages keep their transcript timestamps', async () => {
  const h = setup({ now: () => ATTACHED_AT })
  const chatId = startSession(h)
  write(h, prompt('p-1', 'first', 5) + assistantText('a-1', 'second', 7))

  await h.reader.ingestOnce(SID)

  expect(messagesOf(h, chatId).map(message => message.at)).toEqual([stampOf(5), stampOf(7)])
})

test('backfilled history does not count as unread but a live message after attach does', async () => {
  const h = setup({ now: () => ATTACHED_AT })
  const chatId = startSession(h)
  write(h, prompt('p-1', 'old question', 1) + assistantText('a-1', 'old answer', 2))
  await h.reader.ingestOnce(SID)
  expect(h.chatLog.getChat(chatId)?.unread).toBe(0)

  write(h, prompt('p-1', 'old question', 1) + assistantText('a-1', 'old answer', 2) + assistantText('a-2', 'live answer', 40))
  await h.reader.ingestOnce(SID)

  expect(h.chatLog.getChat(chatId)?.unread).toBe(1)
})

test('lastMessage.at reflects the transcript time', async () => {
  const h = setup({ now: () => ATTACHED_AT })
  const chatId = startSession(h)
  write(h, prompt('p-1', 'first', 3) + assistantText('a-1', 'last', 9))

  await h.reader.ingestOnce(SID)

  expect(h.chatLog.getChat(chatId)?.lastMessage?.at).toBe(stampOf(9))
})

test('a session id that cannot name a transcript file is not tailed, and the reason is logged once', async () => {
  const h = setup()
  h.store.upsertSession({ sessionId: '../escape', cwd: CWD })
  h.channel.sessionSeen(h.store.getSession('../escape')!)
  h.reader.attach('../escape')

  await h.reader.ingestOnce('../escape')
  await h.reader.ingestOnce('../escape')

  expect(h.reader.isActive('../escape')).toBe(false)
  expect(logged.filter(message => message.includes('transcript file')).length).toBe(1)
})


test('a resumed Session shows its history from the source transcript before its own transcript exists, without doubling it later', async () => {
  const h = setup()
  h.files.set(transcriptPath(HOME, CWD, 'hist-src'), encoder.encode(prompt('h-1', 'old question') + assistantText('h-2', 'old answer')))
  const chatId = startSession(h)
  h.reader.attachSource(SID, 'hist-src')

  await h.reader.ingestOnce(SID)
  expect(textsOf(h, chatId)).toEqual(['old question', 'old answer'])

  // The forked transcript appears at the first turn: it copies the history (same ids) and adds the new turn.
  write(h, prompt('h-1', 'old question') + assistantText('h-2', 'old answer') + prompt('n-1', 'new question'))
  await h.reader.ingestOnce(SID)
  await h.reader.ingestOnce(SID)
  expect(textsOf(h, chatId)).toEqual(['old question', 'old answer', 'new question'])
})

function textsOf(h: Harness, chatId: string): string[] {
  return messagesOf(h, chatId).flatMap(message => (message.kind === 'user_text' ? [message.text] : message.kind === 'agent_text' ? [message.markdown] : []))
}
