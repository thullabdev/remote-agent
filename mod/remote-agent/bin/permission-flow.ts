import type { BridgeClient } from '../hooks/bridge-client.ts'

export type PermissionHookInput = { session_id: string; cwd: string; tool_name: string; tool_input: unknown; agent_id?: string }

export type HookOutput = {
  hookSpecificOutput: {
    hookEventName: 'PermissionRequest'
    decision: { behavior: 'allow' } | { behavior: 'deny'; message: string }
  }
}

export type PermissionFlowDeps = {
  bridge: Pick<BridgeClient, 'createPrompt' | 'waitAnswer'>
  newId: () => string
  sleep: (ms: number) => Promise<void>
  now: () => number
  /** How long the flow may wait for an Answer, in ms. Default 570_000, under the hook's 600 s timeout. */
  deadlineMs?: number
  waitMs?: number
  maxFailures?: number
  retryDelayMs?: number
}

export function parseHookInput(raw: string): PermissionHookInput | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const record = value as Record<string, unknown>
  if (typeof record.session_id !== 'string' || typeof record.cwd !== 'string' || typeof record.tool_name !== 'string' || !('tool_input' in record)) {
    return null
  }
  return {
    session_id: record.session_id,
    cwd: record.cwd,
    tool_name: record.tool_name,
    tool_input: record.tool_input,
    agent_id: typeof record.agent_id === 'string' ? record.agent_id : undefined,
  }
}

/**
 * Registers a Permission Request with the Bridge and waits for a remote Answer, racing Claude Code's own dialog.
 * Returns null (no output, so the native dialog decides) when the Bridge is unreachable, the Request was settled in
 * the terminal, or the deadline passes. Never produces an allow without a remote Answer.
 */
export async function runPermissionFlow(input: PermissionHookInput, deps: PermissionFlowDeps): Promise<HookOutput | null> {
  // Claude Code fires PermissionRequest for AskUserQuestion too, but the mod's tool.call hook answers Questions.
  if (input.tool_name === 'AskUserQuestion') {
    return null
  }
  const request = {
    promptId: `p:${deps.newId()}`,
    session: { sessionId: input.session_id, cwd: input.cwd },
    body: { kind: 'permission' as const, tool: input.tool_name, input: input.tool_input, agentId: input.agent_id },
  }
  try {
    await deps.bridge.createPrompt(request)
  } catch {
    return null
  }
  const deadline = deps.now() + (deps.deadlineMs ?? 570_000)
  const maxFailures = deps.maxFailures ?? 6
  let failures = 0
  while (deps.now() < deadline) {
    try {
      const polledAt = deps.now()
      const state = await deps.bridge.waitAnswer(request.promptId, deps.waitMs ?? 20_000)
      if (state.status === 'answered') {
        if (state.source !== 'remote' || state.answer.kind !== 'permission') {
          return null
        }
        const answer = state.answer
        const decision = answer.decision === 'allow' ? ({ behavior: 'allow' } as const) : ({ behavior: 'deny', message: answer.message ?? 'Denied via remote-agent.' } as const)
        return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }
      }
      if (state.status !== 'pending') {
        throw new Error('unexpected answer state')
      }
      failures = 0
      if (deps.now() - polledAt < 100) {
        // A Bridge that answers pending instantly must not turn the wait into a busy loop.
        await deps.sleep(deps.retryDelayMs ?? 1_000)
      }
    } catch {
      failures += 1
      if (failures >= maxFailures) {
        return null
      }
      await deps.sleep(deps.retryDelayMs ?? 1_000)
      await deps.bridge.createPrompt(request).catch(() => undefined)
    }
  }
  return null
}
