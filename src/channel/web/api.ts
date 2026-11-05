import { z } from 'zod'
import type { AwayMode } from '../../bridge/notifier.ts'
import { BadRequest } from '../../bridge/errors.ts'
import type { Log } from '../../bridge/prompts.ts'
import { BAD_MODEL, NOT_SPAWNED, NOT_TRUSTED, type Spawner } from '../../bridge/spawner.ts'
import type { SessionRow, Store } from '../../bridge/store.ts'
import type { Project } from '../../bridge/trusted.ts'
import type { ChatSink } from '../chat-sink.ts'
import type { ButtonData, ChannelHandlers } from '../types.ts'
import type { ChatLog } from './chat-log.ts'
import type { PushService } from './push.ts'
import { ActionSchema, AwaySchema, clientSourceId, PromptReplySchema, ReadSchema, SendMessageSchema, type Chat, type PushSubscriptionRecord } from './protocol.ts'

const GENERAL_ID = 'general'
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const NO_SESSION_IN_CHAT = 'No session in this chat.'
const HINT = 'Send a command like /new, /status, /away, /back.'

export type ApiDeps = {
  chatLog: ChatLog
  handlers: () => ChannelHandlers | null
  store: Store
  away: AwayMode
  spawner: Pick<Spawner, 'end' | 'newCommand' | 'fork' | 'resume'>
  sink: Pick<ChatSink, 'instructionQueued'>
  /** The folders Claude Code marks as trusted. Absent when project listing is not configured; the routes then answer 404. */
  projects?: () => Promise<Project[]>
  /** Absent when push is not configured; the push routes then answer 404. */
  push?: Pick<PushService, 'publicKey' | 'subscribe' | 'unsubscribe'>
  log: Log
}

const StartProjectSchema = z.object({
  cwd: z.string().regex(/^[/~]/, 'cwd must be an absolute path or start with ~'),
  model: z.string().regex(/^\S+$/, 'model must be one word').optional(),
})

const PushSubscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.string().refine(isHttpsUrl, 'endpoint must be an https URL'),
    keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  }),
})

const PushUnsubscribeSchema = z.object({ endpoint: z.string().min(1) })
const ArchiveChatsSchema = z.object({
  chatIds: z.array(z.string().min(1)).min(1).refine(ids => new Set(ids).size === ids.length, 'chatIds must be unique'),
})

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

class ApiError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 500 | 503,
    message: string,
  ) {
    super(message)
  }
}

type Ctx = { deps: ApiDeps; request: Request; url: URL }
/** `id` is the single `:id` segment of the pattern (a chat id or a prompt id); empty when the pattern has none. */
type Route = { method: string; pattern: string[]; run: (ctx: Ctx, id: string) => unknown }

const ROUTES: Route[] = [
  { method: 'GET', pattern: ['state'], run: ({ deps }) => state(deps) },
  { method: 'POST', pattern: ['chats', 'archive'], run: ({ deps, request }) => archiveChats(deps, request) },
  { method: 'GET', pattern: ['chats', ':id', 'messages'], run: ({ deps, url }, id) => history(deps, id, url) },
  { method: 'POST', pattern: ['chats', ':id', 'messages'], run: ({ deps, request }, id) => sendMessage(deps, request, id) },
  { method: 'POST', pattern: ['chats', ':id', 'actions'], run: ({ deps, request }, id) => action(deps, request, id) },
  { method: 'POST', pattern: ['prompts', ':id', 'reply'], run: ({ deps, request }, id) => promptReply(deps, request, id) },
  { method: 'POST', pattern: ['chats', ':id', 'read'], run: ({ deps, request }, id) => markRead(deps, request, id) },
  { method: 'POST', pattern: ['chats', ':id', 'end'], run: ({ deps }, id) => endChat(deps, id) },
  { method: 'POST', pattern: ['chats', ':id', 'archive'], run: ({ deps }, id) => archiveChat(deps, id) },
  { method: 'POST', pattern: ['chats', ':id', 'unarchive'], run: ({ deps }, id) => unarchiveChat(deps, id) },
  { method: 'POST', pattern: ['chats', ':id', 'clear'], run: ({ deps }, id) => clearHistory(deps, id) },
  { method: 'POST', pattern: ['chats', ':id', 'fork'], run: ({ deps }, id) => forkChat(deps, id) },
  { method: 'POST', pattern: ['chats', ':id', 'resume'], run: ({ deps }, id) => resumeChat(deps, id) },
  { method: 'GET', pattern: ['projects'], run: ({ deps }) => listProjects(deps) },
  { method: 'POST', pattern: ['projects', 'start'], run: ({ deps, request }) => startProject(deps, request) },
  { method: 'PUT', pattern: ['away'], run: ({ deps, request }) => setAway(deps, request) },
  { method: 'GET', pattern: ['push', 'key'], run: ({ deps }) => pushKey(deps) },
  { method: 'POST', pattern: ['push', 'subscriptions'], run: ({ deps, request }) => subscribePush(deps, request) },
  { method: 'DELETE', pattern: ['push', 'subscriptions'], run: ({ deps, request }) => unsubscribePush(deps, request) },
]

/**
 * The HTTP API of the web channel (handoff §3). Returns null for a path outside /api/ so the server can serve
 * static files; every /api/ route answers JSON. Authorization happens before this handler (see auth.ts).
 */
export function createApi(deps: ApiDeps): (request: Request) => Promise<Response | null> {
  return async request => {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) {
      return null
    }
    try {
      const segments = url.pathname.split('/').slice(2)
      const ctx: Ctx = { deps, request, url }
      for (const route of ROUTES) {
        const id = route.method === request.method ? match(segments, route.pattern) : null
        if (id !== null) {
          return json(await route.run(ctx, id))
        }
      }
      throw new ApiError(404, 'Not found.')
    } catch (error) {
      if (error instanceof ApiError) {
        return json({ error: error.message }, error.status)
      }
      if (error instanceof BadRequest) {
        return json({ error: error.message }, 400)
      }
      deps.log('web API request failed', error)
      return json({ error: 'Something went wrong.' }, 500)
    }
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function match(segments: string[], pattern: string[]): string | null {
  if (segments.length !== pattern.length) {
    return null
  }
  let id = ''
  for (const [index, part] of pattern.entries()) {
    const value = segments[index] ?? ''
    if (part === ':id') {
      id = safeDecode(value)
    } else if (part !== value) {
      return null
    }
  }
  return id
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

async function readBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw new ApiError(400, 'The request body must be JSON.')
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const problems = parsed.error.issues.map(issue => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    throw new ApiError(400, `Invalid request. ${problems.join('; ')}`)
  }
  return parsed.data
}

function requireChat(deps: ApiDeps, chatId: string): Chat {
  const chat = deps.chatLog.getChat(chatId)
  if (chat === undefined) {
    throw new ApiError(404, 'Unknown chat.')
  }
  return chat
}

function requireSession(deps: ApiDeps, chatId: string): SessionRow {
  const session = deps.store.findSessionByChat(chatId)
  if (session === undefined) {
    throw new ApiError(404, NO_SESSION_IN_CHAT)
  }
  return session
}

function requireHandlers(deps: ApiDeps): ChannelHandlers {
  const handlers = deps.handlers()
  if (handlers === null) {
    throw new ApiError(503, 'The bridge is not running.')
  }
  return handlers
}

function byRecency(a: Chat, b: Chat): number {
  if (a.id === GENERAL_ID) {
    return -1
  }
  if (b.id === GENERAL_ID) {
    return 1
  }
  return (b.lastMessage?.at ?? 0) - (a.lastMessage?.at ?? 0)
}

function state(deps: ApiDeps): unknown {
  return {
    seq: deps.chatLog.currentSeq(),
    away: deps.away.isAway(),
    chats: deps.chatLog.listChats().sort(byRecency),
  }
}

function history(deps: ApiDeps, chatId: string, url: URL): unknown {
  requireChat(deps, chatId)
  const beforeParam = url.searchParams.get('before')
  const before = beforeParam === null ? undefined : Number(beforeParam)
  if (before !== undefined && (!Number.isInteger(before) || before < 0)) {
    throw new ApiError(400, 'before must be a sequence number.')
  }
  const limitParam = url.searchParams.get('limit')
  const limit = limitParam === null || !Number.isFinite(Number(limitParam)) ? DEFAULT_LIMIT : Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(limitParam))))
  return deps.chatLog.listMessages(chatId, before === undefined ? { limit } : { before, limit })
}

async function sendMessage(deps: ApiDeps, request: Request, chatId: string): Promise<unknown> {
  const body = await readBody(request, SendMessageSchema)
  requireChat(deps, chatId)
  if (chatId === GENERAL_ID) {
    return sendGeneral(deps, body.clientId, body.text)
  }
  const session = requireSession(deps, chatId)
  const existing = deps.chatLog.findBySourceId(chatId, clientSourceId(body.clientId))
  if (existing !== undefined) {
    return { message: existing }
  }
  if (session.endedAt !== null) {
    throw new ApiError(409, 'This session has ended.')
  }
  const instruction = deps.store.enqueueInstruction(session.id, body.text)
  return { message: deps.sink.instructionQueued(instruction, session, body.clientId) }
}

async function sendGeneral(deps: ApiDeps, clientId: string, text: string): Promise<unknown> {
  const handlers = requireHandlers(deps)
  const sourceId = clientSourceId(clientId)
  const existing = deps.chatLog.findBySourceId(GENERAL_ID, sourceId)
  if (existing !== undefined) {
    return { message: existing }
  }
  const message = deps.chatLog.appendMessage(
    GENERAL_ID,
    { kind: 'user_text', text, status: 'delivered', instructionId: null },
    { sourceId },
  )
  const trimmed = text.trim()
  const reply = trimmed.startsWith('/') ? await runCommand(handlers, trimmed.slice(1).trim()) : HINT
  if (reply !== null) {
    deps.chatLog.appendMessage(GENERAL_ID, { kind: 'command_reply', text: reply })
  }
  return { message }
}

/** `body` is the command line without its slash: the first word is the name, the rest the trimmed args. */
function runCommand(handlers: ChannelHandlers, body: string): Promise<string | null> {
  const space = body.search(/\s/)
  const name = (space === -1 ? body : body.slice(0, space)).toLowerCase()
  const args = space === -1 ? '' : body.slice(space).trim()
  return handlers.onCommand({ name, args, thread: null })
}

async function action(deps: ApiDeps, request: Request, chatId: string): Promise<unknown> {
  const body = await readBody(request, ActionSchema)
  requireChat(deps, chatId)
  const handlers = requireHandlers(deps)
  const press: ButtonData =
    'promptId' in body
      ? { kind: 'answer', promptId: body.promptId, questionIndex: body.questionIndex, optionIndex: body.optionIndex }
      : { kind: 'launch', pickerId: body.pickerId, choice: body.choice }
  return { toast: await handlers.onButton(press) }
}

async function promptReply(deps: ApiDeps, request: Request, promptId: string): Promise<unknown> {
  const body = await readBody(request, PromptReplySchema)
  const prompt = deps.store.getPrompt(promptId)
  if (prompt === undefined) {
    throw new ApiError(404, 'Unknown prompt.')
  }
  const messageRef = deps.store.listPromptMessageRefs(promptId)[body.questionIndex]
  if (messageRef === undefined) {
    throw new ApiError(404, 'Unknown question.')
  }
  const chatId = deps.store.getSession(prompt.sessionId)?.chatId
  if (chatId === null || chatId === undefined) {
    throw new ApiError(404, 'Unknown session.')
  }
  const handlers = requireHandlers(deps)
  const reply = await handlers.onText({ thread: chatId, replyTo: messageRef, text: body.text })
  return { toast: reply ?? '' }
}

async function markRead(deps: ApiDeps, request: Request, chatId: string): Promise<unknown> {
  const body = await readBody(request, ReadSchema)
  requireChat(deps, chatId)
  deps.chatLog.markRead(chatId, body.seq)
  return { ok: true }
}

async function endChat(deps: ApiDeps, chatId: string): Promise<unknown> {
  requireChat(deps, chatId)
  const session = requireSession(deps, chatId)
  if (!session.spawned) {
    throw new ApiError(409, NOT_SPAWNED)
  }
  if (session.threadId === null) {
    throw new ApiError(409, 'This session has ended.')
  }
  return { toast: await deps.spawner.end(session.threadId) }
}

function archiveChat(deps: ApiDeps, chatId: string): unknown {
  const chat = requireChat(deps, chatId)
  if (chat.id === 'general') {
    throw new ApiError(409, 'Only ended Sessions can be archived.')
  }
  const session = requireSession(deps, chatId)
  if (chat.status !== 'ended' || session.endedAt === null) {
    throw new ApiError(409, 'Only ended Sessions can be archived.')
  }
  deps.chatLog.setArchived(chatId, true)
  return { toast: 'Session archived.' }
}

async function archiveChats(deps: ApiDeps, request: Request): Promise<unknown> {
  const { chatIds } = await readBody(request, ArchiveChatsSchema)
  for (const chatId of chatIds) {
    const chat = requireChat(deps, chatId)
    if (chat.id === GENERAL_ID) {
      throw new ApiError(409, 'Only ended Sessions can be archived.')
    }
    const session = requireSession(deps, chatId)
    if (chat.status !== 'ended' || session.endedAt === null) {
      throw new ApiError(409, 'Only ended Sessions can be archived.')
    }
  }
  deps.chatLog.setArchivedMany(chatIds, true)
  return { toast: `Archived ${chatIds.length} ${chatIds.length === 1 ? 'Session' : 'Sessions'}.` }
}

function unarchiveChat(deps: ApiDeps, chatId: string): unknown {
  const chat = requireChat(deps, chatId)
  if (chat.id === 'general' || !chat.archived) {
    throw new ApiError(409, 'This Session is not archived.')
  }
  deps.chatLog.setArchived(chatId, false)
  return { toast: 'Session restored.' }
}

function clearHistory(deps: ApiDeps, chatId: string): unknown {
  requireChat(deps, chatId)
  deps.chatLog.clearChat(chatId)
  return { ok: true }
}

async function forkChat(deps: ApiDeps, chatId: string): Promise<unknown> {
  requireChat(deps, chatId)
  const session = requireSession(deps, chatId)
  const toast = await deps.spawner.fork(session.id)
  if (toast === NOT_TRUSTED) {
    throw new ApiError(409, toast)
  }
  return { toast }
}

async function resumeChat(deps: ApiDeps, chatId: string): Promise<unknown> {
  requireChat(deps, chatId)
  const session = requireSession(deps, chatId)
  const toast = await deps.spawner.resume(session.id)
  if (toast === NOT_TRUSTED) {
    throw new ApiError(409, toast)
  }
  if (deps.store.getSession(session.id)?.endedAt === null) {
    deps.chatLog.setArchived(chatId, false)
  }
  return { toast }
}

function requireProjects(deps: ApiDeps): NonNullable<ApiDeps['projects']> {
  if (deps.projects === undefined) {
    throw new ApiError(404, 'Projects are not configured.')
  }
  return deps.projects
}

async function listProjects(deps: ApiDeps): Promise<unknown> {
  return { projects: await requireProjects(deps)() }
}

/** The same as `/new [--model <model>] <path>`; the picker is never posted here because the cwd is required. */
async function startProject(deps: ApiDeps, request: Request): Promise<unknown> {
  requireProjects(deps)
  const body = await readBody(request, StartProjectSchema)
  const args = body.model === undefined ? body.cwd : `--model ${body.model} ${body.cwd}`
  const reply = await deps.spawner.newCommand(null, args)
  if (reply === null) {
    throw new ApiError(400, 'cwd is required')
  }
  if (reply === NOT_TRUSTED) {
    throw new ApiError(409, reply)
  }
  if (reply === BAD_MODEL) {
    throw new ApiError(400, reply)
  }
  return { toast: reply }
}

function requirePush(deps: ApiDeps): NonNullable<ApiDeps['push']> {
  if (deps.push === undefined) {
    throw new ApiError(404, 'Push is not configured.')
  }
  return deps.push
}

function pushKey(deps: ApiDeps): unknown {
  return { key: requirePush(deps).publicKey() }
}

async function subscribePush(deps: ApiDeps, request: Request): Promise<unknown> {
  const push = requirePush(deps)
  const body = await readBody(request, PushSubscribeSchema)
  const subscription: PushSubscriptionRecord = body.subscription
  push.subscribe(subscription)
  return { ok: true }
}

async function unsubscribePush(deps: ApiDeps, request: Request): Promise<unknown> {
  const push = requirePush(deps)
  const body = await readBody(request, PushUnsubscribeSchema)
  push.unsubscribe(body.endpoint)
  return { ok: true }
}

async function setAway(deps: ApiDeps, request: Request): Promise<unknown> {
  const body = await readBody(request, AwaySchema)
  deps.away.set(body.away)
  return { away: body.away }
}
