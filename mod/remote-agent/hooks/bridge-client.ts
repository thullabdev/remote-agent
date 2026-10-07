import type { Answer, AnswerResult, AnswerState, CreatePromptRequest, Instruction, ReportRequest, SettleScope, TitleRequest } from './protocol.ts'

export type HttpPort = (path: string, init?: { method?: string; body?: string }) => Promise<{ status: number; text: string }>

export class BridgeError extends Error {}

export class BridgeClient {
  constructor(private readonly http: HttpPort) {}

  createPrompt(request: CreatePromptRequest): Promise<AnswerState> {
    return this.json('/prompts', 'POST', request)
  }

  waitAnswer(promptId: string, waitMs: number): Promise<AnswerState> {
    return this.json(`/prompts/${encodeURIComponent(promptId)}?waitMs=${waitMs}`, 'GET')
  }

  postLocalAnswer(promptId: string, answer: Answer): Promise<AnswerResult> {
    return this.json(`/prompts/${encodeURIComponent(promptId)}/answer`, 'POST', { answer })
  }

  async report(request: ReportRequest): Promise<void> {
    await this.send('/reports', 'POST', request)
  }

  async title(request: TitleRequest): Promise<void> {
    await this.send('/titles', 'POST', request)
  }

  instructions(sessionId: string): Promise<Instruction[]> {
    return this.json(`/sessions/${encodeURIComponent(sessionId)}/instructions`, 'GET')
  }

  async settled(sessionId: string, scope: SettleScope): Promise<void> {
    await this.send(`/sessions/${encodeURIComponent(sessionId)}/settled`, 'POST', { scope })
  }

  async ackInstruction(id: string): Promise<void> {
    await this.send(`/instructions/${encodeURIComponent(id)}/delivered`, 'POST')
  }

  private async json<T>(path: string, method: string, body?: unknown): Promise<T> {
    const text = await this.send(path, method, body)
    return JSON.parse(text) as T
  }

  private async send(path: string, method: string, body?: unknown): Promise<string> {
    let response: { status: number; text: string }
    try {
      response = await this.http(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })
    } catch (error) {
      throw new BridgeError(`bridge unreachable: ${String(error)}`)
    }
    if (response.status >= 400) {
      throw new BridgeError(`bridge answered ${response.status} for ${method} ${path}: ${response.text}`)
    }
    return response.text
  }
}
