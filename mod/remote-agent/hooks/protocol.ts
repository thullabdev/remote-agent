// Wire types shared by the mod (inside Claude Code) and the Bridge. Keep this file dependency-free.

export const BRIDGE_ORIGIN = 'http://bridge'
export const MAX_WAIT_MS = 25_000

export type SessionInfo = { sessionId: string; cwd: string }

export type QuestionOption = { label: string; description: string }
export type QuestionItem = { question: string; header: string; options: QuestionOption[]; multiSelect: boolean }

export type QuestionBody = { kind: 'question'; questions: QuestionItem[] }
export type PermissionBody = { kind: 'permission'; tool: string; input: unknown; reason?: string; agentId?: string }
export type PromptBody = QuestionBody | PermissionBody

export type CreatePromptRequest = { promptId: string; session: SessionInfo; body: PromptBody }

/** `answers` maps question text to the chosen label(s); empty means the Question was dismissed. */
export type QuestionAnswer = { kind: 'question'; answers: Record<string, string> }
export type PermissionAnswer = { kind: 'permission'; decision: 'allow' | 'deny'; message?: string }
export type Answer = QuestionAnswer | PermissionAnswer
export type AnswerSource = 'local' | 'remote'

export type AnswerState = { status: 'pending' } | { status: 'answered'; answer: Answer; source: AnswerSource }
export type AnswerResult = { accepted: boolean; state: AnswerState }

export type Report =
  | { kind: 'session_started' }
  | { kind: 'session_ended'; reason: string }
  | { kind: 'turn_complete'; text: string; durationMs: number; isAborted: boolean }
export type ReportRequest = { session: SessionInfo; report: Report }

/** The session's own name, as set with /rename or at start. */
export type TitleRequest = { session: SessionInfo; title: string }

/** One `session.measure` reading: the context window, the account's rate-limit windows and the session cost. */
export type UsageReport = {
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
  cost?: { usd: number }
}
/** `source` names the agent the reading is from; the Bridge treats a missing one as 'claude-code'. */
export type UsageRequest = { session: SessionInfo; source?: string; usage: UsageReport }

export type Instruction = { id: string; sessionId: string; text: string }

/** Marks a Permission Request that was answered in the terminal; the Answer's decision is then not meaningful. */
export const SETTLED_LOCALLY_MESSAGE = 'Settled in the terminal.'

/** `tool`: a tool call matching this tool name and input finished. `all`: the turn ended, so nothing for the session is still pending. */
export type SettleScope = { kind: 'tool'; tool: string; input: unknown; denied: boolean } | { kind: 'all' }
export type SettleRequest = { scope: SettleScope }

export function defaultSocketPath(env: { XDG_RUNTIME_DIR?: string; HOME?: string }): string {
  if (env.XDG_RUNTIME_DIR) {
    return `${env.XDG_RUNTIME_DIR}/remote-agent/bridge.sock`
  }
  if (env.HOME) {
    return `${env.HOME}/.local/state/remote-agent/bridge.sock`
  }
  throw new Error('Neither XDG_RUNTIME_DIR nor HOME is set')
}

export function projectName(cwd: string): string {
  const parts = cwd.split('/').filter(part => part !== '')
  return parts.at(-1) ?? '/'
}
