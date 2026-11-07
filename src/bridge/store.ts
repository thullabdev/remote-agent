import { Database } from 'bun:sqlite'
import { accountLimits, sessionUsage, type AccountUsageView, type SessionUsageView, type UsageReport } from './usage.ts'
import { projectName, type Answer, type AnswerSource, type Instruction, type PromptBody, type SessionInfo } from '../../mod/remote-agent/hooks/protocol.ts'

export type SessionRow = {
  id: string
  cwd: string
  project: string
  threadId: string | null
  title: string | null
  endedAt: number | null
  spawned: boolean
  tmuxName: string | null
  startedAt: number | null
  chatId: string | null
}

export type PromptRow = {
  id: string
  sessionId: string
  body: PromptBody
  status: 'pending' | 'answered'
  answer: Answer | null
  source: AnswerSource | null
  partial: Record<string, string>
  createdAt: number
  reminded: boolean
}

export type PromptMessageLink = { promptId: string; questionIndex: number }

type SessionRecord = {
  id: string
  cwd: string
  project: string
  thread_id: string | null
  title: string | null
  ended_at: number | null
  spawned: number
  tmux_name: string | null
  started_at: number | null
  chat_id: string | null
}
type PromptRecord = {
  id: string
  session_id: string
  body: string
  status: 'pending' | 'answered'
  answer: string | null
  source: AnswerSource | null
  partial: string
  created_at: number
  reminded: number
}
type InstructionRecord = { id: string; session_id: string; text: string }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, cwd TEXT NOT NULL, project TEXT NOT NULL, thread_id TEXT,
  created_at INTEGER NOT NULL, ended_at INTEGER
);
CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', answer TEXT, source TEXT, partial TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL, answered_at INTEGER, reminded INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS prompt_messages (
  message_ref TEXT PRIMARY KEY, prompt_id TEXT NOT NULL REFERENCES prompts(id), question_index INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS instructions (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, delivered_at INTEGER
);
`

const SESSION_COLUMNS = 'id, cwd, project, thread_id, title, ended_at, spawned, tmux_name, started_at, chat_id'
const PROMPT_COLUMNS = 'id, session_id, body, status, answer, source, partial, created_at, reminded'

function toSession(record: SessionRecord): SessionRow {
  return {
    id: record.id,
    cwd: record.cwd,
    project: record.project,
    threadId: record.thread_id,
    title: record.title,
    endedAt: record.ended_at,
    spawned: record.spawned === 1,
    tmuxName: record.tmux_name,
    startedAt: record.started_at,
    chatId: record.chat_id,
  }
}

function toPrompt(record: PromptRecord): PromptRow {
  return {
    id: record.id,
    sessionId: record.session_id,
    body: JSON.parse(record.body) as PromptBody,
    status: record.status,
    answer: record.answer === null ? null : (JSON.parse(record.answer) as Answer),
    source: record.source,
    partial: JSON.parse(record.partial) as Record<string, string>,
    createdAt: record.created_at,
    reminded: record.reminded === 1,
  }
}

function toInstruction(record: InstructionRecord): Instruction {
  return { id: record.id, sessionId: record.session_id, text: record.text }
}

export class Store {
  private readonly db: Database
  private readonly usage = new Map<string, { report: UsageReport; measuredAt: number }>()

  constructor(path: string, private readonly now: () => number = Date.now) {
    this.db = new Database(path, { create: true, strict: true })
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec('PRAGMA foreign_keys = ON;')
    this.db.exec(SCHEMA)
    this.migrate()
  }

  private migrate(): void {
    const columns = new Set(this.db.query<{ name: string }, []>('PRAGMA table_info(sessions)').all().map(column => column.name))
    const added: [string, string][] = [
      ['title', 'title TEXT'],
      ['spawned', 'spawned INTEGER NOT NULL DEFAULT 0'],
      ['tmux_name', 'tmux_name TEXT'],
      ['started_at', 'started_at INTEGER'],
      ['chat_id', 'chat_id TEXT'],
    ]
    for (const [name, definition] of added) {
      if (!columns.has(name)) {
        this.db.exec(`ALTER TABLE sessions ADD COLUMN ${definition}`)
      }
    }
  }

  get database(): Database {
    return this.db
  }

  close(): void {
    this.db.close()
  }

  upsertSession(info: SessionInfo): SessionRow {
    this.db
      .query(
        `INSERT INTO sessions (id, cwd, project, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET cwd = excluded.cwd, project = excluded.project,
         ended_at = CASE WHEN sessions.spawned = 1 THEN sessions.ended_at ELSE NULL END`,
      )
      .run(info.sessionId, info.cwd, projectName(info.cwd), this.now())
    const session = this.getSession(info.sessionId)
    if (session === undefined) {
      throw new Error(`Session ${info.sessionId} vanished after upsert`)
    }
    return session
  }

  createSpawnedSession(spawn: { id: string; cwd: string; tmuxName: string }): SessionRow {
    this.db
      .query('INSERT INTO sessions (id, cwd, project, created_at, spawned, tmux_name) VALUES (?, ?, ?, ?, 1, ?)')
      .run(spawn.id, spawn.cwd, projectName(spawn.cwd), this.now(), spawn.tmuxName)
    const session = this.getSession(spawn.id)
    if (session === undefined) {
      throw new Error(`Session ${spawn.id} vanished after insert`)
    }
    return session
  }

  /** True only for the first call on a Spawned Session, so concurrent mod requests post one Ready. */
  markSpawnedStarted(id: string): boolean {
    const result = this.db
      .query('UPDATE sessions SET started_at = ? WHERE id = ? AND spawned = 1 AND started_at IS NULL')
      .run(this.now(), id)
    return result.changes === 1
  }

  getSession(id: string): SessionRow | undefined {
    const record = this.db.query<SessionRecord, [string]>(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`).get(id)
    return record === null ? undefined : toSession(record)
  }

  findSessionByChat(chatId: string): SessionRow | undefined {
    const record = this.db.query<SessionRecord, [string]>(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE chat_id = ?`).get(chatId)
    return record === null ? undefined : toSession(record)
  }

  findSessionByThread(threadId: string): SessionRow | undefined {
    const record = this.db.query<SessionRecord, [string]>(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE thread_id = ?`).get(threadId)
    return record === null ? undefined : toSession(record)
  }

  listActiveSessions(): SessionRow[] {
    return this.db
      .query<SessionRecord, []>(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE ended_at IS NULL ORDER BY created_at`)
      .all()
      .map(toSession)
  }

  setSessionThread(id: string, threadId: string | null): void {
    this.db.query('UPDATE sessions SET thread_id = ? WHERE id = ?').run(threadId, id)
  }

  // Usage is deliberately in memory only: it is lost on restart and refills on the next report.
  recordUsage(sessionId: string, report: UsageReport): SessionUsageView {
    const measuredAt = this.now()
    // Delete first so Map order follows recording order, which breaks measuredAt ties.
    this.usage.delete(sessionId)
    this.usage.set(sessionId, { report, measuredAt })
    return sessionUsage(report, measuredAt)
  }

  usageForChats(now: number): { account: AccountUsageView; chats: Record<string, SessionUsageView> } {
    // Newest first; the sort is stable over reversed insertion order so a later report wins a tie.
    const readings = [...this.usage].reverse().sort((a, b) => b[1].measuredAt - a[1].measuredAt)
    const chats: Record<string, SessionUsageView> = {}
    let account: AccountUsageView = null
    for (const [sessionId, reading] of readings) {
      // Readings are newest first, so when two sessions share a chat the first (newest) reading wins.
      const chatId = this.getSession(sessionId)?.chatId ?? null
      if (chatId !== null && chats[chatId] === undefined) {
        chats[chatId] = sessionUsage(reading.report, reading.measuredAt)
      }
      // The emptiness check is only a cheap skip; accountLimits decides whether any window is live.
      // Account limits count whichever session reported them, known to the Bridge or not.
      if (account === null && reading.report.rateLimits.length > 0) {
        const limits = accountLimits(reading.report.rateLimits, now)
        if (limits !== null) {
          account = { ...limits, measuredAt: reading.measuredAt }
        }
      }
    }
    return { account, chats }
  }

  setSessionChat(id: string, chatId: string): void {
    this.db.query('UPDATE sessions SET chat_id = ? WHERE id = ?').run(chatId, id)
  }

  setSessionTitle(id: string, title: string): void {
    this.db.query('UPDATE sessions SET title = ? WHERE id = ?').run(title, id)
  }

  endSession(id: string): void {
    this.db.query('UPDATE sessions SET ended_at = ? WHERE id = ?').run(this.now(), id)
  }

  /** Reopens an ended Session under its existing id as a Bridge-managed tmux Session. */
  resumeSpawnedSession(id: string, tmuxName: string): boolean {
    const result = this.db
      .query('UPDATE sessions SET thread_id = NULL, ended_at = NULL, spawned = 1, tmux_name = ?, started_at = NULL WHERE id = ? AND ended_at IS NOT NULL')
      .run(tmuxName, id)
    return result.changes === 1
  }

  insertPrompt(id: string, sessionId: string, body: PromptBody): boolean {
    const result = this.db
      .query('INSERT OR IGNORE INTO prompts (id, session_id, body, created_at) VALUES (?, ?, ?, ?)')
      .run(id, sessionId, JSON.stringify(body), this.now())
    return result.changes === 1
  }

  getPrompt(id: string): PromptRow | undefined {
    const record = this.db.query<PromptRecord, [string]>(`SELECT ${PROMPT_COLUMNS} FROM prompts WHERE id = ?`).get(id)
    return record === null ? undefined : toPrompt(record)
  }

  resolvePrompt(id: string, answer: Answer, source: AnswerSource): boolean {
    const result = this.db
      .query(`UPDATE prompts SET status = 'answered', answer = ?, source = ?, answered_at = ? WHERE id = ? AND status = 'pending'`)
      .run(JSON.stringify(answer), source, this.now(), id)
    return result.changes === 1
  }

  setPartial(id: string, partial: Record<string, string>): void {
    this.db.query('UPDATE prompts SET partial = ? WHERE id = ?').run(JSON.stringify(partial), id)
  }

  listPendingPrompts(): PromptRow[] {
    return this.db
      .query<PromptRecord, []>(`SELECT ${PROMPT_COLUMNS} FROM prompts WHERE status = 'pending' ORDER BY created_at`)
      .all()
      .map(toPrompt)
  }

  listStalePrompts(cutoff: number): PromptRow[] {
    return this.db
      .query<PromptRecord, [number]>(
        `SELECT ${PROMPT_COLUMNS} FROM prompts WHERE status = 'pending' AND reminded = 0 AND created_at <= ? ORDER BY created_at`,
      )
      .all(cutoff)
      .map(toPrompt)
  }

  markReminded(id: string): void {
    this.db.query('UPDATE prompts SET reminded = 1 WHERE id = ?').run(id)
  }

  addPromptMessage(promptId: string, messageRef: string, questionIndex: number): void {
    this.db
      .query('INSERT OR REPLACE INTO prompt_messages (message_ref, prompt_id, question_index) VALUES (?, ?, ?)')
      .run(messageRef, promptId, questionIndex)
  }

  findPromptMessage(messageRef: string): PromptMessageLink | undefined {
    const record = this.db
      .query<{ prompt_id: string; question_index: number }, [string]>('SELECT prompt_id, question_index FROM prompt_messages WHERE message_ref = ?')
      .get(messageRef)
    return record === null ? undefined : { promptId: record.prompt_id, questionIndex: record.question_index }
  }

  listPromptMessageRefs(promptId: string): string[] {
    return this.db
      .query<{ message_ref: string }, [string]>('SELECT message_ref FROM prompt_messages WHERE prompt_id = ? ORDER BY question_index')
      .all(promptId)
      .map(record => record.message_ref)
  }

  enqueueInstruction(sessionId: string, text: string): Instruction {
    const id = crypto.randomUUID()
    this.db.query('INSERT INTO instructions (id, session_id, text, created_at) VALUES (?, ?, ?, ?)').run(id, sessionId, text, this.now())
    return { id, sessionId, text }
  }

  getInstruction(id: string): Instruction | undefined {
    const record = this.db.query<InstructionRecord, [string]>('SELECT id, session_id, text FROM instructions WHERE id = ?').get(id)
    return record === null ? undefined : toInstruction(record)
  }

  listPendingInstructions(sessionId: string): Instruction[] {
    return this.db
      .query<InstructionRecord, [string]>(`SELECT id, session_id, text FROM instructions WHERE session_id = ? AND status = 'pending' ORDER BY created_at`)
      .all(sessionId)
      .map(toInstruction)
  }

  markInstructionDelivered(id: string): boolean {
    const result = this.db
      .query(`UPDATE instructions SET status = 'delivered', delivered_at = ? WHERE id = ? AND status = 'pending'`)
      .run(this.now(), id)
    return result.changes === 1
  }
}
