import type { BridgeClient } from './bridge-client.ts'
import type { Answer, CreatePromptRequest, Instruction, PromptBody, QuestionItem } from './protocol.ts'

export type BridgePort = Pick<BridgeClient, 'createPrompt' | 'waitAnswer' | 'postLocalAnswer' | 'instructions' | 'ackInstruction'>
export type Sleep = (ms: number) => Promise<void>
export type AskPort = (question: string, options: { options: string[]; header?: string; multiSelect?: true }) => Promise<string>

export class DismissedError extends Error {
  constructor() {
    super('The user dismissed the question in the terminal.')
  }
}

export type ResolveOptions = {
  bridge: BridgePort
  request: CreatePromptRequest
  localAsk: () => Promise<Answer>
  signal: AbortSignal
  sleep: Sleep
  waitMs?: number
  maxFailures?: number
  retryDelayMs?: number
}

const DISMISSED_MESSAGE = 'Dismissed in the terminal.'

function never<T>(): Promise<T> {
  return new Promise<T>(() => {})
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    signal.addEventListener('abort', () => {
      reject(signal.reason)
    }, { once: true })
  })
}

function dismissal(body: PromptBody): Answer {
  if (body.kind === 'question') {
    return { kind: 'question', answers: {} }
  }
  return { kind: 'permission', decision: 'deny', message: DISMISSED_MESSAGE }
}

function isDismissedQuestion(answer: Answer): boolean {
  return answer.kind === 'question' && Object.keys(answer.answers).length === 0
}

async function waitForRemote(options: ResolveOptions): Promise<Answer> {
  const waitMs = options.waitMs ?? 20_000
  const maxFailures = options.maxFailures ?? 3
  const retryDelayMs = options.retryDelayMs ?? 1_000
  let failures = 0
  while (!options.signal.aborted) {
    try {
      const state = await options.bridge.waitAnswer(options.request.promptId, waitMs)
      failures = 0
      if (state.status === 'answered') {
        return state.answer
      }
    } catch {
      failures += 1
      if (failures >= maxFailures) {
        return never<Answer>()
      }
      await options.sleep(retryDelayMs)
      await options.bridge.createPrompt(options.request).catch(() => undefined)
    }
  }
  return never<Answer>()
}

/**
 * Registers the Prompt with the Bridge and races the terminal against Telegram. First Answer wins.
 * Returns null when the Bridge is unreachable, so the caller falls back to stock behaviour.
 */
export async function resolvePrompt(options: ResolveOptions): Promise<Answer | null> {
  const { bridge, request } = options
  try {
    const initial = await bridge.createPrompt(request)
    if (initial.status === 'answered') {
      return initial.answer
    }
  } catch {
    return null
  }

  const remote = waitForRemote(options).then(answer => ({ source: 'remote' as const, answer }))
  const local = options.localAsk().then(
    answer => ({ source: 'local' as const, answer }),
    () => ({ source: 'dismissed' as const, answer: dismissal(request.body) }),
  )
  const aborted = rejectOnAbort(options.signal)
  remote.catch(() => undefined)
  aborted.catch(() => undefined)

  const winner = await Promise.race([remote, local, aborted])
  if (winner.source === 'remote') {
    return winner.answer
  }
  let final = winner.answer
  try {
    const result = await bridge.postLocalAnswer(request.promptId, winner.answer)
    if (!result.accepted && result.state.status === 'answered') {
      final = result.state.answer
    }
  } catch {
    // Bridge unreachable: the local Answer stands.
  }
  if (isDismissedQuestion(final)) {
    throw new DismissedError()
  }
  return final
}

export function askQuestionsLocally(ask: AskPort, questions: readonly QuestionItem[]): () => Promise<Answer> {
  return async () => {
    const answers: Record<string, string> = {}
    for (const question of questions) {
      answers[question.question] = await ask(question.question, {
        options: question.options.map(option => option.label),
        header: question.header.slice(0, 12),
        ...(question.multiSelect ? { multiSelect: true as const } : {}),
      })
    }
    return { kind: 'question', answers }
  }
}

export function shortSummary(tool: string, input: unknown): string {
  const record = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const pick = (key: string): string | undefined => (typeof record[key] === 'string' ? (record[key] as string) : undefined)
  const detail = pick('command') ?? pick('file_path') ?? pick('url') ?? pick('pattern') ?? JSON.stringify(input) ?? tool
  const oneLine = detail.replace(/\s+/g, ' ').trim()
  return oneLine.length > 160 ? `${oneLine.slice(0, 160)}…` : oneLine
}

export function askPermissionLocally(ask: AskPort, tool: string, input: unknown): () => Promise<Answer> {
  return async () => {
    const label = await ask(`Allow ${tool}: ${shortSummary(tool, input)}?`, { options: ['Allow', 'Deny'] })
    if (label === 'Allow') {
      return { kind: 'permission', decision: 'allow' }
    }
    if (label === 'Deny') {
      return { kind: 'permission', decision: 'deny' }
    }
    return { kind: 'permission', decision: 'deny', message: label }
  }
}

export type InstructionState = { inFlight: Set<string>; submitted: Set<string> }

async function acknowledge(bridge: BridgePort, id: string, state: InstructionState): Promise<void> {
  try {
    await bridge.ackInstruction(id)
    state.submitted.delete(id)
  } catch {
    // Retried on the next poll.
  }
}

async function deliver(bridge: BridgePort, instruction: Instruction, state: InstructionState, submit: (text: string) => Promise<void>): Promise<void> {
  try {
    await submit(instruction.text)
    state.submitted.add(instruction.id)
    await acknowledge(bridge, instruction.id, state)
  } catch {
    // Submit failed: retried on the next poll.
  } finally {
    state.inFlight.delete(instruction.id)
  }
}

/** Delivers each pending Instruction as a user turn exactly once. Resolves when this poll's deliveries settle. */
export async function pollInstructions(
  bridge: BridgePort,
  sessionId: string,
  state: InstructionState,
  submit: (text: string) => Promise<void>,
): Promise<void> {
  const pending = await bridge.instructions(sessionId)
  const deliveries: Promise<void>[] = []
  for (const instruction of pending) {
    if (state.inFlight.has(instruction.id)) {
      continue
    }
    if (state.submitted.has(instruction.id)) {
      deliveries.push(acknowledge(bridge, instruction.id, state))
      continue
    }
    state.inFlight.add(instruction.id)
    deliveries.push(deliver(bridge, instruction, state, submit))
  }
  await Promise.all(deliveries)
}
