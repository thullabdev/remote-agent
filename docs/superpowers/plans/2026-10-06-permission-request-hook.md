# Permission Requests via PermissionRequest hook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the mod from taking over permission decisions in modes whose decider is not the human (auto mode), by carrying Permission Requests on a `PermissionRequest` command hook instead of the mod's `tool.check` hook.

**Architecture:** A `bun` command hook, shipped in the same plugin, fires only when Claude Code is about to show a permission dialog. It registers a Permission Request with the Bridge and long-polls for a Telegram answer, racing the native dialog. Claude Code does not cancel the hook when the user answers locally, so the mod's `tool.call` hook reports each finished tool call to the Bridge, and the Bridge settles any matching pending Permission Request as answered in the terminal. A finished turn settles everything left for the session.

**Tech Stack:** Bun, TypeScript, zod 3, bun:sqlite (existing); Claude Code plugin command hooks.

**Spec:** `docs/superpowers/specs/2026-10-06-remote-agent-design.md` (requirement 5). Decision: `docs/adr/0002-permission-requests-via-command-hook.md`. Evidence: `references/spike-results.md` "Round 2" (R1–R8).

## Global Constraints

- TypeScript strict. Every `if` body uses curly braces, including early returns: `if (!x) { return }`, never `if (!x) return`.
- Commit messages are the plain message only: **no** `Co-Authored-By` trailer, no "Generated with" line.
- Mod files import each other with explicit `.ts` extensions and may import only files inside `mod/remote-agent/`. Bun tests for mod code live in `test/mod/`, outside the plugin folder.
- All text sent to Telegram passes through `redactSecrets` then `truncate` (existing `views.ts` helpers).
- Use the glossary terms from `CONTEXT.md`.
- If the Bridge is unreachable, the hook must exit 0 with **no output** so the native dialog is the only path. Nothing is ever approved without an Answer.
- The hook's `PermissionRequest` timeout is 600 s; the flow's own deadline is 570 s.

## Review Focus

1. Auto mode: a call the classifier settles must produce no Prompt, no Telegram message and no mod dialog. (Verified by the E2E in Task 3.)
2. A remote Answer arriving after the user answered locally must not change anything.
3. `tool_input` key order differing between `PermissionRequest` and the finished tool call must still match.
4. Bridge down, restarted mid-wait, or returning errors: the hook ends silently.
5. A turn that ends with a still-pending Permission Request settles it exactly once and strips its buttons.

---

## File Structure

- Modify `mod/remote-agent/hooks/protocol.ts`: `SETTLED_LOCALLY_MESSAGE`, `SettleScope`, `SettleRequest`
- Create `src/core/json.ts`: `canonicalJson`
- Modify `src/bridge/prompts.ts`: `PromptService.settleLocally`
- Modify `src/bridge/schemas.ts`, `src/bridge/http.ts`: `POST /sessions/:id/settled`, settle on `turn_complete`
- Modify `src/bridge/views.ts`: `resolutionNote` for settled prompts
- Modify `mod/remote-agent/hooks/bridge-client.ts`: `settled`
- Create `mod/remote-agent/bin/permission-flow.ts` (pure) and `mod/remote-agent/bin/permission-hook.ts` (entry)
- Modify `mod/remote-agent/hooks/hooks.json`, `register.ts`, `flows.ts`
- Modify `README.md`, `docs/superpowers/specs/2026-10-06-remote-agent-design.md`, `tsconfig.json`

---

### Task 1: Bridge settles Permission Requests locally

**Files:**
- Modify: `mod/remote-agent/hooks/protocol.ts`, `src/bridge/prompts.ts`, `src/bridge/schemas.ts`, `src/bridge/http.ts`, `src/bridge/views.ts`
- Create: `src/core/json.ts`
- Test: `test/core/json.test.ts`, `test/bridge/prompts.test.ts`, `test/bridge/http.test.ts`, `test/bridge/views.test.ts`

**Interfaces:**
- Produces (protocol.ts): `export const SETTLED_LOCALLY_MESSAGE = 'Settled in the terminal.'`; `export type SettleScope = { kind: 'tool'; tool: string; input: unknown; denied: boolean } | { kind: 'all' }`; `export type SettleRequest = { scope: SettleScope }`
- Produces: `canonicalJson(value: unknown): string`; `PromptService.settleLocally(sessionId: string, scope: SettleScope): number` (returns how many prompts it settled); `POST /sessions/:id/settled` body `SettleRequest` → `200 { settled: number }`

- [ ] **Step 1: Write the failing tests**

`test/core/json.test.ts`:

```ts
import { expect, test } from 'bun:test'
import { canonicalJson } from '../../src/core/json.ts'

test('object key order does not matter, at any depth', () => {
  expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: 2 } })).toBe(canonicalJson({ a: { c: 2, d: [1, { y: 2, z: 1 }] }, b: 1 }))
})

test('different values differ', () => {
  expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }))
  expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
})

test('undefined and primitives are handled', () => {
  expect(canonicalJson(undefined)).toBe('undefined')
  expect(canonicalJson('x')).toBe('"x"')
  expect(canonicalJson(null)).toBe('null')
})
```

Append to `test/bridge/prompts.test.ts` (reuse its `service`, `events`, `session`, `permission` and `twoQuestions` fixtures; the `permission` fixture is a Bash prompt with `input: { command: 'ls' }` for session `s1`):

```ts
import { SETTLED_LOCALLY_MESSAGE } from '../../mod/remote-agent/hooks/protocol.ts'

function permissionFor(id: string, sessionId: string, tool: string, input: unknown): CreatePromptRequest {
  return { promptId: id, session: { sessionId, cwd: '/home/u/app' }, body: { kind: 'permission', tool, input } }
}

test('settleLocally settles the matching permission prompt, whatever the key order', async () => {
  service.create(permissionFor('p:a', 's1', 'Bash', { command: 'ls', description: 'list' }))
  service.create(permissionFor('p:b', 's1', 'Bash', { command: 'pwd' }))
  service.create(permissionFor('p:c', 's2', 'Bash', { command: 'ls', description: 'list' }))
  service.create(twoQuestions)
  expect(service.settleLocally('s1', { kind: 'tool', tool: 'Bash', input: { description: 'list', command: 'ls' }, denied: false })).toBe(1)
  expect(service.state('p:a')).toEqual({ status: 'answered', answer: { kind: 'permission', decision: 'allow', message: SETTLED_LOCALLY_MESSAGE }, source: 'local' })
  expect(service.state('p:b')).toEqual({ status: 'pending' })
  expect(service.state('p:c')).toEqual({ status: 'pending' })
  expect(service.state('q:1')).toEqual({ status: 'pending' })
  await flush()
  expect(events.resolved).toEqual(['p:a'])
})

test('settleLocally records a denied tool call as deny', () => {
  service.create(permissionFor('p:a', 's1', 'Bash', { command: 'ls' }))
  service.settleLocally('s1', { kind: 'tool', tool: 'Bash', input: { command: 'ls' }, denied: true })
  expect(service.state('p:a')).toMatchObject({ answer: { decision: 'deny' }, source: 'local' })
})

test('settleLocally "all" settles every pending permission prompt of that session only', () => {
  service.create(permissionFor('p:a', 's1', 'Bash', { command: 'ls' }))
  service.create(permissionFor('p:b', 's1', 'Edit', { file_path: '/a' }))
  service.create(permissionFor('p:c', 's2', 'Bash', { command: 'ls' }))
  service.create(twoQuestions)
  expect(service.settleLocally('s1', { kind: 'all' })).toBe(2)
  expect(service.state('p:c')).toEqual({ status: 'pending' })
  expect(service.state('q:1')).toEqual({ status: 'pending' })
})

test('settleLocally never overrides an earlier answer', () => {
  service.create(permissionFor('p:a', 's1', 'Bash', { command: 'ls' }))
  service.answer('p:a', { kind: 'permission', decision: 'deny' }, 'remote')
  expect(service.settleLocally('s1', { kind: 'all' })).toBe(0)
  expect(service.state('p:a')).toMatchObject({ answer: { decision: 'deny' }, source: 'remote' })
})
```

Append to `test/bridge/http.test.ts` (reuse its `call`, `session`, `channel`, `flush` helpers):

```ts
test('POST /sessions/:id/settled settles the matching permission prompt', async () => {
  await call('POST', '/prompts', permissionRequest)
  const response = await call('POST', '/sessions/s1/settled', { scope: { kind: 'tool', tool: 'Bash', input: { command: 'rm -rf build' }, denied: false } })
  expect(await response.json()).toEqual({ settled: 1 })
  expect(await (await call('GET', '/prompts/p%3Atoolu_1')).json()).toMatchObject({ status: 'answered', source: 'local' })
  await flush()
  expect(channel.resolved.map(resolved => resolved.note)).toEqual(['☑️ Answered in the terminal'])
})

test('a turn_complete report settles the session\'s pending permission prompts', async () => {
  await call('POST', '/prompts', permissionRequest)
  await call('POST', '/reports', { session, report: { kind: 'turn_complete', text: 'done', durationMs: 1_000, isAborted: false } })
  expect(await (await call('GET', '/prompts/p%3Atoolu_1')).json()).toMatchObject({ status: 'answered', source: 'local' })
})

test('malformed settle bodies are 400', async () => {
  expect((await call('POST', '/sessions/s1/settled', { scope: { kind: 'tool' } })).status).toBe(400)
})
```

Append to `test/bridge/views.test.ts`:

```ts
import { SETTLED_LOCALLY_MESSAGE } from '../../mod/remote-agent/hooks/protocol.ts'

test('a prompt settled in the terminal is reported as such, not as an allow or deny', () => {
  expect(resolutionNote({ kind: 'permission', decision: 'allow', message: SETTLED_LOCALLY_MESSAGE }, 'local')).toBe('☑️ Answered in the terminal')
  expect(resolutionNote({ kind: 'permission', decision: 'deny', message: SETTLED_LOCALLY_MESSAGE }, 'local')).toBe('☑️ Answered in the terminal')
})
```

- [ ] **Step 2: Run the new tests and confirm they fail**

Run: `bun test test/core/json.test.ts test/bridge/prompts.test.ts test/bridge/http.test.ts test/bridge/views.test.ts`
Expected: FAIL (`canonicalJson` missing, `settleLocally` is not a function, 404 on the new route, wrong note).

- [ ] **Step 3: Implement**

`mod/remote-agent/hooks/protocol.ts`: add (after the `Instruction` type):

```ts
/** Marks a Permission Request that was answered in the terminal; the Answer's decision is then not meaningful. */
export const SETTLED_LOCALLY_MESSAGE = 'Settled in the terminal.'

/** `tool`: a tool call matching this tool name and input finished. `all`: the turn ended, so nothing for the session is still pending. */
export type SettleScope = { kind: 'tool'; tool: string; input: unknown; denied: boolean } | { kind: 'all' }
export type SettleRequest = { scope: SettleScope }
```

`src/core/json.ts`:

```ts
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys)
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    return Object.fromEntries(entries.map(([key, item]) => [key, sortKeys(item)]))
  }
  return value
}

/** JSON with object keys sorted at every depth, so equal values compare equal as strings. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? 'undefined'
}
```

`src/bridge/prompts.ts`: import `SETTLED_LOCALLY_MESSAGE` and `type SettleScope` from protocol and `canonicalJson` from `../core/json.ts`; add this method to `PromptService` (before `remindStale`):

```ts
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
      const result = this.answer(prompt.id, { kind: 'permission', decision, message: SETTLED_LOCALLY_MESSAGE }, 'local')
      if (result?.accepted === true) {
        settled += 1
      }
    }
    return settled
  }
```

`src/bridge/schemas.ts`: append

```ts
export const SettleRequestSchema = z.object({
  scope: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('tool'), tool: z.string().min(1), input: z.unknown(), denied: z.boolean() }),
    z.object({ kind: z.literal('all') }),
  ]),
})
```

`src/bridge/http.ts`: add `const SESSION_SETTLED = /^\/sessions\/([^/]+)\/settled$/`; import `SettleRequestSchema` and `type SettleRequest`. Inside `route`, add before the `/reports` branch:

```ts
  const settled = SESSION_SETTLED.exec(path)
  if (method === 'POST' && settled !== null) {
    const body = SettleRequestSchema.parse(await request.json()) as SettleRequest
    return json({ settled: deps.prompts.settleLocally(param(settled), body.scope) })
  }
```

and in the `/reports` branch, before `void deps.notifier.report(body)`:

```ts
    if (body.report.kind === 'turn_complete') {
      deps.prompts.settleLocally(body.session.sessionId, { kind: 'all' })
    }
```

`src/bridge/views.ts`: import `SETTLED_LOCALLY_MESSAGE` and, at the top of the `answer.kind === 'permission'` branch of `resolutionNote`:

```ts
    if (answer.message === SETTLED_LOCALLY_MESSAGE) {
      return '☑️ Answered in the terminal'
    }
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun test && bun run typecheck`
Expected: all PASS (the existing 109 plus the new ones), no type errors.

- [ ] **Step 5: Commit**

```bash
git add mod/remote-agent/hooks/protocol.ts src test
git commit -m "feat: let the bridge settle permission requests answered in the terminal"
```

---

### Task 2: Permission hook script

**Files:**
- Create: `mod/remote-agent/bin/permission-flow.ts`, `mod/remote-agent/bin/permission-hook.ts`
- Modify: `mod/remote-agent/hooks/bridge-client.ts`, `tsconfig.json`
- Test: `test/mod/permission-flow.test.ts`, `test/mod/bridge-client.test.ts`

**Interfaces:**
- Consumes: `BridgeClient` (`createPrompt`, `waitAnswer`), `Answer`, `AnswerState`, `BRIDGE_ORIGIN`, `defaultSocketPath`, `SettleScope`
- Produces: `BridgeClient.settled(sessionId: string, scope: SettleScope): Promise<void>`; `parseHookInput(raw: string): PermissionHookInput | null`; `runPermissionFlow(input: PermissionHookInput, deps: PermissionFlowDeps): Promise<HookOutput | null>`; types `PermissionHookInput = { session_id: string; cwd: string; tool_name: string; tool_input: unknown; agent_id?: string }`, `HookOutput = { hookSpecificOutput: { hookEventName: 'PermissionRequest'; decision: { behavior: 'allow' } | { behavior: 'deny'; message: string } } }`

- [ ] **Step 1: Write the failing tests**

`test/mod/permission-flow.test.ts`:

```ts
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
```

Append to `test/mod/bridge-client.test.ts`:

```ts
test('settled posts the scope to the session', async () => {
  const { calls, client } = recording([{ status: 200, text: '{"settled":1}' }])
  await client.settled('s 1', { kind: 'all' })
  expect(calls[0]).toMatchObject({ path: '/sessions/s%201/settled', method: 'POST' })
  expect(JSON.parse(calls[0]!.body!)).toEqual({ scope: { kind: 'all' } })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `bun test test/mod`
Expected: FAIL (modules and `settled` missing).

- [ ] **Step 3: Implement**

`mod/remote-agent/hooks/bridge-client.ts`: import `type SettleScope`; add

```ts
  async settled(sessionId: string, scope: SettleScope): Promise<void> {
    await this.send(`/sessions/${encodeURIComponent(sessionId)}/settled`, 'POST', { scope })
  }
```

`mod/remote-agent/bin/permission-flow.ts`:

```ts
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
      const state = await deps.bridge.waitAnswer(request.promptId, deps.waitMs ?? 20_000)
      failures = 0
      if (state.status === 'answered') {
        if (state.source !== 'remote' || state.answer.kind !== 'permission') {
          return null
        }
        const answer = state.answer
        const decision = answer.decision === 'allow' ? ({ behavior: 'allow' } as const) : ({ behavior: 'deny', message: answer.message ?? 'Denied via remote-agent.' } as const)
        return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }
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
```

`mod/remote-agent/bin/permission-hook.ts`:

```ts
// Command hook for Claude Code's PermissionRequest event. See docs/adr/0002-permission-requests-via-command-hook.md.
// Any failure ends silently with exit 0 so Claude Code's own dialog decides.
import { BridgeClient } from '../hooks/bridge-client.ts'
import { BRIDGE_ORIGIN, defaultSocketPath } from '../hooks/protocol.ts'
import { parseHookInput, runPermissionFlow } from './permission-flow.ts'

async function main(): Promise<void> {
  const input = parseHookInput(await Bun.stdin.text())
  if (input === null) {
    return
  }
  const socketPath = defaultSocketPath(process.env)
  const bridge = new BridgeClient(async (route, init) => {
    const response = await fetch(`${BRIDGE_ORIGIN}${route}`, {
      method: init?.method ?? 'GET',
      body: init?.body,
      headers: { 'content-type': 'application/json' },
      unix: socketPath,
    })
    return { status: response.status, text: await response.text() }
  })
  const output = await runPermissionFlow(input, { bridge, newId: () => crypto.randomUUID(), sleep: ms => Bun.sleep(ms), now: Date.now })
  if (output !== null) {
    process.stdout.write(JSON.stringify(output))
  }
}

try {
  await main()
} catch {
  // Exit 0 with no output: the native dialog decides.
}
```

`tsconfig.json`: add `"mod/remote-agent/bin"` to `include`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `bun test && bun run typecheck`
Expected: all PASS, no type errors. If `unix:` is rejected by `bun-types`' `RequestInit`, keep it and add a narrow cast on that one options object with a comment.

- [ ] **Step 5: Smoke-test the script against a dead Bridge**

Run: `echo '{"session_id":"s","cwd":"/tmp","tool_name":"Bash","tool_input":{"command":"ls"},"hook_event_name":"PermissionRequest"}' | XDG_RUNTIME_DIR=/tmp/ra-nonexistent bun run mod/remote-agent/bin/permission-hook.ts; echo "exit=$? "`
Expected: no stdout, `exit=0`, and it returns in well under a second.

- [ ] **Step 6: Commit**

```bash
git add mod/remote-agent/bin mod/remote-agent/hooks/bridge-client.ts tsconfig.json test/mod
git commit -m "feat: add permission request hook script that races the native dialog"
```

---

### Task 3: Wire it into the plugin, drop tool.check, update docs

**Files:**
- Modify: `mod/remote-agent/hooks/hooks.json`, `mod/remote-agent/hooks/register.ts`, `mod/remote-agent/hooks/flows.ts`, `test/mod/flows.test.ts`, `README.md`, `docs/superpowers/specs/2026-10-06-remote-agent-design.md`

**Interfaces:**
- Consumes: `BridgeClient.settled`, `bridgeFor`, `sessionInfo` (module-level helpers already in `register.ts`)
- Produces: `toolInputOf(call: Record<string, unknown>): Record<string, unknown>` exported from `flows.ts`

- [ ] **Step 1: Write the failing test** (append to `test/mod/flows.test.ts`, importing `toolInputOf` from flows)

```ts
describe('toolInputOf', () => {
  test('strips the engine\'s own keys and keeps the tool arguments', () => {
    expect(toolInputOf({ tool: 'Bash', tool_use_id: 'toolu_1', agentId: 'a', consent: 'c', command: 'ls', description: 'list' })).toEqual({ command: 'ls', description: 'list' })
  })
  test('keeps nested values untouched', () => {
    expect(toolInputOf({ tool: 'Edit', file_path: '/a', edits: [{ x: 1 }] })).toEqual({ file_path: '/a', edits: [{ x: 1 }] })
  })
})
```

Run: `bun test test/mod/flows.test.ts` → Expected: FAIL (`toolInputOf` not exported).

- [ ] **Step 2: Implement `flows.ts` changes**

- Add:

```ts
const ENGINE_KEYS = new Set(['tool', 'tool_use_id', 'agentId', 'consent'])

/** The tool's own arguments from a `tool.call` input: what a PermissionRequest hook reports as `tool_input`. */
export function toolInputOf(call: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(call).filter(([key]) => !ENGINE_KEYS.has(key)))
}
```

- Delete `askPermissionLocally` and `shortSummary` and their tests in `test/mod/flows.test.ts` (the `local asks` describe keeps only the questions test). Nothing else uses them once `tool.check` is gone.

- [ ] **Step 3: Implement `register.ts` changes**

- Remove the whole `on('tool.check', ...)` hook, and remove `askPermissionLocally` from the imports; add `toolInputOf` to them.
- Add this hook **before** the AskUserQuestion hook:

```ts
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
```

- [ ] **Step 4: Register the command hook**

`mod/remote-agent/hooks/hooks.json`:

```json
{
  "modules": ["./register.ts"],
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bun run \"${CLAUDE_PLUGIN_ROOT}/bin/permission-hook.ts\"",
            "timeout": 600
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 5: Verify**

Run each and show the output:
- `bun test && bun run typecheck`
- `claude plugin validate mod/remote-agent` (warnings about `author` are fine; errors are not. If it rejects the `hooks` key next to `modules`, or the `tool.call` hook passing `$` inside the async closure, adjust minimally and explain.)
- The fallback mod type check: `bunx tsc -p /tmp/claude-1000/-home-giganotosaurus-Sites-remote-agent/4e0eb914-6eda-4f4d-a871-ae9700854ced/scratchpad/mod-tsc/tsconfig.json` (its `include` names the hooks files; add `/home/giganotosaurus/Sites/remote-agent/.claude/worktrees/permission-request/mod/remote-agent/hooks/*.ts` instead of the old main-checkout path if it is stale, and say so).

- [ ] **Step 6: Docs**

- `README.md`: in "Known limitations" delete the bullet about the mod's own dialog ("header \"Plugin\"... always allow") and the bullet about the Bridge being down for 6 seconds *for permission prompts* (Questions still have it; reword to "Questions"). Add: "Permission Requests use Claude Code's own dialog; Telegram answers race it. In auto mode only requests the classifier escalates to you reach Telegram." and "The permission hook runs with `bun`; make sure `bun` is on the `PATH` Claude Code uses for hooks (`which bun` in a fresh shell)." In section 4 add a sentence that the plugin also installs a `PermissionRequest` hook.
- Spec requirement 5: append "Permission Requests race Claude Code's own permission dialog through a `PermissionRequest` hook (ADR-0002); a Permission Request answered in the terminal is settled when the tool call finishes or the turn ends."

- [ ] **Step 7: Commit**

```bash
git add mod README.md docs test
git commit -m "fix: carry permission requests on a PermissionRequest hook so auto mode is not interrupted"
```
