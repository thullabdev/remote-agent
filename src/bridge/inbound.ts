import type { AnswerResult, QuestionItem } from '../../mod/remote-agent/hooks/protocol.ts'
import type { ButtonData, ChannelHandlers, InboundCommand, InboundText } from '../channel/types.ts'
import type { Notifier } from './notifier.ts'
import type { PromptService } from './prompts.ts'
import type { PromptMessageLink, Store } from './store.ts'
import { sessionLabel } from './views.ts'

const ALLOW_WORDS = new Set(['allow', 'yes', 'y', 'ok', 'approve'])
const DENY_WORDS = new Set(['deny', 'no', 'n', 'reject'])

export function parseQuestionReply(question: QuestionItem, text: string): string {
  const trimmed = text.trim()
  const parts = trimmed.split(/\s*,\s*/)
  if (!parts.every(part => /^\d+$/.test(part))) {
    return trimmed
  }
  if (!question.multiSelect && parts.length > 1) {
    return trimmed
  }
  const labels = parts.map(part => question.options[Number(part) - 1]?.label)
  if (labels.some(label => label === undefined)) {
    return trimmed
  }
  return labels.join(', ')
}

function describe(result: AnswerResult | undefined, fallback: string): string {
  if (result === undefined) {
    return 'This prompt no longer exists.'
  }
  if (!result.accepted) {
    return 'Already answered.'
  }
  if (result.state.status === 'pending') {
    return 'Recorded. Answer the remaining questions to continue.'
  }
  return fallback
}

export class Inbound implements ChannelHandlers {
  constructor(
    private readonly store: Store,
    private readonly prompts: PromptService,
    private readonly notifier: Notifier,
  ) {}

  async onButton(press: ButtonData): Promise<string> {
    if (press.kind !== 'answer') {
      return 'Unknown button.'
    }
    const prompt = this.store.getPrompt(press.promptId)
    if (prompt === undefined) {
      return 'This prompt no longer exists.'
    }
    if (prompt.status === 'answered') {
      return 'Already answered.'
    }
    if (prompt.body.kind === 'permission') {
      const decision = press.optionIndex === 0 ? 'allow' : 'deny'
      const result = this.prompts.answer(prompt.id, { kind: 'permission', decision }, 'remote')
      return describe(result, decision === 'allow' ? 'Allowed' : 'Denied')
    }
    const option = prompt.body.questions[press.questionIndex]?.options[press.optionIndex]
    if (option === undefined) {
      return 'Unknown option.'
    }
    return describe(this.prompts.answerQuestionPart(prompt.id, press.questionIndex, option.label), `Answered: ${option.label}`)
  }

  async onText(message: InboundText): Promise<string | null> {
    if (message.replyTo !== null) {
      const link = this.store.findPromptMessage(message.replyTo)
      if (link !== undefined) {
        return this.answerByText(link, message.text)
      }
    }
    if (message.thread === null) {
      return 'Send instructions inside a session topic.'
    }
    const session = this.store.findSessionByThread(message.thread)
    if (session === undefined || session.endedAt !== null) {
      return 'This session has ended.'
    }
    this.store.enqueueInstruction(session.id, message.text)
    return '📥 Queued. It will be sent when the session is idle.'
  }

  async onCommand(command: InboundCommand): Promise<string | null> {
    if (command.name === 'away') {
      this.notifier.away.set(true)
      return '🛫 Away mode on: prompts and reports will be sent.'
    }
    if (command.name === 'back') {
      this.notifier.away.set(false)
      return '🏠 Away mode off: only prompts will be sent.'
    }
    if (command.name === 'status') {
      const sessions = this.store.listActiveSessions()
      const lines = [
        `Away mode: ${this.notifier.away.isAway() ? 'on' : 'off'}`,
        `Active sessions: ${sessions.length}`,
        ...sessions.map(session => `• ${sessionLabel(session)}`),
        `Pending prompts: ${this.store.listPendingPrompts().length}`,
      ]
      return lines.join('\n')
    }
    return 'Unknown command. Try /away, /back or /status.'
  }

  private answerByText(link: PromptMessageLink, text: string): string {
    const prompt = this.store.getPrompt(link.promptId)
    if (prompt === undefined) {
      return 'This prompt no longer exists.'
    }
    if (prompt.status === 'answered') {
      return 'Already answered.'
    }
    if (prompt.body.kind === 'permission') {
      const word = text.trim().toLowerCase()
      const decision = ALLOW_WORDS.has(word) ? 'allow' : 'deny'
      const message = decision === 'deny' && !DENY_WORDS.has(word) ? text.trim() : undefined
      const result = this.prompts.answer(prompt.id, { kind: 'permission', decision, ...(message === undefined ? {} : { message }) }, 'remote')
      return describe(result, decision === 'allow' ? 'Allowed' : 'Denied')
    }
    const question = prompt.body.questions[link.questionIndex]
    if (question === undefined) {
      return 'Unknown question.'
    }
    const value = parseQuestionReply(question, text)
    return describe(this.prompts.answerQuestionPart(prompt.id, link.questionIndex, value), `Answered: ${value}`)
  }
}
