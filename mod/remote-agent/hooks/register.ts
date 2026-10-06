import type { EngineInterface, Register } from 'claude-code'
import { BridgeClient } from './bridge-client.ts'
import {
  askPermissionLocally,
  askQuestionsLocally,
  DismissedError,
  pollInstructions,
  resolvePrompt,
  type AskPort,
  type InstructionState,
  type Sleep,
} from './flows.ts'
import { BRIDGE_ORIGIN, defaultSocketPath, type Answer, type SessionInfo } from './protocol.ts'

const INSTRUCTION_POLL_MS = 3_000

let socketPath: string | undefined

const bridgeFor = async ($: EngineInterface): Promise<BridgeClient> => {
  if (socketPath === undefined) {
    socketPath = defaultSocketPath({ XDG_RUNTIME_DIR: await $.env.get('XDG_RUNTIME_DIR'), HOME: await $.env.get('HOME') })
  }
  const path = socketPath
  return new BridgeClient(async (route, init) => {
    const response = await $.http.fetch(`${BRIDGE_ORIGIN}${route}`, {
      method: init?.method ?? 'GET',
      body: init?.body,
      headers: { 'content-type': 'application/json' },
      socketPath: path,
    })
    return { status: response.status, text: response.text }
  })
}

const sessionInfo = async ($: EngineInterface): Promise<SessionInfo> => ({ sessionId: await $.session.id(), cwd: await $.session.cwd() })
const askPort = ($: EngineInterface): AskPort => (question, options) => $.ui.ask(question, options)
const sleepPort = ($: EngineInterface, signal: AbortSignal): Sleep => ms => $.clock.sleep(ms, { signal })

export const register: Register = on => {
  const instructionState: InstructionState = { inFlight: new Set(), submitted: new Set(), delivered: new Set() }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    if (!e.isInteractive) {
      return result
    }
    const bridge = await bridgeFor($)
    await bridge.report({ session: await sessionInfo($), report: { kind: 'session_started' } }).catch(() => undefined)
    $.clock.every(INSTRUCTION_POLL_MS, () => {
      void (async () => {
        const session = await sessionInfo($)
        await pollInstructions(bridge, session.sessionId, instructionState, async text => {
          await $.prompt.submit({ text, asUser: true })
        })
      })().catch(() => undefined)
    })
    return result
  })

  on('session.end', async ($, e, next) => {
    const bridge = await bridgeFor($)
    const session = { sessionId: e.sessionId, cwd: await $.session.cwd() }
    await bridge.report({ session, report: { kind: 'session_ended', reason: e.reason } }).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) {
      return result
    }
    const bridge = await bridgeFor($)
    await bridge
      .report({ session: await sessionInfo($), report: { kind: 'turn_complete', text: e.answer, durationMs: e.durationMs, isAborted: e.isAborted } })
      .catch(() => undefined)
    return result
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const hasAnswers = e.answers !== undefined && Object.keys(e.answers).length > 0
    if (hasAnswers || e.tool_use_id === undefined) {
      return next(e)
    }
    const questions = e.questions.map(question => ({
      question: question.question,
      header: question.header,
      multiSelect: question.multiSelect,
      options: question.options.map(option => ({ label: option.label, description: option.description })),
    }))
    let answer: Answer | null
    try {
      answer = await resolvePrompt({
        bridge: await bridgeFor($),
        request: { promptId: `q:${e.tool_use_id}`, session: await sessionInfo($), body: { kind: 'question', questions } },
        localAsk: askQuestionsLocally(askPort($), questions),
        signal: next.signal,
        sleep: sleepPort($, next.signal),
      })
    } catch (error) {
      if (error instanceof DismissedError) {
        return { deny: error.message }
      }
      throw error
    }
    if (answer === null || answer.kind !== 'question') {
      return next(e)
    }
    // Spike E11/E12: answers passed through next() are dropped; the hook must answer the call itself.
    return { result: { questions: e.questions, answers: answer.answers } }
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision !== 'ask' || e.tool === 'AskUserQuestion' || e.tool_use_id === undefined) {
      return verdict
    }
    const answer = await resolvePrompt({
      bridge: await bridgeFor($),
      request: {
        promptId: `p:${e.tool_use_id}`,
        session: await sessionInfo($),
        body: { kind: 'permission', tool: e.tool, input: e.input, reason: verdict.reason, agentId: e.agentId },
      },
      localAsk: askPermissionLocally(askPort($), e.tool, e.input),
      signal: next.signal,
      sleep: sleepPort($, next.signal),
    })
    if (answer === null || answer.kind !== 'permission') {
      return verdict
    }
    if (answer.decision === 'allow') {
      return { ...verdict, decision: 'allow', reason: 'Allowed by the user via remote-agent.' }
    }
    return { ...verdict, decision: 'deny', reason: answer.message ?? 'Denied by the user via remote-agent.' }
  })
}
