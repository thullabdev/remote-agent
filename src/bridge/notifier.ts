import type { Answer, Instruction, ReportRequest, TitleRequest } from '../../mod/remote-agent/hooks/protocol.ts'
import type { Channel, ThreadRef } from '../channel/types.ts'
import { redactSecrets, truncate } from '../core/text.ts'
import type { Log, PromptEvents } from './prompts.ts'
import type { PromptRow, SessionRow, Store } from './store.ts'
import { cleanSessionName, promptView, reportText, resolutionNote, sessionLabel, threadTitle } from './views.ts'

export class AwayMode {
  constructor(private on: boolean) {}

  isAway(): boolean {
    return this.on
  }

  set(on: boolean): void {
    this.on = on
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
    const created = this.channel
      .createThread(threadTitle(session))
      .then(threadId => {
        this.store.setSessionThread(sessionId, threadId)
        return threadId
      })
      .finally(() => {
        this.creating.delete(sessionId)
      })
    this.creating.set(sessionId, created)
    return created
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

  private async deliverPrompt(prompt: PromptRow): Promise<void> {
    const thread = await this.ensureThread(prompt.sessionId)
    const session = this.requireSession(prompt.sessionId)
    const refs = await this.channel.sendPrompt(thread, promptView(prompt, session))
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
    if (refs.length === 0 || session === undefined || session.threadId === null) {
      return
    }
    this.resolvedNotified.add(prompt.id)
    await this.channel.markResolved(session.threadId, refs, resolutionNote(prompt.answer, prompt.source))
  }

  async promptReminder(prompt: PromptRow): Promise<void> {
    const session = this.store.getSession(prompt.sessionId)
    if (session === undefined || session.threadId === null) {
      return
    }
    const refs = this.store.listPromptMessageRefs(prompt.id)
    await this.channel.sendText(session.threadId, `⏰ Still waiting for your answer (${sessionLabel(session)})`, refs[0] ?? null)
  }

  async report(request: ReportRequest): Promise<void> {
    const session = this.store.upsertSession(request.session)
    if (request.report.kind === 'session_ended') {
      await this.endSession(session, reportText(request.report, session))
      return
    }
    if (!this.away.isAway()) {
      return
    }
    const thread = await this.ensureThread(session.id)
    await this.channel.sendText(thread, reportText(request.report, session), null)
  }

  async instructionDelivered(instruction: Instruction): Promise<void> {
    const session = this.store.getSession(instruction.sessionId)
    if (session === undefined || session.threadId === null) {
      return
    }
    await this.channel.sendText(session.threadId, `📨 Delivered: ${truncate(redactSecrets(instruction.text), 200)}`, null)
  }

  private async endSession(session: SessionRow, text: string): Promise<void> {
    this.store.endSession(session.id)
    await this.dismissPending(session.id)
    if (session.threadId === null) {
      return
    }
    try {
      if (this.away.isAway()) {
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
