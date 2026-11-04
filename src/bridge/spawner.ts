import { projectName } from '../../mod/remote-agent/hooks/protocol.ts'
import type { Channel, ThreadRef } from '../channel/types.ts'
import { redactSecrets, truncate } from '../core/text.ts'
import { END_GRACE_MS, STARTUP_TIMEOUT_MS } from './config.ts'
import { tmuxNameFor, type Launcher } from './launcher.ts'
import type { Notifier } from './notifier.ts'
import type { Log } from './prompts.ts'
import type { Store } from './store.ts'
import { TrustedFoldersUnavailable, type Project, type TrustedFolders } from './trusted.ts'

export const NOT_TRUSTED = 'Not a trusted folder. Open it once in Claude Code locally and accept the trust dialog.'
export const STALE_PICKER = 'Project list changed. Send /new again.'
export const CONFIG_UNREADABLE = "Can't read Claude Code's trusted folders."
export const USAGE = 'Usage: /new [--model <model>] <trusted folder>. Set REMOTE_AGENT_PROJECTS to get buttons for your projects.'
export const BAD_MODEL = 'Unknown model. Use opus, sonnet, haiku, opusplan or a full model id like claude-sonnet-5-5.'
export const READY = '✅ Ready. Send your task here.'
export const NOT_SPAWNED = 'Only sessions started from Telegram can be ended remotely.'
export const UNKNOWN_SESSION = 'Unknown session.'

const CAPTURE_LINES = 15
const CAPTURE_MAX = 1_500
const REASON_MAX = 150
const MAX_PICKERS = 20
const MODEL_ALIASES = new Set(['opus', 'sonnet', 'haiku', 'opusplan'])
const MODEL_ID = /^claude-[a-z0-9][a-z0-9.-]*$/
const MODEL_FIRST = /^(?:--model|-m)(?:\s+(\S+))?(?:\s+(.*))?$/s
const MODEL_LAST = /^(.*?)\s+(?:--model|-m)\s+(\S+)$/s

type Picker = { projects: Project[]; model: string | null }

/** Splits `/new` args into a path and an optional `--model`/`-m` given before or after it. Null means a bad model. */
export function parseNewArgs(args: string): { path: string; model: string | null } | null {
  const first = MODEL_FIRST.exec(args)
  const last = first === null ? MODEL_LAST.exec(args) : null
  if (first === null && last === null) {
    return { path: args, model: null }
  }
  const model = first !== null ? first[1] : last?.[2]
  const path = (first !== null ? first[2] : last?.[1]) ?? ''
  if (model === undefined || !(MODEL_ALIASES.has(model) || MODEL_ID.test(model))) {
    return null
  }
  return { path: path.trim(), model }
}

/** Runs `run` after `ms`; the returned function cancels it. */
export type Schedule = (run: () => void, ms: number) => () => void

export type SpawnerDeps = {
  store: Store
  channel: Channel
  notifier: Notifier
  launcher: Launcher
  trusted: TrustedFolders
  log: Log
  schedule?: Schedule
  sleep?: (ms: number) => Promise<void>
  newId?: () => string
}

const defaultSchedule: Schedule = (run, ms) => {
  const handle = setTimeout(run, ms)
  return () => {
    clearTimeout(handle)
  }
}

function reasonOf(error: unknown): string {
  return truncate(redactSecrets(error instanceof Error ? error.message : String(error)), REASON_MAX)
}

/** Starts Spawned Sessions from the Channel and watches them until they are ready. */
export class Spawner {
  private readonly timers = new Map<string, () => void>()
  private readonly ending = new Set<string>()
  private readonly pickers = new Map<string, Picker>()
  private readonly schedule: Schedule
  private readonly sleep: (ms: number) => Promise<void>
  private readonly newId: () => string

  constructor(private readonly deps: SpawnerDeps) {
    this.schedule = deps.schedule ?? defaultSchedule
    this.sleep = deps.sleep ?? (ms => Bun.sleep(ms))
    this.newId = deps.newId ?? (() => crypto.randomUUID())
  }

  /** `/new [--model <model>] [path]`. Returns the reply, or null when the project picker was posted instead. */
  async newCommand(thread: ThreadRef | null, args: string): Promise<string | null> {
    const parsed = parseNewArgs(args)
    if (parsed === null) {
      return BAD_MODEL
    }
    try {
      if (parsed.path !== '') {
        return await this.startAt(parsed.path, parsed.model)
      }
      return await this.postPicker(thread, parsed.model)
    } catch (error) {
      if (error instanceof TrustedFoldersUnavailable) {
        this.deps.log('reading trusted folders failed', error)
        return CONFIG_UNREADABLE
      }
      throw error
    }
  }

  /** A tap on a picker button. Returns the toast. */
  async startFromPicker(pickerId: string, choice: number): Promise<string> {
    const picker = this.pickers.get(pickerId)
    const project = picker?.projects[choice]
    if (picker === undefined || project === undefined) {
      return STALE_PICKER
    }
    try {
      return await this.startAt(project.cwd, picker.model)
    } catch (error) {
      if (error instanceof TrustedFoldersUnavailable) {
        this.deps.log('reading trusted folders failed', error)
        return CONFIG_UNREADABLE
      }
      throw error
    }
  }

  /**
   * Starts a Spawned Session that resumes the transcript of `sessionId` under a new id, so the original is left alone.
   * Works for ended and non-spawned sessions too. Returns the toast.
   */
  async fork(sessionId: string): Promise<string> {
    const session = this.deps.store.getSession(sessionId)
    if (session === undefined) {
      return UNKNOWN_SESSION
    }
    try {
      return await this.startAt(session.cwd, null, sessionId)
    } catch (error) {
      if (error instanceof TrustedFoldersUnavailable) {
        this.deps.log('reading trusted folders failed', error)
        return CONFIG_UNREADABLE
      }
      throw error
    }
  }

  /** Called for every mod request that names a Session; the first one for a Spawned Session marks it ready. */
  async onSessionStarted(sessionId: string): Promise<void> {
    const session = this.deps.store.getSession(sessionId)
    if (session === undefined || !session.spawned || session.startedAt !== null || session.endedAt !== null) {
      return
    }
    if (!this.deps.store.markSpawnedStarted(sessionId)) {
      return
    }
    this.cancelTimer(sessionId)
    if (session.threadId === null) {
      return
    }
    await this.deps.channel.sendText(session.threadId, READY, null)
  }

  /** `/end` in a Thread: `/exit`, then kill after the grace period, which runs in the background. Returns the reply. */
  async end(thread: ThreadRef | null): Promise<string> {
    if (thread === null) {
      return 'Send /end inside a session topic.'
    }
    const { store, launcher, notifier, log } = this.deps
    const session = store.findSessionByThread(thread)
    if (session === undefined || session.endedAt !== null) {
      return 'This session has ended.'
    }
    if (!session.spawned || session.tmuxName === null) {
      return NOT_SPAWNED
    }
    if (this.ending.has(session.id)) {
      return '⏹ Already ending.'
    }
    const tmuxName = session.tmuxName
    this.ending.add(session.id)
    let background = false
    try {
      this.cancelTimer(session.id)
      if (!(await launcher.exists(tmuxName))) {
        await notifier.closeSession(session.id)
        return '⚪ The session was already gone.'
      }
      background = true
      // The grace period must not block the Channel's update loop, so the rest runs after the reply.
      void (async () => {
        try {
          await launcher.sendExit(tmuxName)
          await this.sleep(END_GRACE_MS)
          if (await launcher.exists(tmuxName)) {
            await launcher.kill(tmuxName)
          }
        } catch (error) {
          log(`ending ${tmuxName} failed`, error)
        }
        // A graceful exit usually already closed it through the session_ended Report; closeSession is then a no-op.
        await notifier.closeSession(session.id)
      })()
        .catch(error => {
          log(`closing ${session.id} failed`, error)
        })
        .finally(() => {
          this.ending.delete(session.id)
        })
      return '⏹ Ending the session…'
    } finally {
      if (!background) {
        this.ending.delete(session.id)
      }
    }
  }

  /** On Bridge startup: Spawned Sessions survive restarts, so close the dead ones and keep watching the ones still booting. */
  async reconcile(): Promise<void> {
    const { store, launcher, notifier, log } = this.deps
    for (const session of store.listActiveSessions()) {
      if (!session.spawned) {
        continue
      }
      try {
        if (session.tmuxName === null || !(await launcher.exists(session.tmuxName))) {
          await notifier.closeSession(session.id)
          continue
        }
        if (session.startedAt === null) {
          this.armTimer(session.id)
        }
      } catch (error) {
        log(`reconciling ${session.id} failed`, error)
      }
    }
  }

  private async postPicker(thread: ThreadRef | null, model: string | null): Promise<string | null> {
    const projects = await this.deps.trusted.configuredProjects()
    if (projects.length === 0) {
      return USAGE
    }
    const pickerId = this.newId().slice(0, 8)
    this.pickers.set(pickerId, { projects, model })
    if (this.pickers.size > MAX_PICKERS) {
      const oldest = this.pickers.keys().next().value
      if (oldest !== undefined) {
        this.pickers.delete(oldest)
      }
    }
    const buttons = projects.map((project, choice) => ({ label: project.label, data: { kind: 'launch' as const, pickerId, choice } }))
    await this.deps.channel.sendButtons(thread, `Start a session${model === null ? '' : ` with ${model}`} in:`, buttons)
    return null
  }

  private async startAt(path: string, model: string | null, resumeFrom?: string): Promise<string> {
    const cwd = await this.deps.trusted.isTrusted(path)
    if (cwd === null) {
      return NOT_TRUSTED
    }
    return this.start(cwd, model, resumeFrom)
  }

  private async start(cwd: string, model: string | null, resumeFrom?: string): Promise<string> {
    const { store, notifier, channel, launcher, log } = this.deps
    const sessionId = this.newId()
    const tmuxName = tmuxNameFor(sessionId)
    store.createSpawnedSession({ id: sessionId, cwd, tmuxName })
    // The Thread must exist before claude starts, or the mod's first request would create a second one.
    let thread: ThreadRef
    try {
      thread = await notifier.ensureThread(sessionId)
    } catch (error) {
      log(`creating the topic for ${sessionId} failed`, error)
      store.endSession(sessionId)
      return '❌ Could not create a topic for the session.'
    }
    try {
      await launcher.launch({ sessionId, cwd, model, resumeFrom })
    } catch (error) {
      const reason = reasonOf(error)
      await channel.sendText(thread, `❌ Could not start the session:\n${reason}`, null).catch(sendError => {
        log(`reporting the failed launch of ${sessionId} failed`, sendError)
      })
      await notifier.closeSession(sessionId)
      return `❌ Could not start the session: ${reason}`
    }
    this.armTimer(sessionId)
    await channel.sendText(thread, `⏳ Starting… attach with: tmux attach -t ${tmuxName}`, null).catch(sendError => {
      log(`announcing the start of ${sessionId} failed`, sendError)
    })
    const withModel = model === null ? '' : ` with ${model}`
    if (resumeFrom !== undefined) {
      return `Forking ${projectName(cwd)}${withModel}. Open its topic.`
    }
    return `🚀 Starting ${projectName(cwd)}${withModel}. Open its topic.`
  }

  private armTimer(sessionId: string): void {
    this.cancelTimer(sessionId)
    const cancel = this.schedule(() => {
      this.timers.delete(sessionId)
      void this.onTimeout(sessionId).catch(error => {
        this.deps.log(`startup timeout of ${sessionId} failed`, error)
      })
    }, STARTUP_TIMEOUT_MS)
    this.timers.set(sessionId, cancel)
  }

  private cancelTimer(sessionId: string): void {
    this.timers.get(sessionId)?.()
    this.timers.delete(sessionId)
  }

  private async onTimeout(sessionId: string): Promise<void> {
    const { store, channel, launcher, notifier, log } = this.deps
    const session = store.getSession(sessionId)
    if (session === undefined || session.startedAt !== null || session.endedAt !== null || session.tmuxName === null) {
      return
    }
    let tail = ''
    try {
      tail = await launcher.capture(session.tmuxName, CAPTURE_LINES)
    } catch (error) {
      log(`capturing the screen of ${session.tmuxName} failed`, error)
    }
    if (this.hasSettled(sessionId)) {
      return
    }
    if (session.threadId !== null) {
      const shown = tail === '' ? '(no output)' : truncate(redactSecrets(tail), CAPTURE_MAX)
      await channel
        .sendText(session.threadId, `❌ Session did not start within ${STARTUP_TIMEOUT_MS / 1_000}s. Last output:\n\n${shown}`, null)
        .catch(error => {
          log(`reporting the startup timeout of ${sessionId} failed`, error)
        })
    }
    if (this.hasSettled(sessionId)) {
      return
    }
    try {
      await launcher.kill(session.tmuxName)
    } catch (error) {
      log(`killing ${session.tmuxName} failed`, error)
    }
    await notifier.closeSession(sessionId)
  }

  /** True when the session started or ended since the timeout began, so the timeout must back off. */
  private hasSettled(sessionId: string): boolean {
    const session = this.deps.store.getSession(sessionId)
    return session === undefined || session.startedAt !== null || session.endedAt !== null
  }
}
