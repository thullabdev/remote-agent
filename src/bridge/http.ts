import { ZodError } from 'zod'
import { MAX_WAIT_MS, type Answer, type CreatePromptRequest, type ReportRequest, type SettleRequest, type TitleRequest } from '../../mod/remote-agent/hooks/protocol.ts'
import { BadRequest } from './errors.ts'
import type { Notifier } from './notifier.ts'
import type { Log, PromptService } from './prompts.ts'
import { CreatePromptSchema, LocalAnswerSchema, ReportRequestSchema, SettleRequestSchema, TitleRequestSchema } from './schemas.ts'
import type { Store } from './store.ts'

export type HttpDeps = { prompts: PromptService; notifier: Notifier; store: Store; log: Log }

const PROMPT = /^\/prompts\/([^/]+)$/
const PROMPT_ANSWER = /^\/prompts\/([^/]+)\/answer$/
const SESSION_INSTRUCTIONS = /^\/sessions\/([^/]+)\/instructions$/
const SESSION_SETTLED = /^\/sessions\/([^/]+)\/settled$/
const INSTRUCTION_DELIVERED = /^\/instructions\/([^/]+)\/delivered$/

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

function empty(status: number): Response {
  return new Response(null, { status })
}

function clampWait(raw: string | null): number {
  const value = Number(raw ?? '0')
  if (!Number.isFinite(value) || value < 0) {
    return 0
  }
  return Math.min(value, MAX_WAIT_MS)
}

function param(match: RegExpExecArray): string {
  return decodeURIComponent(match[1] ?? '')
}

export function createHandler(deps: HttpDeps): (request: Request) => Promise<Response> {
  return async request => {
    try {
      return await route(deps, request)
    } catch (error) {
      if (error instanceof ZodError || error instanceof BadRequest || error instanceof SyntaxError) {
        return json({ error: error.message }, 400)
      }
      deps.log(`HTTP ${request.method} ${new URL(request.url).pathname} failed`, error)
      return json({ error: 'internal error' }, 500)
    }
  }
}

async function route(deps: HttpDeps, request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method

  if (method === 'GET' && path === '/health') {
    return json({ ok: true })
  }

  if (method === 'POST' && path === '/prompts') {
    const body = CreatePromptSchema.parse(await request.json()) as CreatePromptRequest
    return json(deps.prompts.create(body))
  }

  const prompt = PROMPT.exec(path)
  if (method === 'GET' && prompt !== null) {
    const state = await deps.prompts.waitFor(param(prompt), clampWait(url.searchParams.get('waitMs')))
    return state === undefined ? empty(404) : json(state)
  }

  const answer = PROMPT_ANSWER.exec(path)
  if (method === 'POST' && answer !== null) {
    const body = LocalAnswerSchema.parse(await request.json()) as { answer: Answer }
    const result = deps.prompts.answer(param(answer), body.answer, 'local')
    return result === undefined ? empty(404) : json(result)
  }

  const settled = SESSION_SETTLED.exec(path)
  if (method === 'POST' && settled !== null) {
    const body = SettleRequestSchema.parse(await request.json()) as SettleRequest
    return json({ settled: deps.prompts.settleLocally(param(settled), body.scope) })
  }

  if (method === 'POST' && path === '/reports') {
    const body = ReportRequestSchema.parse(await request.json()) as ReportRequest
    if (body.report.kind === 'turn_complete') {
      try {
        deps.prompts.settleLocally(body.session.sessionId, { kind: 'all' })
      } catch (error) {
        deps.log('settling permission prompts failed', error)
      }
    }
    void deps.notifier.report(body).catch(error => {
      deps.log('report delivery failed', error)
    })
    return empty(202)
  }

  if (method === 'POST' && path === '/titles') {
    const body = TitleRequestSchema.parse(await request.json()) as TitleRequest
    await deps.notifier.updateTitle(body)
    return empty(204)
  }

  const instructions = SESSION_INSTRUCTIONS.exec(path)
  if (method === 'GET' && instructions !== null) {
    return json(deps.store.listPendingInstructions(param(instructions)))
  }

  const delivered = INSTRUCTION_DELIVERED.exec(path)
  if (method === 'POST' && delivered !== null) {
    const instruction = deps.store.getInstruction(param(delivered))
    if (instruction === undefined) {
      return empty(404)
    }
    if (deps.store.markInstructionDelivered(instruction.id)) {
      void deps.notifier.instructionDelivered(instruction).catch(error => {
        deps.log('delivery confirmation failed', error)
      })
    }
    return empty(204)
  }

  return empty(404)
}
