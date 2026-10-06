import type { Instruction, ReportRequest } from '../../mod/remote-agent/hooks/protocol.ts'
import type { Channel, ThreadRef } from '../channel/types.ts'
import { redactSecrets, truncate } from '../core/text.ts'
import type { PromptEvents } from './prompts.ts'
import type { PromptRow, SessionRow, Store } from './store.ts'
import { promptView, reportText, resolutionNote, sessionLabel, threadTitle } from './views.ts'

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

  constructor(
    private readonly store: Store,
    private readonly channel: Channel,
    readonly away: AwayMode,
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

  async promptCreated(prompt: PromptRow): Promise<void> {
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
    if (session.threadId === null) {
      return
    }
    if (this.away.isAway()) {
      await this.channel.sendText(session.threadId, text, null)
    }
    await this.channel.closeThread(session.threadId)
    this.store.setSessionThread(session.id, null)
  }

  private requireSession(id: string): SessionRow {
    const session = this.store.getSession(id)
    if (session === undefined) {
      throw new Error(`Unknown session ${id}`)
    }
    return session
  }
}
