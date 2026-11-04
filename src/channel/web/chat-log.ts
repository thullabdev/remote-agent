import type { Database } from 'bun:sqlite'
import type { Store } from '../../bridge/store.ts'
import { redactSecrets, truncate } from '../../core/text.ts'
import type { Chat, Message, MessageBody, PushSubscriptionRecord, ServerEvent } from './protocol.ts'

export const TOOL_RESULT_MAX = 20_000
/** A reconnect further behind than this gets a resync instead of a replay, so one client cannot load the whole feed. */
export const MAX_REPLAY_EVENTS = 5_000
export const MAX_REPLAY_BYTES = 4 * 1024 * 1024

export type ChatLogLimits = { maxReplayEvents?: number; maxReplayBytes?: number }

const PREVIEW_MAX = 140
const GENERAL_ID = 'general'
const UNREAD_KINDS = `('agent_text', 'prompt', 'system')`
const MESSAGE_ADDED_COLUMNS: [string, string][] = [['counts_unread', 'counts_unread INTEGER NOT NULL DEFAULT 1']]

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY, session_id TEXT REFERENCES sessions(id), title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', busy INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
  hidden_before_seq INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id), seq INTEGER NOT NULL UNIQUE,
  kind TEXT NOT NULL, body TEXT NOT NULL, source_id TEXT, created_at INTEGER NOT NULL,
  counts_unread INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS messages_chat_seq ON messages (chat_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS messages_chat_source ON messages (chat_id, source_id);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source_claims (
  chat_id TEXT NOT NULL, key TEXT NOT NULL, PRIMARY KEY (chat_id, key)
);
CREATE TABLE IF NOT EXISTS read_cursors (
  chat_id TEXT PRIMARY KEY REFERENCES chats(id), seq INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY, subscription TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
);
`

const CHAT_SELECT = `SELECT c.id, c.title, c.status, c.busy, c.pinned, c.hidden_before_seq,
  s.project, s.cwd, s.spawned, s.tmux_name,
  COALESCE((SELECT r.seq FROM read_cursors r WHERE r.chat_id = c.id), 0) AS cursor
  FROM chats c LEFT JOIN sessions s ON s.id = c.session_id`

const MESSAGE_COLUMNS = 'id, chat_id, seq, body, created_at'

type ChatRecord = {
  id: string
  title: string
  status: 'active' | 'ended'
  busy: number
  pinned: number
  hidden_before_seq: number
  project: string | null
  cwd: string | null
  spawned: number | null
  tmux_name: string | null
  cursor: number
}

type MessageRecord = { id: string; chat_id: string; seq: number; body: string; created_at: number }

type EventRecord = { seq: number; type: string; payload: string }

type Work<T> = () => { value: T; events: ServerEvent[] }

function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactSecrets(value)
  }
  if (Array.isArray(value)) {
    return value.map(redactDeep)
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item)]))
  }
  return value
}

// Redaction runs first, so a secret cut by the cap cannot leak as a fragment.
function normalizeBody(body: MessageBody): MessageBody {
  const redacted = redactDeep(body) as MessageBody
  if (redacted.kind !== 'tool_run') {
    return redacted
  }
  if (redacted.result === null) {
    return { ...redacted, resultTruncated: false }
  }
  return {
    ...redacted,
    result: truncate(redacted.result, TOOL_RESULT_MAX),
    resultTruncated: redacted.result.length > TOOL_RESULT_MAX,
  }
}

function previewOf(body: MessageBody): string {
  const source =
    body.kind === 'agent_text' ? body.markdown : body.kind === 'prompt' ? body.title : body.kind === 'tool_run' ? body.tool : body.text
  return source.slice(0, PREVIEW_MAX)
}

function toMessage(record: MessageRecord): Message {
  return {
    ...(JSON.parse(record.body) as MessageBody),
    id: record.id,
    chatId: record.chat_id,
    seq: record.seq,
    at: record.created_at,
  }
}

/**
 * The web channel's source of truth: chats, messages, the change feed and read cursors.
 * A message's seq is its order and never changes; an event's seq is the feed position used for resume.
 */
export class ChatLog {
  private readonly db: Database
  private readonly listeners = new Set<(event: ServerEvent) => void>()
  private readonly outbox: ServerEvent[] = []
  private dispatching = false
  private readonly maxReplayEvents: number
  private readonly maxReplayBytes: number

  constructor(
    private readonly store: Store,
    private readonly now: () => number = Date.now,
    limits: ChatLogLimits = {},
  ) {
    this.maxReplayEvents = limits.maxReplayEvents ?? MAX_REPLAY_EVENTS
    this.maxReplayBytes = limits.maxReplayBytes ?? MAX_REPLAY_BYTES
    this.db = store.database
    this.db.exec(SCHEMA)
    // Databases made before a column existed get it here; old rows keep the default (they count as unread).
    const columns = new Set(this.db.query<{ name: string }, []>('PRAGMA table_info(messages)').all().map(column => column.name))
    for (const [name, definition] of MESSAGE_ADDED_COLUMNS) {
      if (!columns.has(name)) {
        this.db.exec(`ALTER TABLE messages ADD COLUMN ${definition}`)
      }
    }
    this.write(() => {
      const inserted = this.db
        .query(`INSERT OR IGNORE INTO chats (id, title, pinned, created_at) VALUES (?, 'General', 1, ?)`)
        .run(GENERAL_ID, this.now())
      return { value: undefined, events: inserted.changes === 1 ? [this.emitChat(GENERAL_ID)] : [] }
    })
  }

  subscribe(listener: (event: ServerEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  createChat(input: { id: string; sessionId: string | null; title: string }): Chat {
    if (input.sessionId !== null && this.store.getSession(input.sessionId) === undefined) {
      throw new Error(`Unknown session ${input.sessionId}`)
    }
    return this.write(() => {
      this.db
        .query('INSERT INTO chats (id, session_id, title, created_at) VALUES (?, ?, ?, ?)')
        .run(input.id, input.sessionId, input.title, this.now())
      return { value: this.chatOrThrow(input.id), events: [this.emitChat(input.id)] }
    })
  }

  /** Ties an existing chat to a Session, so its project, cwd and spawned fields come from that Session. */
  linkSession(chatId: string, sessionId: string): Chat {
    if (this.store.getSession(sessionId) === undefined) {
      throw new Error(`Unknown session ${sessionId}`)
    }
    return this.write(() => {
      this.chatOrThrow(chatId)
      this.db.query('UPDATE chats SET session_id = ? WHERE id = ?').run(sessionId, chatId)
      return { value: this.chatOrThrow(chatId), events: [this.emitChat(chatId)] }
    })
  }

  updateChat(id: string, patch: Partial<Pick<Chat, 'title' | 'status' | 'busy'>>): Chat {
    return this.write(() => {
      const current = this.chatOrThrow(id)
      const next = {
        title: patch.title ?? current.title,
        status: patch.status ?? current.status,
        busy: patch.busy ?? current.busy,
      }
      this.db.query('UPDATE chats SET title = ?, status = ?, busy = ? WHERE id = ?').run(next.title, next.status, next.busy ? 1 : 0, id)
      return { value: this.chatOrThrow(id), events: [this.emitChat(id)] }
    })
  }

  /**
   * `at` is the message's time (default: now); it is what lastMessage.at and the list order use. `history` marks backfilled
   * transcript messages, which are stored as read. Seq stays creation order either way.
   */
  appendMessage(chatId: string, body: MessageBody, options: { sourceId?: string; at?: number; history?: boolean } = {}): Message {
    const stored = normalizeBody(body)
    const sourceId = options.sourceId ?? null
    return this.write(() => {
      this.chatOrThrow(chatId)
      const id = `m_${crypto.randomUUID()}`
      const seq = this.currentMessageSeq() + 1
      const at = options.at ?? this.now()
      const inserted = this.db
        .query(
          `INSERT INTO messages (id, chat_id, seq, kind, body, source_id, created_at, counts_unread) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(chat_id, source_id) DO NOTHING`,
        )
        .run(id, chatId, seq, stored.kind, JSON.stringify(stored), sourceId, at, options.history === true ? 0 : 1)
      if (sourceId !== null && inserted.changes === 0) {
        return { value: this.messageBySource(chatId, sourceId), events: [] }
      }
      const message = { ...stored, id, chatId, seq, at } as Message
      return { value: message, events: [this.emit('message.created', { message }), this.emitChat(chatId)] }
    })
  }

  updateMessage(id: string, body: MessageBody): Message {
    const stored = normalizeBody(body)
    return this.write(() => {
      const current = this.findMessage(id)
      if (current === undefined) {
        throw new Error(`Unknown message ${id}`)
      }
      if (current.kind !== stored.kind) {
        throw new Error(`Message ${id} is ${current.kind}, not ${stored.kind}`)
      }
      this.db.query('UPDATE messages SET body = ? WHERE id = ?').run(JSON.stringify(stored), id)
      const message = { ...stored, id, chatId: current.chatId, seq: current.seq, at: current.at } as Message
      if (current.seq <= this.hiddenBefore(current.chatId)) {
        return { value: message, events: [] }
      }
      const events = [this.emit('message.updated', { message })]
      if (this.lastVisible(current.chatId)?.seq === current.seq) {
        events.push(this.emitChat(current.chatId))
      }
      return { value: message, events }
    })
  }

  listChats(): Chat[] {
    return this.db
      .query<ChatRecord, []>(`${CHAT_SELECT} ORDER BY c.pinned DESC, c.created_at, c.id`)
      .all()
      .map(record => this.toChat(record))
  }

  getChat(id: string): Chat | undefined {
    const record = this.db.query<ChatRecord, [string]>(`${CHAT_SELECT} WHERE c.id = ?`).get(id)
    return record === null ? undefined : this.toChat(record)
  }

  /** The message appended with this source id (for instructions, the instruction id). */
  findMessageBySource(sourceId: string): Message | undefined {
    const record = this.db.query<MessageRecord, [string]>(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE source_id = ?`).get(sourceId)
    return record === null ? undefined : toMessage(record)
  }

  /** The message of this chat appended with this source id (a client id, for idempotent sends). */
  findBySourceId(chatId: string, sourceId: string): Message | undefined {
    const record = this.db
      .query<MessageRecord, [string, string]>(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE chat_id = ? AND source_id = ?`)
      .get(chatId, sourceId)
    return record === null ? undefined : toMessage(record)
  }

  /** Records a key for a chat (a transcript entry handled, or an instruction matched). True only when the key was new. */
  claim(chatId: string, key: string): boolean {
    return this.write(() => {
      const inserted = this.db.query('INSERT OR IGNORE INTO source_claims (chat_id, key) VALUES (?, ?)').run(chatId, key)
      return { value: inserted.changes === 1, events: [] }
    })
  }

  isClaimed(chatId: string, key: string): boolean {
    return this.db.query<{ found: number }, [string, string]>('SELECT 1 AS found FROM source_claims WHERE chat_id = ? AND key = ?').get(chatId, key) !== null
  }

  /** The oldest Instruction-made user_text of the chat with this text that no transcript line has claimed yet. */
  findUnclaimedInstruction(chatId: string, text: string): Message | undefined {
    const record = this.db
      .query<MessageRecord, [string, string]>(
        `SELECT ${MESSAGE_COLUMNS} FROM messages m
         WHERE m.chat_id = ? AND m.kind = 'user_text' AND json_extract(m.body, '$.instructionId') IS NOT NULL
           AND json_extract(m.body, '$.text') = ?
           AND NOT EXISTS (SELECT 1 FROM source_claims s WHERE s.chat_id = m.chat_id AND s.key = 'instr:' || m.id)
         ORDER BY m.seq LIMIT 1`,
      )
      .get(chatId, text)
    return record === null ? undefined : toMessage(record)
  }

  /** The user_text message created for an Instruction, whatever source id it was appended with. */
  findByInstructionId(instructionId: string): Message | undefined {
    const record = this.db
      .query<MessageRecord, [string]>(
        `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE kind = 'user_text' AND json_extract(body, '$.instructionId') = ?`,
      )
      .get(instructionId)
    return record === null ? undefined : toMessage(record)
  }

  findMessage(id: string): Message | undefined {
    const record = this.db.query<MessageRecord, [string]>(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ?`).get(id)
    return record === null ? undefined : toMessage(record)
  }

  /** Messages in ascending seq order: the newest page, or the page older than `before` (exclusive). */
  listMessages(chatId: string, options: { before?: number; limit: number }): { messages: Message[]; hasMore: boolean } {
    const rows = this.db
      .query<MessageRecord, [string, number, number, number]>(
        `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE chat_id = ? AND seq > ? AND seq < ? ORDER BY seq DESC LIMIT ?`,
      )
      .all(chatId, this.hiddenBefore(chatId), options.before ?? Number.MAX_SAFE_INTEGER, options.limit + 1)
    return {
      messages: rows.slice(0, options.limit).reverse().map(toMessage),
      hasMore: rows.length > options.limit,
    }
  }

  /** The read cursor only moves forward, and never past the newest message. */
  markRead(chatId: string, seq: number): void {
    this.write(() => {
      this.chatOrThrow(chatId)
      const target = Math.min(seq, this.currentMessageSeq())
      if (target <= this.readCursor(chatId)) {
        return { value: undefined, events: [] }
      }
      this.db
        .query('INSERT INTO read_cursors (chat_id, seq) VALUES (?, ?) ON CONFLICT(chat_id) DO UPDATE SET seq = excluded.seq')
        .run(chatId, target)
      return { value: undefined, events: [this.emitChat(chatId)] }
    })
  }

  /** Hides every message so far from listings and replays; later messages stay visible. */
  clearChat(chatId: string): void {
    this.write(() => {
      this.chatOrThrow(chatId)
      const beforeSeq = this.currentMessageSeq()
      this.db.query('UPDATE chats SET hidden_before_seq = ? WHERE id = ?').run(beforeSeq, chatId)
      return { value: undefined, events: [this.emit('chat.cleared', { chatId, beforeSeq }), this.emitChat(chatId)] }
    })
  }

  /** Appends an away.updated event for a change of away mode (events only, no table of its own). */
  recordAway(away: boolean): ServerEvent {
    return this.write(() => {
      const event = this.emit('away.updated', { away })
      return { value: event, events: [event] }
    })
  }

  /** Latest event seq: what GET /api/state and /ws?after= use. */
  currentSeq(): number {
    return this.maxSeq('events')
  }

  /** Latest message seq. */
  currentMessageSeq(): number {
    return this.maxSeq('messages')
  }

  /** Message events for messages hidden by a clear are left out; the chat.cleared event tells clients to drop them. */
  eventsAfter(seq: number): ServerEvent[] | 'resync' {
    if (seq > this.currentSeq()) {
      return 'resync'
    }
    const oldest = this.db.query<{ seq: number | null }, []>('SELECT MIN(seq) AS seq FROM events').get()?.seq ?? null
    if (oldest !== null && seq < oldest - 1) {
      return 'resync'
    }
    // Counted before any row is loaded, so a long-offline client costs one query, not the whole feed in memory.
    const backlog = this.db
      .query<{ count: number; bytes: number }, [number]>('SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(payload)), 0) AS bytes FROM events WHERE seq > ?')
      .get(seq)
    if (backlog !== null && (backlog.count > this.maxReplayEvents || backlog.bytes > this.maxReplayBytes)) {
      return 'resync'
    }
    const hidden = new Map<string, number>()
    const hiddenOf = (chatId: string): number => {
      const cached = hidden.get(chatId)
      if (cached !== undefined) {
        return cached
      }
      const value = this.hiddenBefore(chatId)
      hidden.set(chatId, value)
      return value
    }
    const events: ServerEvent[] = []
    for (const record of this.db
      .query<EventRecord, [number]>('SELECT seq, type, payload FROM events WHERE seq > ? ORDER BY seq')
      .all(seq)) {
      const event = { type: record.type, seq: record.seq, ...JSON.parse(record.payload) } as ServerEvent
      if (event.type === 'message.created' || event.type === 'message.updated') {
        if (event.message.seq <= hiddenOf(event.message.chatId)) {
          continue
        }
      }
      events.push(event)
    }
    return events
  }

  addPushSubscription(subscription: PushSubscriptionRecord): void {
    const now = this.now()
    this.db
      .query(
        `INSERT INTO push_subscriptions (endpoint, subscription, created_at, last_seen) VALUES (?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET subscription = excluded.subscription, last_seen = excluded.last_seen`,
      )
      .run(subscription.endpoint, JSON.stringify(subscription), now, now)
  }

  removePushSubscription(endpoint: string): void {
    this.db.query('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint)
  }

  listPushSubscriptions(): PushSubscriptionRecord[] {
    return this.db
      .query<{ subscription: string }, []>('SELECT subscription FROM push_subscriptions ORDER BY created_at, endpoint')
      .all()
      .map(record => JSON.parse(record.subscription) as PushSubscriptionRecord)
  }

  /** Runs the work in one transaction, then notifies listeners in seq order. */
  private write<T>(work: Work<T>): T {
    const committed = this.db.transaction(work)() as ReturnType<Work<T>>
    this.publish(committed.events)
    return committed.value
  }

  // A listener that writes re-enters here; its events queue behind the ones being delivered, keeping seq order.
  private publish(events: ServerEvent[]): void {
    this.outbox.push(...events)
    if (this.dispatching) {
      return
    }
    this.dispatching = true
    try {
      for (let event = this.outbox.shift(); event !== undefined; event = this.outbox.shift()) {
        for (const listener of [...this.listeners]) {
          try {
            listener(event)
          } catch (error) {
            console.error('ChatLog listener failed', error)
          }
        }
      }
    } finally {
      this.dispatching = false
    }
  }

  private emit(type: 'message.created' | 'message.updated', payload: { message: Message }): ServerEvent
  private emit(type: 'chat.updated', payload: { chat: Chat }): ServerEvent
  private emit(type: 'chat.cleared', payload: { chatId: string; beforeSeq: number }): ServerEvent
  private emit(type: 'away.updated', payload: { away: boolean }): ServerEvent
  private emit(type: string, payload: object): ServerEvent {
    const row = this.db
      .query<{ seq: number }, [string, string]>('INSERT INTO events (type, payload) VALUES (?, ?) RETURNING seq')
      .get(type, JSON.stringify(payload))
    if (row === null) {
      throw new Error('Event insert returned no seq')
    }
    return { type, seq: row.seq, ...payload } as ServerEvent
  }

  private emitChat(chatId: string): ServerEvent {
    return this.emit('chat.updated', { chat: this.chatOrThrow(chatId) })
  }

  private chatOrThrow(id: string): Chat {
    const chat = this.getChat(id)
    if (chat === undefined) {
      throw new Error(`Unknown chat ${id}`)
    }
    return chat
  }

  private messageBySource(chatId: string, sourceId: string): Message {
    const record = this.db
      .query<MessageRecord, [string, string]>(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE chat_id = ? AND source_id = ?`)
      .get(chatId, sourceId)
    if (record === null) {
      throw new Error(`No message with source ${sourceId} in ${chatId}`)
    }
    return toMessage(record)
  }

  private hiddenBefore(chatId: string): number {
    return this.db.query<{ hidden_before_seq: number }, [string]>('SELECT hidden_before_seq FROM chats WHERE id = ?').get(chatId)?.hidden_before_seq ?? 0
  }

  private readCursor(chatId: string): number {
    return this.db.query<{ seq: number }, [string]>('SELECT seq FROM read_cursors WHERE chat_id = ?').get(chatId)?.seq ?? 0
  }

  private lastVisible(chatId: string): Message | undefined {
    const record = this.db
      .query<MessageRecord, [string, number]>(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE chat_id = ? AND seq > ? ORDER BY seq DESC LIMIT 1`)
      .get(chatId, this.hiddenBefore(chatId))
    return record === null ? undefined : toMessage(record)
  }

  private maxSeq(table: 'events' | 'messages'): number {
    return this.db.query<{ seq: number }, []>(`SELECT COALESCE(MAX(seq), 0) AS seq FROM ${table}`).get()?.seq ?? 0
  }

  private toChat(record: ChatRecord): Chat {
    const floor = Math.max(record.cursor, record.hidden_before_seq)
    const unread = this.db
      .query<{ count: number }, [string, number]>(`SELECT COUNT(*) AS count FROM messages WHERE chat_id = ? AND seq > ? AND kind IN ${UNREAD_KINDS} AND counts_unread = 1`)
      .get(record.id, floor)
    const last = this.lastVisible(record.id)
    return {
      id: record.id,
      title: record.title,
      project: record.project,
      cwd: record.cwd,
      status: record.status,
      spawned: record.spawned === 1,
      busy: record.busy === 1,
      unread: unread?.count ?? 0,
      lastMessage: last === undefined ? null : { seq: last.seq, at: last.at, preview: previewOf(last) },
      pinned: record.pinned === 1,
      tmuxName: record.tmux_name,
    }
  }
}
