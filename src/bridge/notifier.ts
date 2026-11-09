import type { Answer, Instruction, Report, ReportRequest, TitleRequest } from '../../mod/remote-agent/hooks/protocol.ts'
import type { ChatSink } from '../channel/chat-sink.ts'
import type { Channel, ThreadRef } from '../channel/types.ts'
import { redactSecrets, truncate } from '../core/text.ts'
import type { Log, PromptEvents } from './prompts.ts'
import type { PromptRow, SessionRow, Store } from './store.ts'
import { cleanSessionName, promptView, reportText, resolutionNote, sessionLabel, threadTitle } from './views.ts'

export class AwayMode {
  private readonly listeners = new Set<(away: boolean) => void>()

  constructor(private on: boolean) {}

  isAway(): boolean {
    return this.on
  }

  /** Calls the listener with the new value whenever it changes. A listener that throws does not stop the others. */
  set(on: boolean): void {
    if (this.on === on) {
      return
    }
    this.on = on
    for (const listener of [...this.listeners]) {
      try {
        listener(on)
      } catch (error) {
        console.error('AwayMode listener failed', error)
      }
    }
  }

  subscribe(listener: (away: boolean) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

export class Notifier implements PromptEvents {
  private readonly creating = new Map<string, Promise<ThreadRef>>()
  private readonly resolvedNotified = new Set<string>()
  private readonly delivering = new Set<string>()

  constructor(
    private readonly store: Store,
    private readonly channel: Channel,
    readonly away: AwayMode,
    private readonly log: Log = (message, error) => console.error(message, error),
    private readonly sink?: ChatSink,
  ) {}

  async ensureThread(sessionId: string): Promise<ThreadRef> {
    const session = this.requireSession(sessionId)
    if (session.threadId !== null) {
      return session.threadId
    }
    const inFlight = this.creating.get(sessionId)
    if (inFlight !== undefined) {
      return inFlight
    }
    const existing = this.sink?.existingChat(session) ?? null
    if (existing !== null) {
      this.store.setSessionThread(sessionId, existing)
      return existing
    }
    const sink = this.sink
    const created = this.channel
      .createThread(threadTitle(session))
      .then(threadId => {
        this.store.setSessionThread(sessionId, threadId)
        if (sink !== undefined) {
          this.sinkStep('sessionSeen', () => {
            sink.sessionSeen(this.requireSession(sessionId))
          })
        }
        return threadId
      })
      .finally(() => {
        this.creating.delete(sessionId)
      })
    this.creating.set(sessionId, created)
    return created
  }

  /** Called for every mod request that names a Session, so its web chat exists before anything else needs it. */
  sessionSeen(sessionId: string): void {
    const session = this.store.getSession(sessionId)
    // An in-flight ensureThread links the chat itself once its thread exists; linking now would make a second one.
    if (this.sink === undefined || session === undefined || this.isEndedSpawned(session) || this.creating.has(sessionId)) {
      return
    }
    try {
      this.sink.sessionSeen(session)
    } catch (error) {
      this.log(`linking the chat of ${sessionId} failed`, error)
    }
  }

  /** Follows the session name in the topic title. Never throws: a failed rename is retried on the next call. */
  async updateTitle(request: TitleRequest): Promise<void> {
    const name = cleanSessionName(request.title)
    if (name === '') {
      return
    }
    const session = this.store.upsertSession(request.session)
    if (session.title === name) {
      return
    }
    if (session.threadId === null) {
      this.store.setSessionTitle(session.id, name)
      return
    }
    try {
      await this.channel.renameThread(session.threadId, threadTitle({ ...session, title: name }))
      this.store.setSessionTitle(session.id, name)
    } catch (error) {
      this.log(`renaming the topic of ${session.id} failed`, error)
    }
  }

  async promptCreated(prompt: PromptRow): Promise<void> {
    this.delivering.add(prompt.id)
    try {
      await this.deliverPrompt(prompt)
    } finally {
      this.delivering.delete(prompt.id)
    }
  }

  /** Re-sends Prompts whose first delivery failed, so they never stay pending without a message. */
  async redeliverUndelivered(): Promise<void> {
    for (const prompt of this.store.listPendingPrompts()) {
      if (this.delivering.has(prompt.id) || this.store.listPromptMessageRefs(prompt.id).length > 0) {
        continue
      }
      try {
        await this.promptCreated(prompt)
      } catch (error) {
        this.log(`redelivery of ${prompt.id} failed`, error)
      }
    }
  }

  /** The Bridge ended it and its Thread is gone; late requests from the dying claude must not reopen it. */
  private isEndedSpawned(session: SessionRow): boolean {
    return session.spawned && session.endedAt !== null
  }

  private async deliverPrompt(prompt: PromptRow): Promise<void> {
    if (this.isEndedSpawned(this.requireSession(prompt.sessionId))) {
      await this.dismissPending(prompt.sessionId)
      return
    }
    const thread = await this.ensureThread(prompt.sessionId)
    const session = this.requireSession(prompt.sessionId)
    const refs = this.sink !== undefined ? this.sink.promptCreated(prompt, session) : await this.channel.sendPrompt(thread, promptView(prompt, session))
    refs.forEach((ref, index) => {
      this.store.addPromptMessage(prompt.id, ref, index)
    })
    const latest = this.store.getPrompt(prompt.id)
    if (latest !== undefined && latest.status === 'answered') {
      await this.promptResolved(latest)
    }
  }

  async promptResolved(prompt: PromptRow): Promise<void> {
    if (prompt.answer === null || prompt.source === null || this.resolvedNotified.has(prompt.id)) {
      return
    }
    const refs = this.store.listPromptMessageRefs(prompt.id)
    const session = this.store.getSession(prompt.sessionId)
    if (refs.length === 0 || session === undefined) {
      return
    }
    const sink = this.sink
    if (sink !== undefined) {
      this.resolvedNotified.add(prompt.id)
      this.sinkStep('promptResolved', () => {
        sink.promptResolved(prompt, refs)
      })
      return
    }
    if (session.threadId === null) {
      return
    }
    this.resolvedNotified.add(prompt.id)
    await this.channel.markResolved(session.threadId, refs, resolutionNote(prompt.answer, prompt.source))
  }

  /** One question of a multi-question Prompt was answered: its message flips to answered while the others keep waiting. */
  async promptPartAnswered(prompt: PromptRow, questionIndex: number, value: string): Promise<void> {
    const ref = this.store.listPromptMessageRefs(prompt.id)[questionIndex]
    const sink = this.sink
    if (ref === undefined || sink?.promptPartAnswered === undefined) {
      return
    }
    this.sinkStep('promptPartAnswered', () => {
      sink.promptPartAnswered?.(prompt, ref, questionIndex, value)
    })
  }

  async promptReminder(prompt: PromptRow): Promise<void> {
    const session = this.store.getSession(prompt.sessionId)
    if (session === undefined || session.threadId === null) {
      return
    }
    const sink = this.sink
    if (sink !== undefined) {
      this.sinkStep('promptReminder', () => {
        sink.promptReminder(prompt, session)
      })
      return
    }
    const refs = this.store.listPromptMessageRefs(prompt.id)
    await this.channel.sendText(session.threadId, `⏰ Still waiting for your answer (${sessionLabel(session)})`, refs[0] ?? null)
  }

  async report(request: ReportRequest): Promise<void> {
    const session = this.store.upsertSession(request.session)
    if (request.report.kind === 'session_ended') {
      await this.endSession(session, reportText(request.report, session), request.report)
      return
    }
    const sink = this.sink
    if (sink !== undefined) {
      if (!this.isEndedSpawned(session)) {
        this.sinkStep('report', () => {
          sink.report(session, request.report)
        })
      }
      return
    }
    if (!this.away.isAway() || this.isEndedSpawned(session)) {
      return
    }
    const thread = await this.ensureThread(session.id)
    await this.channel.sendText(thread, reportText(request.report, session), null)
  }

  async instructionDelivered(instruction: Instruction): Promise<void> {
    const sink = this.sink
    if (sink !== undefined) {
      this.sinkStep('instructionDelivered', () => {
        sink.instructionDelivered(instruction.id)
      })
      return
    }
    const session = this.store.getSession(instruction.sessionId)
    if (session === undefined || session.threadId === null) {
      return
    }
    await this.channel.sendText(session.threadId, `📨 Delivered: ${truncate(redactSecrets(instruction.text), 200)}`, null)
  }

  /** Ends a Session the Bridge stopped itself, so no session_ended Report will come. Idempotent. */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.store.getSession(sessionId)
    if (session === undefined || session.endedAt !== null) {
      return
    }
    await this.endSession(session, null, null)
  }

  private async endSession(session: SessionRow, text: string | null, report: Report | null): Promise<void> {
    // Read before endSession writes: a late request for a Spawned Session that already ended must not post into its chat.
    const late = this.isEndedSpawned(session)
    this.store.endSession(session.id)
    await this.dismissPending(session.id)
    if (this.sink !== undefined) {
      await this.endSinkChat(this.sink, session, report, late)
      return
    }
    if (session.threadId === null) {
      return
    }
    try {
      if (text !== null && this.away.isAway()) {
        await this.channel.sendText(session.threadId, text, null)
      }
    } finally {
      try {
        await this.channel.closeThread(session.threadId)
      } finally {
        this.store.setSessionThread(session.id, null)
      }
    }
  }

  private async endSinkChat(sink: ChatSink, session: SessionRow, report: Report | null, late: boolean): Promise<void> {
    if (report !== null && !late) {
      this.sinkStep('report', () => {
        sink.report(session, report)
      })
    }
    this.sinkStep('chatEnded', () => {
      sink.chatEnded(session)
    })
    const threadId = this.store.getSession(session.id)?.threadId ?? null
    if (threadId === null) {
      return
    }
    try {
      await this.channel.closeThread(threadId)
    } finally {
      this.store.setSessionThread(session.id, null)
    }
  }

  /**
   * Runs one call into the ChatSink. A failure is logged and never stops the Notifier's remaining steps
   * (closing the Thread, dismissing Prompts). Not used for promptCreated, which must propagate so redelivery can retry.
   */
  private sinkStep(what: string, step: () => void): void {
    try {
      step()
    } catch (error) {
      this.log(`chat sink ${what} failed`, error)
    }
  }

  /** A Session that ended can no longer receive Answers, so its pending Prompts are dismissed. */
  private async dismissPending(sessionId: string): Promise<void> {
    for (const prompt of this.store.listPendingPrompts()) {
      if (prompt.sessionId !== sessionId) {
        continue
      }
      const answer: Answer =
        prompt.body.kind === 'question'
          ? { kind: 'question', answers: {} }
          : { kind: 'permission', decision: 'deny', message: 'Session ended.' }
      if (!this.store.resolvePrompt(prompt.id, answer, 'local')) {
        continue
      }
      const latest = this.store.getPrompt(prompt.id)
      if (latest === undefined) {
        continue
      }
      try {
        await this.promptResolved(latest)
      } catch (error) {
        this.log(`dismissing ${prompt.id} failed`, error)
      }
    }
  }

  private requireSession(id: string): SessionRow {
    const session = this.store.getSession(id)
    if (session === undefined) {
      throw new Error(`Unknown session ${id}`)
    }
    return session
  }
}
