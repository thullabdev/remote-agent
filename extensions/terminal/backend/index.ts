import { z } from 'zod'
import type { ExtensionApi } from '../../../src/extension-sdk/index.ts'
import { attach, replayFor, type Attachment } from './attach.ts'
import { IDLE_CHECK_MS, reconcile, sweepIdle, type LifecycleDeps } from './lifecycle.ts'
import { createSessionEvents, EVENTS_WS_PATH, frameOf, type EventSocket } from './events.ts'
import { createSessionRoutes, viewOf, type SessionView } from './routes.ts'
import { createSessionRepository, type SessionDoc, type SessionRepository } from './sessions.ts'
import { createSession, foregroundCommands, hasSession, killSession, sessionNameFor, tmuxAvailable } from './tmux.ts'

/** WebSocket route, under /api/extensions/remote-agent.terminal. One socket attaches to one stored session. */
export const TERMINAL_WS_PATH = '/ws'

/** How often a stored session whose shell has exited is closed, so subscribers hear about it within seconds. */
export const LIVENESS_CHECK_MS = 5_000

/**
 * How often the whole list is sent to subscribers even when nothing changed. A connection that died without a close (a phone
 * asleep, a network change) then shows up as silence on the browser's side, and the browser reconnects.
 */
export const HEARTBEAT_MS = 15_000
/** How often the foreground command of each shell is read. A change is published at once, so the tab title follows within about this long. */
export const COMMAND_POLL_MS = 2_000

const MAX_INPUT_CHARS = 64 * 1024
const Sid = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/)
const Size = { cols: z.number().int().min(1).max(500), rows: z.number().int().min(1).max(200) }

/** Every frame from the browser is validated before it touches a session. `cwd` is not accepted: the folder is stored. */
const ClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('open'), sid: Sid, ...Size }),
  z.object({ type: z.literal('input'), sid: Sid, data: z.string().max(MAX_INPUT_CHARS) }),
  z.object({ type: z.literal('resize'), sid: Sid, ...Size }),
  z.object({ type: z.literal('close'), sid: Sid }),
])
type ClientMessage = z.infer<typeof ClientMessage>

/** One socket's attachment. Output is held back until the replay has gone out, so the client sees ready, replay, then live. */
type Attached = {
  sid: string
  attachment: Attachment
  ready: boolean
  held: string[]
}

type Runtime = {
  repo: SessionRepository
  owner: string
  /** Sockets currently attached per session. A session with none is detached and eligible for idle reaping. */
  attached: Map<string, number>
  sockets: WeakMap<object, Attached>
  /** Browsers subscribed to session changes. */
  events: ReturnType<typeof createSessionEvents>
  /** The foreground command of each open shell, keyed by its tmux session name. Read by a poll, not per request. */
  commands: Map<string, string>
  /** Sends the current list to every subscriber. Call it after anything that changes the list or whether it is attached. */
  publish(): void
}

let sweep: ReturnType<typeof setInterval> | null = null
let liveness: ReturnType<typeof setInterval> | null = null
let heartbeat: ReturnType<typeof setInterval> | null = null
let commandPoll: ReturnType<typeof setInterval> | null = null

export function onActivate(api: ExtensionApi) {
  // The Tailscale login the host already authorized. The upgrade is refused before this route runs for anyone else.
  // With no login configured, nothing may open a shell.
  const owner = process.env.REMOTE_AGENT_WEB_ALLOWED_LOGIN ?? ''
  const storage = api.backend.storage
  if (storage === undefined) {
    throw new Error('the terminal extension needs the storage permission')
  }
  const log = (message: string) => console.log(`[terminal] ${message}`)
  const events = createSessionEvents()
  const rt: Runtime = {
    repo: createSessionRepository(storage, Date.now),
    owner,
    attached: new Map(),
    sockets: new WeakMap(),
    events,
    commands: new Map(),
    publish: () => events.publish(sessionViews(rt)),
  }
  const deps = lifecycleDeps(rt, log)

  void reconcile(deps)
    .then(closed => {
      if (closed > 0) {
        rt.publish()
      }
    })
    .catch(error => log(`reconcile failed: ${String(error)}`))
  if (sweep !== null) {
    clearInterval(sweep)
  }
  sweep = setInterval(() => {
    void sweepIdle(deps)
      .then(reaped => {
        if (reaped > 0) {
          rt.publish()
        }
      })
      .catch(error => log(`idle sweep failed: ${String(error)}`))
  }, IDLE_CHECK_MS)
  sweep.unref?.()
  if (liveness !== null) {
    clearInterval(liveness)
  }
  liveness = setInterval(() => {
    void reconcile(deps)
      .then(closed => {
        if (closed > 0) {
          rt.publish()
        }
      })
      .catch(error => log(`liveness check failed: ${String(error)}`))
  }, LIVENESS_CHECK_MS)
  liveness.unref?.()
  if (heartbeat !== null) {
    clearInterval(heartbeat)
  }
  heartbeat = setInterval(() => rt.publish(), HEARTBEAT_MS)
  heartbeat.unref?.()
  if (commandPoll !== null) {
    clearInterval(commandPoll)
  }
  commandPoll = setInterval(() => {
    void refreshCommands(rt).catch(error => log(`command poll failed: ${String(error)}`))
  }, COMMAND_POLL_MS)
  commandPoll.unref?.()

  const routes = createSessionRoutes({
    owner,
    repo: rt.repo,
    tmux: { available: tmuxAvailable, create: createSession, kill: killSession, alive: hasSession },
    newSid: () => `term-${crypto.randomUUID()}`,
    nameFor: sessionNameFor,
    shell: process.env.SHELL || '/bin/sh',
    isAttached: sid => (rt.attached.get(sid) ?? 0) > 0,
    foreground: name => rt.commands.get(name) ?? null,
    onChange: () => rt.publish(),
  })
  api.backend.registerHttpRoute('GET', '/sessions', () => routes.list())
  api.backend.registerHttpRoute('POST', '/sessions', request => routes.create(request))
  api.backend.registerHttpRoute('POST', '/sessions/close', request => routes.close(request))

  api.backend.registerWebSocketRoute(TERMINAL_WS_PATH, {
    open(rawSocket) {
      if (owner === '') {
        send(rawSocket, { type: 'error', message: 'terminal is disabled: REMOTE_AGENT_WEB_ALLOWED_LOGIN is not set' })
        ;(rawSocket as { close(code?: number, reason?: string): void }).close(1008, 'terminal disabled')
      }
    },

    message(rawSocket, raw) {
      if (owner === '') {
        return
      }
      const parsed = parseClientMessage(raw)
      if (parsed === null) {
        send(rawSocket, { type: 'error', message: 'invalid terminal message' })
        return
      }
      void handle(rawSocket, parsed, rt, log).catch(error => {
        send(rawSocket, { type: 'error', sid: parsed.sid, message: messageOf(error) })
      })
    },

    close(rawSocket) {
      const current = rt.sockets.get(rawSocket)
      rt.sockets.delete(rawSocket)
      if (current !== undefined) {
        // The shell keeps running after the socket goes. Its idle clock starts now.
        detach(current, rt)
      }
    },
  })

  // Subscribers get the whole list on connect, then again after every change.
  api.backend.registerWebSocketRoute(EVENTS_WS_PATH, {
    open(rawSocket) {
      if (owner === '') {
        ;(rawSocket as { close(code?: number, reason?: string): void }).close(1008, 'terminal disabled')
        return
      }
      const subscriber = rawSocket as EventSocket
      rt.events.add(subscriber)
      subscriber.send(frameOf(sessionViews(rt)))
    },
    message() {},
    close(rawSocket) {
      rt.events.remove(rawSocket as EventSocket)
    },
  })
}

export function onDeactivate() {
  if (sweep !== null) {
    clearInterval(sweep)
    sweep = null
  }
  if (liveness !== null) {
    clearInterval(liveness)
    liveness = null
  }
  if (heartbeat !== null) {
    clearInterval(heartbeat)
    heartbeat = null
  }
  if (commandPoll !== null) {
    clearInterval(commandPoll)
    commandPoll = null
  }
}

/** What the browser sees of every open session of this owner. The same view the HTTP list returns. */
function sessionViews(rt: Runtime): SessionView[] {
  return rt.repo.listOpen(rt.owner).map(doc => viewOf(doc, (rt.attached.get(doc.sid) ?? 0) > 0, rt.commands.get(doc.tmuxName) ?? null))
}

/** Reads every shell's foreground command. Publishes only when one of them changed, so a quiet machine sends nothing extra. */
async function refreshCommands(rt: Runtime): Promise<void> {
  // With no open shell there is nothing to read, so the poll does not start tmux every few seconds for nothing.
  if (rt.commands.size === 0 && rt.repo.listOpen(rt.owner).length === 0) {
    return
  }
  const next = await foregroundCommands()
  const changed = next.size !== rt.commands.size || [...next].some(([name, command]) => rt.commands.get(name) !== command)
  if (changed) {
    rt.commands.clear()
    for (const [name, command] of next) {
      rt.commands.set(name, command)
    }
    rt.publish()
  }
}

async function handle(rawSocket: object, message: ClientMessage, rt: Runtime, log: (message: string) => void): Promise<void> {
  const current = rt.sockets.get(rawSocket)

  switch (message.type) {
    case 'open': {
      if (current !== undefined) {
        send(rawSocket, { type: 'error', sid: message.sid, message: 'this connection already has a terminal open' })
        return
      }
      const doc = openDoc(rt, message.sid)
      if (doc === undefined) {
        send(rawSocket, { type: 'error', sid: message.sid, code: 'not_found', message: 'no open terminal with that id' })
        return
      }
      if (!(await hasSession(doc.tmuxName))) {
        rt.repo.close(message.sid, 'missing')
        rt.publish()
        send(rawSocket, { type: 'error', sid: message.sid, code: 'not_found', message: 'this terminal has ended' })
        return
      }
      await attachTo(rawSocket, doc, message.cols, message.rows, rt, log)
      return
    }

    case 'input': {
      if (current === undefined || current.sid !== message.sid) {
        send(rawSocket, { type: 'error', sid: message.sid, message: 'this terminal is not open on this connection' })
        return
      }
      current.attachment.write(message.data)
      return
    }

    case 'resize': {
      if (current === undefined || current.sid !== message.sid) {
        send(rawSocket, { type: 'error', sid: message.sid, message: 'this terminal is not open on this connection' })
        return
      }
      current.attachment.resize(message.cols, message.rows)
      return
    }

    case 'close': {
      const doc = openDoc(rt, message.sid)
      if (doc === undefined) {
        send(rawSocket, { type: 'error', sid: message.sid, code: 'not_found', message: 'no open terminal with that id' })
        return
      }
      if (current !== undefined && current.sid === message.sid) {
        rt.sockets.delete(rawSocket)
        detach(current, rt)
      }
      await killSession(doc.tmuxName)
      rt.repo.close(message.sid, 'user')
      rt.publish()
      log(`terminal ${message.sid} closed by its owner`)
      return
    }
  }
}

/** The stored session if the caller owns it and it is still open. Anything else is "not found", so ids do not leak. */
function openDoc(rt: Runtime, sid: string): SessionDoc | undefined {
  const doc = rt.repo.get(sid)
  if (doc === undefined || doc.owner !== rt.owner || doc.closedAt !== null) {
    return undefined
  }
  return doc
}

async function attachTo(rawSocket: object, doc: SessionDoc, cols: number, rows: number, rt: Runtime, log: (message: string) => void): Promise<void> {
  const state: Attached = { sid: doc.sid, attachment: placeholder, ready: false, held: [] }
  state.attachment = attach({
    name: doc.tmuxName,
    cols,
    rows,
    onOutput: data => {
      if (state.ready) {
        send(rawSocket, { type: 'output', sid: doc.sid, data })
      } else {
        state.held.push(data)
      }
    },
    onExit: code => {
      if (rt.sockets.get(rawSocket) === state) {
        rt.sockets.delete(rawSocket)
        unmark(rt, doc.sid)
        rt.publish()
      }
      send(rawSocket, { type: 'exit', sid: doc.sid, code })
      void hasSession(doc.tmuxName).then(alive => {
        if (!alive && rt.repo.get(doc.sid)?.closedAt === null) {
          rt.repo.close(doc.sid, 'exited')
          rt.publish()
          log(`terminal ${doc.sid} exited with its shell`)
        }
      })
    },
  })
  rt.sockets.set(rawSocket, state)
  mark(rt, doc.sid)
  rt.repo.touch(doc.sid, Date.now())
  rt.publish()

  const replay = await replayFor(doc.tmuxName)
  send(rawSocket, { type: 'ready', sid: doc.sid, cwd: doc.launchCwd, created: false })
  send(rawSocket, { type: 'replay', sid: doc.sid, data: replay })
  state.ready = true
  for (const data of state.held.splice(0)) {
    send(rawSocket, { type: 'output', sid: doc.sid, data })
  }
}

/** Stands in for the attachment until `attach` returns; output cannot arrive before then, so it is never used. */
const placeholder: Attachment = {
  write() {},
  resize() {},
  detach() {},
  closed: true,
}

function detach(current: Attached, rt: Runtime): void {
  current.attachment.detach()
  unmark(rt, current.sid)
  rt.repo.touch(current.sid, Date.now())
  rt.publish()
}

function mark(rt: Runtime, sid: string): void {
  rt.attached.set(sid, (rt.attached.get(sid) ?? 0) + 1)
}

function unmark(rt: Runtime, sid: string): void {
  const count = (rt.attached.get(sid) ?? 1) - 1
  if (count <= 0) {
    rt.attached.delete(sid)
  } else {
    rt.attached.set(sid, count)
  }
}

function lifecycleDeps(rt: Runtime, log: (message: string) => void): LifecycleDeps {
  return {
    owner: rt.owner,
    repo: rt.repo,
    alive: hasSession,
    kill: killSession,
    isAttached: sid => (rt.attached.get(sid) ?? 0) > 0,
    now: () => Date.now(),
    log,
  }
}

function parseClientMessage(raw: string | Buffer): ClientMessage | null {
  let json: unknown
  try {
    json = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
  } catch {
    return null
  }
  const result = ClientMessage.safeParse(json)
  return result.success ? result.data : null
}

function send(socket: object, message: Record<string, unknown>): void {
  ;(socket as { send(data: string): void }).send(JSON.stringify(message))
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
