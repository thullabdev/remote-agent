import type { EngineInterface, Register } from 'claude-code'
import { BridgeClient } from './bridge-client.ts'
import {
  askQuestionsLocally,
  DismissedError,
  pollInstructions,
  resolvePrompt,
  toolInputOf,
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
    try {
      const bridge = await bridgeFor($)
      const session = { sessionId: e.sessionId, cwd: await $.session.cwd() }
      await bridge.report({ session, report: { kind: 'session_ended', reason: e.reason } }).catch(() => undefined)
    } catch {
      // Reporting is best effort and must never block the stock handler.
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) {
      return result
    }
    try {
      const bridge = await bridgeFor($)
      await bridge
        .report({ session: await sessionInfo($), report: { kind: 'turn_complete', text: e.answer, durationMs: e.durationMs, isAborted: e.isAborted } })
        .catch(() => undefined)
    } catch {
      // Reporting is best effort and must never change the turn result.
    }
    return result
  })

  // Reports each usage reading after the stock handler ran, detached so it never blocks or throws. The event already carries the figures, so $.session.usage() is not called.
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    void (async () => {
      const bridge = await bridgeFor($)
      const session = await sessionInfo($)
      await bridge.usage({ session, usage: { context: e.context, rateLimits: e.rateLimits, cost: e.cost } })
    })().catch(() => undefined)
    return result
  })

  // Tells the Bridge a tool call finished, so a Telegram Permission Request answered in the terminal is settled.
  // The PermissionRequest command hook is not cancelled by a local answer (ADR-0002).
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.tool === 'AskUserQuestion') {
      return ran
    }
    void (async () => {
      const bridge = await bridgeFor($)
      const session = await sessionInfo($)
      await bridge.settled(session.sessionId, { kind: 'tool', tool: e.tool, input: toolInputOf(e as unknown as Record<string, unknown>), denied: ran.deny !== undefined })
    })().catch(() => undefined)
    return ran
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const hasAnswers = e.answers !== undefined && Object.keys(e.answers).length > 0
    if (hasAnswers || e.tool_use_id === undefined) {
      return next(e)
    }
    let answer: Answer | null
    try {
      const questions = e.questions.map(question => ({
        question: question.question,
        header: question.header,
        multiSelect: question.multiSelect,
        options: question.options.map(option => ({ label: option.label, description: option.description })),
      }))
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
      // Fail safe: any other failure falls back to the stock question dialog.
      return next(e)
    }
    if (answer === null || answer.kind !== 'question') {
      return next(e)
    }
    // Spike E11/E12: answers passed through next() are dropped; the hook must answer the call itself.
    return { result: { questions: e.questions, answers: answer.answers } }
  })
}
