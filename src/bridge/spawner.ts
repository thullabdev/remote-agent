import { projectName } from '../../mod/remote-agent/hooks/protocol.ts'
import type { Channel, ThreadRef } from '../channel/types.ts'
import { redactSecrets, truncate } from '../core/text.ts'
import { STARTUP_TIMEOUT_MS } from './config.ts'
import { tmuxNameFor, type Launcher } from './launcher.ts'
import type { Notifier } from './notifier.ts'
import type { Log } from './prompts.ts'
import type { Store } from './store.ts'
import { TrustedFoldersUnavailable, type Project, type TrustedFolders } from './trusted.ts'

export const NOT_TRUSTED = 'Not a trusted folder. Open it once in Claude Code locally and accept the trust dialog.'
export const STALE_PICKER = 'Project list changed. Send /new again.'
export const CONFIG_UNREADABLE = "Can't read Claude Code's trusted folders."
export const USAGE = 'Usage: /new <trusted folder>. Set REMOTE_AGENT_PROJECTS to get buttons for your projects.'
export const READY = '✅ Ready. Send your task here.'

const CAPTURE_LINES = 15
const CAPTURE_MAX = 1_500
const REASON_MAX = 150
const MAX_PICKERS = 20

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
  private readonly pickers = new Map<string, Project[]>()
  private readonly schedule: Schedule
  private readonly sleep: (ms: number) => Promise<void>
  private readonly newId: () => string

  constructor(private readonly deps: SpawnerDeps) {
    this.schedule = deps.schedule ?? defaultSchedule
    this.sleep = deps.sleep ?? (ms => Bun.sleep(ms))
    this.newId = deps.newId ?? (() => crypto.randomUUID())
  }

  /** `/new [path]`. Returns the reply, or null when the project picker was posted instead. */
  async newCommand(thread: ThreadRef | null, args: string): Promise<string | null> {
    try {
      if (args !== '') {
        return await this.startAt(args)
      }
      return await this.postPicker(thread)
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
    const project = this.pickers.get(pickerId)?.[choice]
    if (project === undefined) {
      return STALE_PICKER
    }
    try {
      return await this.startAt(project.cwd)
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

  private async postPicker(thread: ThreadRef | null): Promise<string | null> {
    const projects = await this.deps.trusted.configuredProjects()
    if (projects.length === 0) {
      return USAGE
    }
    const pickerId = this.newId().slice(0, 8)
    this.pickers.set(pickerId, projects)
    if (this.pickers.size > MAX_PICKERS) {
      const oldest = this.pickers.keys().next().value
      if (oldest !== undefined) {
        this.pickers.delete(oldest)
      }
    }
    const buttons = projects.map((project, choice) => ({ label: project.label, data: { kind: 'launch' as const, pickerId, choice } }))
    await this.deps.channel.sendButtons(thread, 'Start a session in:', buttons)
    return null
  }

  private async startAt(path: string): Promise<string> {
    const cwd = await this.deps.trusted.isTrusted(path)
    if (cwd === null) {
      return NOT_TRUSTED
    }
    return this.start(cwd)
  }

  private async start(cwd: string): Promise<string> {
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
      await launcher.launch({ sessionId, cwd })
    } catch (error) {
      const reason = reasonOf(error)
      await channel.sendText(thread, `❌ Could not start the session:\n${reason}`, null).catch(sendError => {
        log(`reporting the failed launch of ${sessionId} failed`, sendError)
      })
      await notifier.closeSession(sessionId)
      return `❌ Could not start the session: ${reason}`
    }
    this.armTimer(sessionId)
    await channel.sendText(thread, `⏳ Starting… attach with: tmux attach -t ${tmuxName}`, null)
    return `🚀 Starting ${projectName(cwd)}. Open its topic.`
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
