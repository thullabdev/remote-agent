import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import type { SessionDoc, SessionRepository } from './sessions.ts'

export const MAX_OPEN_SESSIONS = 8

/** The tmux operations the routes need. The real ones live in tmux.ts; tests pass fakes. */
export type TmuxOps = {
  available(): Promise<boolean>
  create(input: { name: string; cwd: string; cols: number; rows: number; shell: string }): Promise<void>
  kill(name: string): Promise<void>
  /** Whether the tmux session is still running. A session whose shell exited is not, even though it is still stored as open. */
  alive(name: string): Promise<boolean>
}

export type RouteDeps = {
  owner: string
  repo: SessionRepository
  tmux: TmuxOps
  newSid(): string
  nameFor(sid: string): string
  shell: string
  home?: string
  /** Whether a browser has this session open on a socket right now. */
  isAttached?(sid: string): boolean
  /** The foreground command of a session's tmux session, or null when unknown. */
  foreground?(tmuxName: string): string | null
  /** Called after the open sessions change, so subscribed browsers can be told. */
  onChange?(): void
}

/** What the browser sees of a session. Internal fields such as the tmux name stay on the server. */
export type SessionView = {
  sid: string
  cwd: string
  project: string
  chatId: string | null
  createdAt: number
  lastAttachedAt: number | null
  /** True while a browser has this session open. */
  attached: boolean
  /** What the shell is running in the foreground: its own name when idle. Null when unknown. */
  command: string | null
}

export function viewOf(doc: SessionDoc, attached = false, command: string | null = null): SessionView {
  return {
    sid: doc.sid,
    cwd: doc.launchCwd,
    project: doc.project,
    chatId: doc.chatId,
    createdAt: doc.createdAt,
    lastAttachedAt: doc.lastAttachedAt,
    attached,
    command,
  }
}

/**
 * Closes every stored open session whose tmux session is gone. A shell that exits is not closed by anyone else until the
 * browser tries to open it, so without this the list, the limit and folder reuse would all count it as running.
 */
export async function pruneExited(deps: Pick<RouteDeps, 'owner' | 'repo' | 'tmux'>): Promise<void> {
  for (const doc of deps.repo.listOpen(deps.owner)) {
    if (!(await deps.tmux.alive(doc.tmuxName))) {
      deps.repo.close(doc.sid, 'missing')
    }
  }
}

export function createSessionRoutes(deps: RouteDeps) {
  const home = deps.home ?? homedir()

  return {
    /** GET: the caller's open sessions, newest first. */
    async list(): Promise<Response> {
      await pruneExited(deps)
      const sessions = deps.repo.listOpen(deps.owner).map(doc => viewOf(doc, deps.isAttached?.(doc.sid) ?? false, deps.foreground?.(doc.tmuxName) ?? null))
      return json({ sessions })
    },

    /**
     * POST: starts a shell in `cwd` (default: home) and stores the session. Nothing is stored unless tmux started.
     * A folder that is missing is an error, never a silent fallback.
     */
    async create(request: Request): Promise<Response> {
      const body = await readBody(request)
      if (body === null) {
        return json({ error: 'expected a JSON body' }, 400)
      }
      const cwd = body.cwd === undefined ? home : body.cwd
      if (typeof cwd !== 'string' || cwd.trim() === '' || cwd.length > 4096) {
        return json({ error: 'cwd must be a folder path' }, 400)
      }
      const chatId = body.chatId === undefined ? null : body.chatId
      if (chatId !== null && (typeof chatId !== 'string' || chatId.length > 200)) {
        return json({ error: 'chatId must be a chat id' }, 400)
      }
      if (!isDirectory(cwd)) {
        return json({ error: `folder does not exist: ${cwd}` }, 400)
      }
      await pruneExited(deps)
      const open = deps.repo.countOpen(deps.owner)
      if (open >= MAX_OPEN_SESSIONS) {
        return json({ error: `too many open terminals (${open} of ${MAX_OPEN_SESSIONS}); close one first`, open }, 409)
      }
      if (!(await deps.tmux.available())) {
        return json({ error: 'tmux is not installed on this machine' }, 500)
      }

      const sid = deps.newSid()
      const name = deps.nameFor(sid)
      try {
        await deps.tmux.create({ name, cwd, cols: 80, rows: 24, shell: deps.shell })
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'tmux could not start the session' }, 500)
      }
      const doc = deps.repo.create({ sid, owner: deps.owner, launchCwd: cwd, chatId, tmuxName: name })
      deps.onChange?.()
      return json({ sid, cwd: doc.launchCwd, createdAt: doc.createdAt }, 201)
    },

    /** POST: kills the session's tmux session and records the close. Only the owner's open sessions can be closed. */
    async close(request: Request): Promise<Response> {
      const body = await readBody(request)
      const sid = body?.sid
      if (typeof sid !== 'string') {
        return json({ error: 'expected { sid }' }, 400)
      }
      const doc = deps.repo.get(sid)
      if (doc === undefined || doc.owner !== deps.owner || doc.closedAt !== null) {
        return json({ error: 'no open session with that id' }, 404)
      }
      await deps.tmux.kill(doc.tmuxName)
      deps.repo.close(sid, 'user')
      deps.onChange?.()
      return json({ ok: true })
    },
  }
}

type Body = Record<string, unknown>

async function readBody(request: Request): Promise<Body | null> {
  const text = await request.text()
  if (text.trim() === '') {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Body) : null
  } catch {
    return null
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
}
