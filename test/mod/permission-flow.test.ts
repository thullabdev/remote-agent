import { describe, expect, test } from 'bun:test'
import { BridgeError } from '../../mod/remote-agent/hooks/bridge-client.ts'
import type { AnswerState, CreatePromptRequest } from '../../mod/remote-agent/hooks/protocol.ts'
import { parseHookInput, runPermissionFlow, type PermissionFlowDeps, type PermissionHookInput } from '../../mod/remote-agent/bin/permission-flow.ts'

const input: PermissionHookInput = { session_id: 's1', cwd: '/home/u/app', tool_name: 'Bash', tool_input: { command: 'ls' }, agent_id: 'sub-1' }
const noSleep = async () => {}

class FakeBridge {
  created: CreatePromptRequest[] = []
  createFails = false
  waits: (AnswerState | 'error')[] = []
  async createPrompt(request: CreatePromptRequest): Promise<AnswerState> {
    this.created.push(request)
    if (this.createFails) {
      throw new BridgeError('down')
    }
    return { status: 'pending' }
  }
  async waitAnswer(): Promise<AnswerState> {
    const next = this.waits.shift() ?? { status: 'pending' as const }
    if (next === 'error') {
      throw new BridgeError('down')
    }
    return next
  }
}

function deps(bridge: FakeBridge, extra: Partial<PermissionFlowDeps> = {}): PermissionFlowDeps {
  let clock = 0
  return { bridge, newId: () => 'id-1', sleep: noSleep, now: () => (clock += 1_000), deadlineMs: 5_000, ...extra }
}

describe('parseHookInput', () => {
  test('accepts the PermissionRequest stdin shape', () => {
    const raw = JSON.stringify({ session_id: 's1', cwd: '/x', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' }, permission_mode: 'default' })
    expect(parseHookInput(raw)).toEqual({ session_id: 's1', cwd: '/x', tool_name: 'Bash', tool_input: { command: 'ls' }, agent_id: undefined })
  })
  test('rejects garbage and missing fields', () => {
    expect(parseHookInput('not json')).toBeNull()
    expect(parseHookInput('{}')).toBeNull()
    expect(parseHookInput(JSON.stringify({ session_id: 's', cwd: '/x', tool_name: 'Bash' }))).toBeNull()
  })
})

describe('runPermissionFlow', () => {
  test('registers the prompt with the session, tool, input and agent', async () => {
    const bridge = new FakeBridge()
    bridge.waits = [{ status: 'answered', answer: { kind: 'permission', decision: 'allow' }, source: 'remote' }]
    await runPermissionFlow(input, deps(bridge))
    expect(bridge.created).toEqual([
      { promptId: 'p:id-1', session: { sessionId: 's1', cwd: '/home/u/app' }, body: { kind: 'permission', tool: 'Bash', input: { command: 'ls' }, agentId: 'sub-1' } },
    ])
  })

  test('a remote allow becomes an allow decision', async () => {
    const bridge = new FakeBridge()
    bridge.waits = [{ status: 'pending' }, { status: 'answered', answer: { kind: 'permission', decision: 'allow' }, source: 'remote' }]
    expect(await runPermissionFlow(input, deps(bridge))).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } })
  })

  test('a remote deny carries the user\'s message, with a default', async () => {
    const withMessage = new FakeBridge()
    withMessage.waits = [{ status: 'answered', answer: { kind: 'permission', decision: 'deny', message: 'use pnpm' }, source: 'remote' }]
    expect(await runPermissionFlow(input, deps(withMessage))).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'use pnpm' } } })
    const bare = new FakeBridge()
    bare.waits = [{ status: 'answered', answer: { kind: 'permission', decision: 'deny' }, source: 'remote' }]
    expect(await runPermissionFlow(input, deps(bare))).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'Denied via remote-agent.' } } })
  })

  test('an answer settled in the terminal produces no output', async () => {
    const bridge = new FakeBridge()
    bridge.waits = [{ status: 'answered', answer: { kind: 'permission', decision: 'allow', message: 'Settled in the terminal.' }, source: 'local' }]
    expect(await runPermissionFlow(input, deps(bridge))).toBeNull()
  })

  test('an unreachable bridge produces no output and never asks twice', async () => {
    const bridge = new FakeBridge()
    bridge.createFails = true
    expect(await runPermissionFlow(input, deps(bridge))).toBeNull()
    expect(bridge.created).toHaveLength(1)
  })

  test('polling errors are retried, re-registering the prompt, then give up silently', async () => {
    const survives = new FakeBridge()
    survives.waits = ['error', 'error', { status: 'answered', answer: { kind: 'permission', decision: 'allow' }, source: 'remote' }]
    expect(await runPermissionFlow(input, deps(survives, { maxFailures: 3 }))).not.toBeNull()
    expect(survives.created.length).toBeGreaterThan(1)
    const gives = new FakeBridge()
    gives.waits = ['error', 'error', 'error', 'error']
    expect(await runPermissionFlow(input, deps(gives, { maxFailures: 3 }))).toBeNull()
  })

  test('stops waiting at the deadline', async () => {
    const bridge = new FakeBridge()
    expect(await runPermissionFlow(input, deps(bridge, { deadlineMs: 3_000 }))).toBeNull()
  })
})
