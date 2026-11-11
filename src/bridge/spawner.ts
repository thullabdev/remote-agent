import { projectName } from '../../mod/remote-agent/hooks/protocol.ts'
import type { Channel, SessionStatus, ThreadRef } from '../channel/types.ts'
import { redactSecrets, truncate } from '../core/text.ts'
import { END_GRACE_MS, STARTUP_TIMEOUT_MS } from './config.ts'
import { tmuxNameFor, type Launcher } from './launcher.ts'
import type { Notifier } from './notifier.ts'
import type { Log } from './prompts.ts'
import { listSessionHistories, type SessionHistory } from './session-history.ts'
import type { Store } from './store.ts'
import { TrustedFoldersUnavailable, type Project, type TrustedFolders } from './trusted.ts'

export const NOT_TRUSTED = 'Not a trusted folder. Open it in Claude Code and accept the trust dialog first.'
export const STALE_PICKER = 'Project list changed. Send /new again.'
export const CONFIG_UNREADABLE = "Can't read Claude Code's trusted folders."
export const USAGE = 'Usage: /new [--model <model>] <trusted folder> or /new --resume [trusted folder]. Trust folders in Claude Code first.'
export const BAD_MODEL = 'Unknown model. Use opus, sonnet, haiku, opusplan or a full model id like claude-sonnet-5-5.'
export const READY = '✅ Ready. Send your task here.'
export const NOT_SPAWNED = 'Only sessions started by the Bridge can be ended remotely.'
export const UNKNOWN_SESSION = 'Unknown session.'
export const SESSION_ALREADY_ACTIVE = 'This Session is already active.'

const CAPTURE_LINES = 15
const CAPTURE_MAX = 1_500
const REASON_MAX = 150
const MAX_PICKERS = 20
const MODEL_ALIASES = new Set(['opus', 'sonnet', 'haiku', 'opusplan'])
const MODEL_ID = /^claude-[a-z0-9][a-z0-9.-]*$/
const MODEL_FIRST = /^(?:--model|-m)(?:\s+(\S+))?(?:\s+(.*))?$/s
const MODEL_LAST = /^(.*?)\s+(?:--model|-m)\s+(\S+)$/s

type Picker =
  | { kind: 'projects'; projects: Project[]; model: string | null }
  | { kind: 'resume-projects'; thread: ThreadRef | null; projects: Project[]; model: string | null }
  | { kind: 'histories'; cwd: string; histories: SessionHistory[]; model: string | null }

/** Splits `/new` args into a path, optional model and resume mode. Null means a bad model. */
export function parseNewArgs(args: string): { path: string; model: string | null; resume: boolean } | null {
  if (args === '--resume' || args.startsWith('--resume ')) {
    const parsed = parseNewArgs(args.slice('--resume'.length).trim())
    return parsed === null ? null : { ...parsed, resume: true }
  }
  const first = MODEL_FIRST.exec(args)
  const last = first === null ? MODEL_LAST.exec(args) : null
  if (first === null && last === null) {
    return { path: args, model: null, resume: false }
  }
  const model = first !== null ? first[1] : last?.[2]
  const path = (first !== null ? first[2] : last?.[1]) ?? ''
  if (model === undefined || !(MODEL_ALIASES.has(model) || MODEL_ID.test(model))) {
    return null
  }
  return { path: path.trim(), model, resume: false }
}

/** Runs `run` after `ms`; the returned function cancels it. */
export type Schedule = (run: () => void, ms: number) => () => void

export type SpawnerDeps = {
  store: Store
  channel: Channel
  notifier: Notifier
  launcher: Launcher
  trusted: TrustedFolders
  home: string
  log: Log
  /** The upload library; Sessions may read it without a permission prompt. */
  uploadsDir?: string
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
  private libraryDirs(): { addDirs?: string[] } {
    return this.deps.uploadsDir === undefined ? {} : { addDirs: [this.deps.uploadsDir] }
  }

  private readonly timers = new Map<string, () => void>()
  private readonly ending = new Set<string>()
  private readonly resuming = new Set<string>()
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
    return this.withTrustedFolders(async () => {
      const parsed = parseNewArgs(args)
      if (parsed === null) {
        return BAD_MODEL
      }
      if (parsed.resume) {
        if (parsed.path !== '') {
          return await this.postHistoryPicker(thread, parsed.path, parsed.model)
        }
        return await this.postResumeProjectPicker(thread, parsed.model)
      }
      if (parsed.path !== '') {
        return await this.startAt(parsed.path, parsed.model)
      }
      return await this.postPicker(thread, parsed.model)
    })
  }

  /** A tap on a picker button. Returns the toast. */
  async startFromPicker(pickerId: string, choice: number): Promise<string> {
    return this.withTrustedFolders(async () => {
      const picker = this.pickers.get(pickerId)
      if (picker === undefined) {
        return STALE_PICKER
      }
      if (picker.kind === 'histories') {
        const history = picker.histories[choice]
        return history === undefined ? STALE_PICKER : await this.startAt(picker.cwd, picker.model, history.id)
      }
      const project = picker.projects[choice]
      if (project === undefined) {
        return STALE_PICKER
      }
      if (picker.kind === 'resume-projects') {
        return (await this.postHistoryPicker(picker.thread, project.cwd, picker.model)) ?? 'Session histories listed.'
      }
      return await this.startAt(project.cwd, picker.model)
    })
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
        this.deps.log('reading Claude Code trusted folders failed', error)
        return CONFIG_UNREADABLE
      }
      throw error
    }
  }

  /** Restarts an ended Session with its existing Claude session id and transcript. */
  async resume(sessionId: string): Promise<string> {
    const { store, launcher, notifier, channel, log } = this.deps
    const session = store.getSession(sessionId)
    if (session === undefined) {
      return UNKNOWN_SESSION
    }
    if (session.endedAt === null) {
      return SESSION_ALREADY_ACTIVE
    }
    if (this.resuming.has(sessionId)) {
      return 'This Session is already being resumed.'
    }

    this.resuming.add(sessionId)
    try {
      let cwd: string | null
      try {
        cwd = await this.deps.trusted.isTrusted(session.cwd)
      } catch (error) {
        if (error instanceof TrustedFoldersUnavailable) {
          log('reading Claude Code trusted folders failed', error)
          return CONFIG_UNREADABLE
        }
        throw error
      }
      if (cwd === null) {
        return NOT_TRUSTED
      }
      const tmuxName = tmuxNameFor(sessionId)
      if (await launcher.exists(tmuxName)) {
        return `A tmux session already exists for this Session. Attach with: tmux attach -t ${tmuxName}`
      }
      if (!store.resumeSpawnedSession(sessionId, tmuxName)) {
        return SESSION_ALREADY_ACTIVE
      }

      let thread: ThreadRef
      try {
        thread = await notifier.ensureThread(sessionId)
      } catch (error) {
        log(`preparing ${sessionId} for resume failed`, error)
        await notifier.closeSession(sessionId).catch(closeError => {
          log(`restoring ${sessionId} after a failed resume failed`, closeError)
        })
        return '❌ Could not resume this Session.'
      }

      try {
        await launcher.launch({ sessionId, cwd, resumeFrom: sessionId, fork: false, ...this.libraryDirs() })
      } catch (error) {
        const reason = reasonOf(error)
        await this.announce(thread, { state: 'failed', cwd, tmuxName, message: 'Could not resume the Session', detail: reason, fallback: `❌ Could not resume the Session:\n${reason}` }).catch(sendError => {
          log(`reporting the failed resume of ${sessionId} failed`, sendError)
        })
        await notifier.closeSession(sessionId)
        return `❌ Could not resume the Session: ${reason}`
      }

      this.armTimer(sessionId)
      await this.announce(thread, { state: 'resuming', cwd, tmuxName, message: null, detail: null, fallback: `⏳ Resuming this Session… attach with: tmux attach -t ${tmuxName}` }).catch(sendError => {
        log(`announcing the resume of ${sessionId} failed`, sendError)
      })
      return `Resuming ${projectName(cwd)} in this Session. Open its chat.`
    } finally {
      this.resuming.delete(sessionId)
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
    await this.announce(session.threadId, { state: 'ready', cwd: session.cwd, tmuxName: session.tmuxName, message: null, detail: null, fallback: READY })
  }

  /** Shows startup progress through the channel's own status when it has one, else as the plain legacy text. */
  private async announce(thread: ThreadRef, status: SessionStatus): Promise<void> {
    const { channel } = this.deps
    if (channel.sessionStatus === undefined) {
      await channel.sendText(thread, status.fallback, null)
      return
    }
    await channel.sessionStatus(thread, status)
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
    this.pickers.set(pickerId, { kind: 'projects', projects, model })
    if (this.pickers.size > MAX_PICKERS) {
      const oldest = this.pickers.keys().next().value
      if (oldest !== undefined) {
        this.pickers.delete(oldest)
      }
    }
    const buttons = projects.map((project, choice) => ({ label: project.label, detail: project.cwd, data: { kind: 'launch' as const, pickerId, choice } }))
    await this.deps.channel.sendButtons(thread, `Start a session${model === null ? '' : ` with ${model}`} in:`, buttons)
    return null
  }

  private async postResumeProjectPicker(thread: ThreadRef | null, model: string | null): Promise<string | null> {
    const projects = await this.deps.trusted.configuredProjects()
    if (projects.length === 0) {
      return USAGE
    }
    const pickerId = this.newId().slice(0, 8)
    this.pickers.set(pickerId, { kind: 'resume-projects', thread, projects, model })
    if (this.pickers.size > MAX_PICKERS) {
      const oldest = this.pickers.keys().next().value
      if (oldest !== undefined) {
        this.pickers.delete(oldest)
      }
    }
    const buttons = projects.map((project, choice) => ({ label: project.label, detail: project.cwd, data: { kind: 'launch' as const, pickerId, choice } }))
    await this.deps.channel.sendButtons(thread, 'Choose a project to resume from:', buttons)
    return null
  }

  private async postHistoryPicker(thread: ThreadRef | null, path: string, model: string | null): Promise<string | null> {
    const cwd = await this.deps.trusted.isTrusted(path)
    if (cwd === null) {
      return NOT_TRUSTED
    }
    const histories = await listSessionHistories(this.deps.home, cwd)
    if (histories.length === 0) {
      return `No session histories found in ${cwd}.`
    }
    const pickerId = this.newId().slice(0, 8)
    this.pickers.set(pickerId, { kind: 'histories', cwd, histories, model })
    if (this.pickers.size > MAX_PICKERS) {
      const oldest = this.pickers.keys().next().value
      if (oldest !== undefined) {
        this.pickers.delete(oldest)
      }
    }
    const buttons = histories.map((history, choice) => ({ label: history.label, detail: history.preview, at: history.modifiedAt, data: { kind: 'launch' as const, pickerId, choice } }))
    await this.deps.channel.sendButtons(thread, `Resume a history from ${projectName(cwd)}:`, buttons)
    return null
  }

  private async withTrustedFolders<T extends string | null>(action: () => Promise<T>): Promise<T | string> {
    try {
      return await action()
    } catch (error) {
      if (!(error instanceof TrustedFoldersUnavailable)) {
        throw error
      }
      this.deps.log('reading Claude Code trusted folders failed', error)
      return CONFIG_UNREADABLE
    }
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
      await launcher.launch({ sessionId, cwd, model, resumeFrom, ...this.libraryDirs() })
    } catch (error) {
      const reason = reasonOf(error)
      await this.announce(thread, { state: 'failed', cwd, tmuxName, message: 'Could not start the session', detail: reason, fallback: `❌ Could not start the session:\n${reason}` }).catch(sendError => {
        log(`reporting the failed launch of ${sessionId} failed`, sendError)
      })
      await notifier.closeSession(sessionId)
      return `❌ Could not start the session: ${reason}`
    }
    this.armTimer(sessionId)
    await this.announce(thread, { state: 'starting', cwd, tmuxName, message: null, detail: null, fallback: `⏳ Starting… attach with: tmux attach -t ${tmuxName}` }).catch(sendError => {
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
      const seconds = STARTUP_TIMEOUT_MS / 1_000
      await this.announce(session.threadId, {
        state: 'failed',
        cwd: session.cwd,
        tmuxName: session.tmuxName,
        message: `The session did not start within ${seconds}s`,
        detail: shown,
        fallback: `❌ Session did not start within ${seconds}s. Last output:\n\n${shown}`,
      })
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
