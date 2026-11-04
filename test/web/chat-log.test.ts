import { beforeEach, expect, spyOn, test } from 'bun:test'
import { Store } from '../../src/bridge/store.ts'
import { ChatLog, TOOL_RESULT_MAX } from '../../src/web/chat-log.ts'
import type { Message, MessageBody, ServerEvent } from '../../src/web/protocol.ts'

let clock = 1_000
let store: Store
let log: ChatLog

const userText = (value: string): MessageBody => ({ kind: 'user_text', text: value, status: 'delivered', instructionId: null })
const agent = (markdown: string): MessageBody => ({ kind: 'agent_text', markdown })
const toolRun = (result: string | null): MessageBody => ({
  kind: 'tool_run',
  tool: 'Bash',
  input: { command: 'ls' },
  result,
  resultTruncated: false,
  status: 'done',
  durationMs: 12,
})
const permission: MessageBody = {
  kind: 'prompt',
  promptId: 'p1',
  title: 'Allow Bash?',
  body: { kind: 'permission', tool: 'Bash', summary: 'ls', reason: null, agentId: null },
  status: 'pending',
  resolution: null,
}

function markdownOf(message: Message | undefined): string {
  if (message?.kind !== 'agent_text') {
    throw new Error('not an agent_text')
  }
  return message.markdown
}

function toolRunOf(message: Message | undefined): Extract<Message, { kind: 'tool_run' }> {
  if (message?.kind !== 'tool_run') {
    throw new Error('not a tool_run')
  }
  return message
}

function eventsSince(seq: number): ServerEvent[] {
  const events = log.eventsAfter(seq)
  if (events === 'resync') {
    throw new Error('unexpected resync')
  }
  return events
}

beforeEach(() => {
  clock = 1_000
  store = new Store(':memory:', () => clock)
  store.upsertSession({ sessionId: 's1', cwd: '/home/u/Sites/app' })
  log = new ChatLog(store, () => clock)
  log.createChat({ id: 'c1', sessionId: 's1', title: 'app session' })
})

test('general chat exists from the start', () => {
  expect(log.getChat('general')).toMatchObject({
    id: 'general',
    title: expect.any(String),
    project: null,
    cwd: null,
    status: 'active',
    spawned: false,
    busy: false,
    unread: 0,
    lastMessage: null,
    pinned: true,
    tmuxName: null,
  })
})

test('createChat fills project, cwd and spawned from the session row', () => {
  expect(log.getChat('c1')).toMatchObject({ id: 'c1', title: 'app session', project: 'app', cwd: '/home/u/Sites/app', spawned: false, tmuxName: null, pinned: false, status: 'active' })
  expect(log.listChats().map(chat => chat.id)).toEqual(['general', 'c1'])
})

test('createChat rejects an unknown session', () => {
  expect(() => log.createChat({ id: 'c2', sessionId: 'nope', title: 'x' })).toThrow()
})

test('appendMessage assigns increasing seq and keeps it after updateMessage', () => {
  const first = log.appendMessage('c1', userText('hi'))
  const second = log.appendMessage('c1', agent('hello'))
  expect(second.seq).toBeGreaterThan(first.seq)
  const updated = log.updateMessage(second.id, agent('hello, again'))
  expect(updated).toMatchObject({ id: second.id, chatId: 'c1', seq: second.seq, kind: 'agent_text', markdown: 'hello, again' })
  expect(second.id.startsWith('m_')).toBe(true)
})

test('updateMessage rejects a body of another kind', () => {
  const message = log.appendMessage('c1', agent('hello'))
  expect(() => log.updateMessage(message.id, userText('nope'))).toThrow()
})

test('user_text keeps its instructionId', () => {
  const message = log.appendMessage('c1', { kind: 'user_text', text: 'do it', status: 'queued', instructionId: 'i1' })
  expect(log.findMessage(message.id)).toMatchObject({ kind: 'user_text', status: 'queued', instructionId: 'i1' })
})

test('redacts secrets on write', () => {
  const message = log.appendMessage('c1', userText('my key is sk-ant-api03-abcdefghijklmnop'))
  expect(log.findMessage(message.id)).toMatchObject({ text: 'my key is [REDACTED]' })
})

test('redacts strings nested in tool input', () => {
  const message = log.appendMessage('c1', { kind: 'tool_run', tool: 'Bash', input: { env: [{ value: 'sk-ant-api03-abcdefghijklmnop' }] }, result: null, resultTruncated: false, status: 'running', durationMs: null })
  expect(JSON.stringify(log.findMessage(message.id))).not.toContain('sk-ant-')
})

test('stores a 200 KB agent_text without truncation', () => {
  const message = log.appendMessage('c1', agent('b'.repeat(200_000)))
  expect(markdownOf(message).length).toBe(200_000)
  expect(markdownOf(log.findMessage(message.id)).length).toBe(200_000)
})

test('caps a 1 MB tool_run result at 20 000 chars plus the marker and sets resultTruncated', () => {
  const message = log.appendMessage('c1', toolRun('a'.repeat(1_000_000)))
  const expected = `${'a'.repeat(TOOL_RESULT_MAX)}… [+${1_000_000 - TOOL_RESULT_MAX} chars]`
  expect(TOOL_RESULT_MAX).toBe(20_000)
  expect(toolRunOf(log.findMessage(message.id))).toMatchObject({ result: expected, resultTruncated: true })
})

test('a result under the cap, or none at all, is stored whole with resultTruncated false', () => {
  const whole = log.appendMessage('c1', toolRun('a'.repeat(TOOL_RESULT_MAX)))
  const none = log.appendMessage('c1', toolRun(null))
  expect(toolRunOf(whole)).toMatchObject({ result: 'a'.repeat(TOOL_RESULT_MAX), resultTruncated: false })
  expect(toolRunOf(none)).toMatchObject({ result: null, resultTruncated: false })
})

test('redaction runs before the cap', () => {
  // The secret starts at index 19 990, so cutting first would leave "sk-ant-AAA", which no pattern matches.
  const result = `${'y'.repeat(19_989)} sk-ant-${'A'.repeat(30)}`
  const message = log.appendMessage('c1', toolRun(result))
  expect(toolRunOf(message)).toMatchObject({ result: `${'y'.repeat(19_989)} [REDACTED]`, resultTruncated: false })
})

test('listMessages pages with before and hasMore', () => {
  for (const label of ['m1', 'm2', 'm3', 'm4', 'm5']) {
    log.appendMessage('c1', agent(label))
  }
  const newest = log.listMessages('c1', { limit: 2 })
  expect(newest.messages.map(markdownOf)).toEqual(['m4', 'm5'])
  expect(newest.hasMore).toBe(true)
  const middle = log.listMessages('c1', { before: newest.messages[0]?.seq, limit: 2 })
  expect(middle.messages.map(markdownOf)).toEqual(['m2', 'm3'])
  expect(middle.hasMore).toBe(true)
  const oldest = log.listMessages('c1', { before: middle.messages[0]?.seq, limit: 2 })
  expect(oldest.messages.map(markdownOf)).toEqual(['m1'])
  expect(oldest.hasMore).toBe(false)
})

test('unread counts only agent_text, prompt and system after the cursor', () => {
  log.appendMessage('c1', userText('u'))
  log.appendMessage('c1', agent('a'))
  log.appendMessage('c1', toolRun('r'))
  const system = log.appendMessage('c1', { kind: 'system', text: 'started' })
  log.appendMessage('c1', { kind: 'command_reply', text: 'ok' })
  log.appendMessage('c1', permission)
  expect(log.getChat('c1')?.unread).toBe(3)
  log.markRead('c1', system.seq)
  expect(log.getChat('c1')?.unread).toBe(1)
  log.appendMessage('c1', agent('later'))
  expect(log.getChat('c1')?.unread).toBe(2)
})

test('markRead never moves the cursor backwards', () => {
  const first = log.appendMessage('c1', agent('one'))
  const second = log.appendMessage('c1', agent('two'))
  log.markRead('c1', second.seq)
  log.markRead('c1', first.seq)
  expect(log.getChat('c1')?.unread).toBe(0)
})

test('markRead clamps to the newest message so later messages stay unread', () => {
  log.markRead('c1', 999_999)
  log.appendMessage('c1', agent('later'))
  expect(log.getChat('c1')?.unread).toBe(1)
})

test('lastMessage previews the newest visible message in at most 140 chars', () => {
  const message = log.appendMessage('c1', agent('x'.repeat(200)))
  expect(log.getChat('c1')?.lastMessage).toEqual({ seq: message.seq, at: clock, preview: 'x'.repeat(140) })
})

test('eventsAfter returns events in seq order, and resync when after is greater than currentSeq', () => {
  const before = log.currentSeq()
  log.appendMessage('c1', agent('one'))
  log.appendMessage('c1', agent('two'))
  const events = eventsSince(before)
  expect(events.map(event => event.type)).toEqual(['message.created', 'chat.updated', 'message.created', 'chat.updated'])
  const seqs = events.map(event => ('seq' in event ? event.seq : -1))
  expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
  expect(seqs.at(-1)).toBe(log.currentSeq())
  expect(eventsSince(log.currentSeq())).toEqual([])
  expect(log.eventsAfter(log.currentSeq() + 1)).toBe('resync')
})

test('message seq and event seq are separate counters', () => {
  const message = log.appendMessage('c1', agent('one'))
  expect(log.currentMessageSeq()).toBe(message.seq)
  expect(log.currentSeq()).toBeGreaterThan(message.seq)
})

test('a sourceId makes a repeated append a no-op that returns the existing message', () => {
  const first = log.appendMessage('c1', agent('x'), { sourceId: 'entry-1' })
  const eventSeq = log.currentSeq()
  const again = log.appendMessage('c1', agent('x'), { sourceId: 'entry-1' })
  expect(again.id).toBe(first.id)
  expect(log.currentSeq()).toBe(eventSeq)
  expect(log.listMessages('c1', { limit: 10 }).messages.length).toBe(1)
})

test('clearChat hides earlier messages but keeps later ones', () => {
  log.appendMessage('c1', agent('old'))
  log.clearChat('c1')
  expect(log.listMessages('c1', { limit: 10 }).messages).toEqual([])
  expect(log.getChat('c1')).toMatchObject({ unread: 0, lastMessage: null })
  log.appendMessage('c1', agent('new'))
  expect(log.listMessages('c1', { limit: 10 }).messages.map(markdownOf)).toEqual(['new'])
  expect(log.getChat('c1')).toMatchObject({ unread: 1, lastMessage: { preview: 'new' } })
})

test('updateChat patches title, status and busy and emits chat.updated', () => {
  const before = log.currentSeq()
  log.updateChat('c1', { title: 'renamed', busy: true })
  expect(log.getChat('c1')).toMatchObject({ title: 'renamed', busy: true, status: 'active' })
  expect(eventsSince(before)).toMatchObject([{ type: 'chat.updated', chat: { id: 'c1', title: 'renamed' } }])
})

test('subscribe gets each committed event in order, and a throwing listener breaks neither the append nor the others', () => {
  const errors = spyOn(console, 'error').mockImplementation(() => {})
  const seen: ServerEvent[] = []
  log.subscribe(() => {
    throw new Error('boom')
  })
  const unsubscribe = log.subscribe(event => {
    seen.push(event)
  })
  const message = log.appendMessage('c1', agent('hi'))
  expect(seen.map(event => event.type)).toEqual(['message.created', 'chat.updated'])
  expect(seen[0]).toMatchObject({ type: 'message.created', message: { id: message.id } })
  expect(log.findMessage(message.id)).toBeDefined()
  expect(errors).toHaveBeenCalled()
  unsubscribe()
  log.appendMessage('c1', agent('again'))
  expect(seen.length).toBe(2)
  errors.mockRestore()
})

test('push subscriptions are stored by endpoint and can be removed', () => {
  const endpoint = 'https://push.example/1'
  log.addPushSubscription({ endpoint, keys: { p256dh: 'p', auth: 'a' } })
  log.addPushSubscription({ endpoint, keys: { p256dh: 'p2', auth: 'a2' } })
  expect(log.listPushSubscriptions()).toEqual([{ endpoint, keys: { p256dh: 'p2', auth: 'a2' } }])
  log.removePushSubscription(endpoint)
  expect(log.listPushSubscriptions()).toEqual([])
})

test('clearChat emits chat.cleared with beforeSeq', () => {
  const message = log.appendMessage('c1', agent('old'))
  const before = log.currentSeq()
  log.clearChat('c1')
  expect(eventsSince(before)).toMatchObject([
    { type: 'chat.cleared', chatId: 'c1', beforeSeq: message.seq },
    { type: 'chat.updated', chat: { id: 'c1' } },
  ])
})

test('eventsAfter(0) after a clear omits message events for cleared messages but keeps later ones and the chat.cleared event', () => {
  const old = log.appendMessage('c1', agent('old'))
  log.clearChat('c1')
  const later = log.appendMessage('c1', agent('new'))
  const events = eventsSince(0)
  const createdIds = events.flatMap(event => (event.type === 'message.created' ? [event.message.id] : []))
  expect(createdIds).toEqual([later.id])
  expect(createdIds).not.toContain(old.id)
  expect(events.map(event => event.type)).toContain('chat.cleared')
})

test('updateMessage on a cleared message emits no message.updated', () => {
  const old = log.appendMessage('c1', agent('old'))
  log.clearChat('c1')
  const before = log.currentSeq()
  log.updateMessage(old.id, agent('edited'))
  expect(markdownOf(log.findMessage(old.id))).toBe('edited')
  expect(eventsSince(before)).toEqual([])
})

test('claim records a key once per chat and reports whether it was new', () => {
  expect(log.claim('general', 'instr:m_1')).toBe(true)
  expect(log.claim('general', 'instr:m_1')).toBe(false)
  expect(log.isClaimed('general', 'instr:m_1')).toBe(true)
  expect(log.isClaimed('general', 'instr:m_2')).toBe(false)
})
