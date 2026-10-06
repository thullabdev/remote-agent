import { Database } from 'bun:sqlite'
import { projectName, type Answer, type AnswerSource, type Instruction, type PromptBody, type SessionInfo } from '../../mod/remote-agent/hooks/protocol.ts'

export type SessionRow = { id: string; cwd: string; project: string; threadId: string | null; endedAt: number | null }

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

type SessionRecord = { id: string; cwd: string; project: string; thread_id: string | null; ended_at: number | null }
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

const SESSION_COLUMNS = 'id, cwd, project, thread_id, ended_at'
const PROMPT_COLUMNS = 'id, session_id, body, status, answer, source, partial, created_at, reminded'

function toSession(record: SessionRecord): SessionRow {
  return { id: record.id, cwd: record.cwd, project: record.project, threadId: record.thread_id, endedAt: record.ended_at }
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

  constructor(path: string, private readonly now: () => number = Date.now) {
    this.db = new Database(path, { create: true, strict: true })
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec('PRAGMA foreign_keys = ON;')
    this.db.exec(SCHEMA)
  }

  close(): void {
    this.db.close()
  }

  upsertSession(info: SessionInfo): SessionRow {
    this.db
      .query(
        `INSERT INTO sessions (id, cwd, project, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET cwd = excluded.cwd, project = excluded.project, ended_at = NULL`,
      )
      .run(info.sessionId, info.cwd, projectName(info.cwd), this.now())
    const session = this.getSession(info.sessionId)
    if (session === undefined) {
      throw new Error(`Session ${info.sessionId} vanished after upsert`)
    }
    return session
  }

  getSession(id: string): SessionRow | undefined {
    const record = this.db.query<SessionRecord, [string]>(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`).get(id)
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

  endSession(id: string): void {
    this.db.query('UPDATE sessions SET ended_at = ? WHERE id = ?').run(this.now(), id)
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
