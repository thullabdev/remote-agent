import { SETTLED_LOCALLY_MESSAGE, type Answer, type AnswerResult, type AnswerSource, type AnswerState, type CreatePromptRequest, type SettleScope } from '../../mod/remote-agent/hooks/protocol.ts'
import { canonicalJson } from '../core/json.ts'
import { BadRequest } from './errors.ts'
import type { PromptRow, Store } from './store.ts'

export type Log = (message: string, error?: unknown) => void

export interface PromptEvents {
  promptCreated(prompt: PromptRow): Promise<void>
  promptResolved(prompt: PromptRow): Promise<void>
  promptReminder(prompt: PromptRow): Promise<void>
}

type Waiter = (state: AnswerState) => void

function toState(prompt: PromptRow): AnswerState {
  if (prompt.status === 'answered' && prompt.answer !== null && prompt.source !== null) {
    return { status: 'answered', answer: prompt.answer, source: prompt.source }
  }
  return { status: 'pending' }
}

export class PromptService {
  private readonly waiters = new Map<string, Set<Waiter>>()
  private readonly now: () => number
  private readonly log: Log

  constructor(
    private readonly store: Store,
    private readonly events: PromptEvents,
    private readonly options: { reminderAfterMs: number; now?: () => number; log?: Log },
  ) {
    this.now = options.now ?? Date.now
    this.log = options.log ?? ((message, error) => console.error(message, error))
  }

  create(request: CreatePromptRequest): AnswerState {
    this.store.upsertSession(request.session)
    const isNew = this.store.insertPrompt(request.promptId, request.session.sessionId, request.body)
    const prompt = this.requirePrompt(request.promptId)
    if (isNew) {
      this.fire('promptCreated', () => this.events.promptCreated(prompt))
    }
    return toState(prompt)
  }

  state(id: string): AnswerState | undefined {
    const prompt = this.store.getPrompt(id)
    return prompt === undefined ? undefined : toState(prompt)
  }

  waitFor(id: string, waitMs: number): Promise<AnswerState | undefined> {
    const current = this.state(id)
    if (current === undefined || current.status === 'answered' || waitMs <= 0) {
      return Promise.resolve(current)
    }
    return new Promise(resolve => {
      const waiters = this.waiters.get(id) ?? new Set<Waiter>()
      this.waiters.set(id, waiters)
      const timer = setTimeout(() => {
        waiters.delete(waiter)
        resolve(this.state(id))
      }, waitMs)
      const waiter: Waiter = state => {
        clearTimeout(timer)
        resolve(state)
      }
      waiters.add(waiter)
    })
  }

  answer(id: string, answer: Answer, source: AnswerSource): AnswerResult | undefined {
    const prompt = this.store.getPrompt(id)
    if (prompt === undefined) {
      return undefined
    }
    if (prompt.body.kind !== answer.kind) {
      throw new BadRequest(`Prompt ${id} is a ${prompt.body.kind}, not a ${answer.kind}`)
    }
    const accepted = this.store.resolvePrompt(id, answer, source)
    const latest = this.requirePrompt(id)
    const state = toState(latest)
    if (accepted) {
      this.wake(id, state)
      this.fire('promptResolved', () => this.events.promptResolved(latest))
    }
    return { accepted, state }
  }

  answerQuestionPart(id: string, questionIndex: number, value: string): AnswerResult | undefined {
    const prompt = this.store.getPrompt(id)
    if (prompt === undefined) {
      return undefined
    }
    if (prompt.body.kind !== 'question') {
      throw new BadRequest(`Prompt ${id} is not a question`)
    }
    if (prompt.status === 'answered') {
      return { accepted: false, state: toState(prompt) }
    }
    const question = prompt.body.questions[questionIndex]
    if (question === undefined) {
      throw new BadRequest(`Prompt ${id} has no question ${questionIndex}`)
    }
    const partial = { ...prompt.partial, [question.question]: value }
    const isComplete = prompt.body.questions.every(item => Object.hasOwn(partial, item.question))
    if (isComplete) {
      return this.answer(id, { kind: 'question', answers: partial }, 'remote')
    }
    this.store.setPartial(id, partial)
    return { accepted: true, state: { status: 'pending' } }
  }

  /** Settles pending Permission Requests of a session that were answered in the terminal. Returns how many it settled. */
  settleLocally(sessionId: string, scope: SettleScope): number {
    let settled = 0
    for (const prompt of this.store.listPendingPrompts()) {
      if (prompt.sessionId !== sessionId || prompt.body.kind !== 'permission') {
        continue
      }
      if (scope.kind === 'tool' && (prompt.body.tool !== scope.tool || canonicalJson(prompt.body.input) !== canonicalJson(scope.input))) {
        continue
      }
      const decision = scope.kind === 'tool' && !scope.denied ? 'allow' : 'deny'
      try {
        const result = this.answer(prompt.id, { kind: 'permission', decision, message: SETTLED_LOCALLY_MESSAGE }, 'local')
        if (result?.accepted === true) {
          settled += 1
        }
      } catch (error) {
        this.log(`settling ${prompt.id} failed`, error)
      }
    }
    return settled
  }

  async remindStale(): Promise<void> {
    const cutoff = this.now() - this.options.reminderAfterMs
    for (const prompt of this.store.listStalePrompts(cutoff)) {
      this.store.markReminded(prompt.id)
      try {
        await this.events.promptReminder(prompt)
      } catch (error) {
        this.log(`reminder for ${prompt.id} failed`, error)
      }
    }
  }

  private wake(id: string, state: AnswerState): void {
    const waiters = this.waiters.get(id)
    if (waiters === undefined) {
      return
    }
    this.waiters.delete(id)
    for (const waiter of waiters) {
      waiter(state)
    }
  }

  private fire(label: string, run: () => Promise<void>): void {
    void run().catch(error => {
      this.log(`${label} failed`, error)
    })
  }

  private requirePrompt(id: string): PromptRow {
    const prompt = this.store.getPrompt(id)
    if (prompt === undefined) {
      throw new Error(`Prompt ${id} vanished`)
    }
    return prompt
  }
}
