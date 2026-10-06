# Remote Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Watch and steer every active Claude Code Session on this machine from Telegram. You get Prompts and Reports there, can answer Prompts, and can send Instructions that resume idle Sessions.

**Architecture:** A Claude Code **mod** (in-process hooks, installed at user scope) runs inside every Session. It talks over a Unix socket to a local **Bridge**: a Bun HTTP server with a SQLite store, run as a systemd user service. The Bridge pushes Prompts and Reports to a Telegram supergroup with one forum topic (Thread) per Session, using grammY long polling. Answers race: the terminal dialog and Telegram both stay live, and the first Answer wins.

**Tech Stack:** TypeScript, Bun 1.2.5 (`bun:sqlite`, `Bun.serve({ unix })`, `bun test`), grammY + `@grammyjs/auto-retry`, zod 3, Claude Code mods (v2.1.287+, installed 2.1.290).

**Spec:** `docs/superpowers/specs/2026-10-06-remote-agent-design.md`. Glossary: `CONTEXT.md`. Decision: `docs/adr/0001-mod-as-session-client.md`. Research: `references/`.

## Global Constraints

- TypeScript `strict`. Every `if` body uses curly braces, including early returns. Write `if (!x) { return }`, never `if (!x) return;`.
- Commit messages are the plain message only, with **no** `Co-Authored-By` trailer.
- Runtime is Bun ≥ 1.2.5, and the bridge is started with `bun run src/bridge/main.ts`. zod is pinned to v3 (`zod@3`).
- Bridge socket: `$XDG_RUNTIME_DIR/remote-agent/bridge.sock`, falling back to `$HOME/.local/state/remote-agent/bridge.sock`. Directory mode 0700, socket mode 0600.
- `Bun.serve` must set `idleTimeout: 60`. Long polls wait up to `MAX_WAIT_MS = 25_000`, and the default 10 s idle timeout would cut them.
- Telegram: HTML parse mode, every message ≤ 4,096 chars, `callback_data` ≤ 64 bytes, forum topic names ≤ 128 chars.
- Only updates whose `chat.id === TELEGRAM_CHAT_ID` **and** `from.id === TELEGRAM_ALLOWED_USER_ID` are processed.
- All text sent to Telegram passes through `redactSecrets` then `truncate`.
- Nothing is ever approved without an Answer. If the Bridge is unreachable, the mod falls back to stock Claude Code behaviour.
- Mod files live in `mod/remote-agent/` and import each other with explicit `.ts` extensions. Their bun unit tests live **outside** the plugin folder (`test/mod/`), because `claude plugin test` runs every `*.test.ts` inside it.
- Use the glossary terms from `CONTEXT.md` (Session, Prompt, Question, Permission Request, Answer, Report, Instruction, Bridge, Channel, Thread, Away mode) in names and user-facing text.

## Review Focus

1. **Bridge down when a Prompt is raised.** The Session must behave exactly like stock Claude Code immediately, with no hang. Pinned by Task 12 "falls back when the bridge is unreachable".
2. **Two Prompts at once for a brand-new Session.** Exactly one Thread must be created. Pinned by Task 7 "creates one thread for concurrent prompts".
3. **The same Prompt answered twice.** This covers a double button tap, and a terminal answer racing a Telegram answer. The first Answer wins, the second is told "already answered", and the Session gets the winner. Pinned by Task 6 "first answer wins" and Task 12 "local answer loses to an earlier remote answer".
4. **Messages from strangers, or a plain message inside a topic.** Strangers are ignored. Telegram reports every topic message as a reply to the topic root, so a plain message must count as an Instruction, not an Answer. Pinned by Task 10 `isAuthorized` and `replyTarget` tests.
5. **Huge, HTML-laden or secret-laden tool input** (a 10k-char heredoc containing `<`, `&` and an API key). It must be redacted, escaped and ≤ 4,096 chars. Pinned by Task 2 redaction tests and Task 10 "renderHtml stays under the limit".

---

## File Structure

```
remote-agent/
├── package.json, tsconfig.json, .gitignore, .env.example, README.md
├── CONTEXT.md, docs/adr/, docs/superpowers/{specs,plans}/, references/
├── deploy/remote-agent.service                 systemd user unit
├── mod/
│   ├── .claude-plugin/marketplace.json         local marketplace (one plugin)
│   └── remote-agent/                           the Claude Code mod
│       ├── .claude-plugin/plugin.json
│       └── hooks/
│           ├── hooks.json                      { "modules": ["./register.ts"] }
│           ├── protocol.ts                     wire types + socket path (shared with Bridge)
│           ├── bridge-client.ts                typed HTTP client over an injected transport
│           ├── flows.ts                        pure orchestration: race, instructions, local asks
│           └── register.ts                     wiring to the engine `$` (thin)
├── src/
│   ├── core/text.ts                            truncate, redactSecrets, escapeHtml
│   ├── channel/
│   │   ├── types.ts                            Channel contract (no Telegram types)
│   │   └── telegram/{render.ts,updates.ts,adapter.ts}
│   └── bridge/
│       ├── config.ts                           env → Config
│       ├── errors.ts                           BadRequest
│       ├── store.ts                            bun:sqlite persistence
│       ├── views.ts                            domain → channel text (redacted)
│       ├── prompts.ts                          PromptService: first-answer-wins, long-poll waiters
│       ├── notifier.ts                         AwayMode + Notifier: Threads, Prompt/Report delivery
│       ├── inbound.ts                          Channel → domain (buttons, replies, commands)
│       ├── schemas.ts                          zod request validation
│       ├── http.ts                             fetch handler (routes)
│       └── main.ts                             composition root
└── test/
    ├── support/fake-channel.ts
    ├── core/, bridge/, channel/, mod/          bun tests
```

---

### Task 1: Repository init and mod spike

The ADR depends on mod behaviour that is undocumented or unverified. This spike checks it against the installed CLI before anything is built on it. **Some steps need the human partner at a terminal.** Spike code is throwaway and git-ignored. Only the results file is committed.

**Files:**
- Create: `.gitignore`, `spike/server.ts`, `spike/mod/.claude-plugin/plugin.json`, `spike/mod/hooks/hooks.json`, `spike/mod/hooks/register.ts`
- Create: `references/spike-results.md`

**Interfaces:**
- Consumes: nothing
- Produces: `references/spike-results.md`. Its findings may adjust Task 13 as described in Step 7.

- [ ] **Step 1: Init git and ignore files**

```bash
cd /home/giganotosaurus/Sites/remote-agent
git init
cat > .gitignore <<'EOF'
node_modules/
spike/
*.db
*.db-wal
*.db-shm
.env
mod/remote-agent/.claude-plugin/types/
EOF
git add .gitignore CONTEXT.md docs references
git commit -m "chore: add glossary, ADR, spec, plan and research references"
```

- [ ] **Step 2: Write the spike server**

`spike/server.ts`:

```ts
import { rmSync } from 'node:fs'

const SOCKET = '/tmp/remote-agent-spike.sock'
rmSync(SOCKET, { force: true })

let answer = 'remote-answer'
let instruction = ''

Bun.serve({
  unix: SOCKET,
  idleTimeout: 60,
  async fetch(request) {
    const url = new URL(request.url)
    console.log(new Date().toISOString(), request.method, url.pathname + url.search)
    if (url.pathname === '/answer') {
      await Bun.sleep(Number(url.searchParams.get('waitMs') ?? '0'))
      return new Response(answer)
    }
    if (url.pathname === '/set-answer') {
      answer = await request.text()
      return new Response('ok')
    }
    if (url.pathname === '/instruction' && request.method === 'POST') {
      instruction = await request.text()
      return new Response('ok')
    }
    if (url.pathname === '/instruction') {
      const text = instruction
      instruction = ''
      return new Response(text)
    }
    if (url.pathname === '/log') {
      console.log('MOD:', await request.text())
      return new Response('ok')
    }
    return new Response('not found', { status: 404 })
  },
})
console.log(`spike server listening on ${SOCKET}`)
```

- [ ] **Step 3: Write the spike mod**

`spike/mod/.claude-plugin/plugin.json`:

```json
{ "name": "remote-agent-spike", "version": "0.0.1", "description": "Throwaway spike for remote-agent mod assumptions" }
```

`spike/mod/hooks/hooks.json`:

```json
{ "modules": ["./register.ts"] }
```

`spike/mod/hooks/register.ts`:

```ts
import type { EngineInterface, Register } from 'claude-code'

const SOCKET = '/tmp/remote-agent-spike.sock'

async function call($: EngineInterface, path: string, body?: string): Promise<string> {
  const response = await $.http.fetch(`http://bridge${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    body,
    socketPath: SOCKET,
  })
  return response.text
}

function log($: EngineInterface, line: string): void {
  void call($, '/log', line).catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    log($, `E1 loaded session=${await $.session.id()} interactive=${e.isInteractive}`)
    $.clock.every(3_000, () => {
      void (async () => {
        const text = await call($, '/instruction')
        if (text !== '') {
          log($, `E5 submitting "${text}"`)
          await $.prompt.submit({ text, asUser: true })
          log($, 'E5 submit resolved')
        }
      })().catch(error => {
        log($, `E5 error ${String(error)}`)
      })
    })
    return result
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    log($, `E6 tool.call tool_use_id=${String(e.tool_use_id)} answers=${JSON.stringify(e.answers)}`)
    const first = e.questions[0]
    if (first === undefined) {
      return next(e)
    }
    const started = Date.now()
    const local = $.ui.ask(first.question, first.options.map(option => option.label)).then(
      label => ({ source: 'local', label }),
      error => ({ source: 'local-rejected', label: String(error) }),
    )
    const remote = call($, '/answer?waitMs=15000').then(label => ({ source: 'remote', label }))
    const winner = await Promise.race([local, remote])
    log($, `E2/E3 winner=${winner.source} label=${winner.label} after=${Date.now() - started}ms signalAborted=${next.signal.aborted}`)
    void local.then(late => {
      log($, `E3 local settled later: ${JSON.stringify(late)}`)
    })
    return next({ ...e, answers: { [first.question]: winner.label } })
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    log($, `E6/E9 tool.check tool=${e.tool} tool_use_id=${String(e.tool_use_id)} decision=${verdict.decision}`)
    if (e.tool !== 'Bash' || verdict.decision !== 'ask') {
      return verdict
    }
    const remote = await call($, '/answer?waitMs=15000')
    log($, `E4 remote verdict=${remote}`)
    return { ...verdict, decision: remote === 'deny' ? 'deny' : 'allow', reason: `spike: remote said ${remote}` }
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const started = Date.now()
    await new Promise<void>(resolve => {
      $.clock.after(12_000, resolve)
    })
    log($, `E7 clock.after promise waited ${Date.now() - started}ms and the hook was not skipped`)
    return next(e)
  })
}
```

- [ ] **Step 4: Validate the spike mod**

Run: `claude plugin validate spike/mod`
Expected: no errors. It lists hooks on `session.start`, `tool.call` and `tool.check`, and calls to `http.fetch`, `ui.ask`, `prompt.submit` and `clock.*`.

- [ ] **Step 5: Run the experiments (human partner at a terminal)**

Terminal A: `bun spike/server.ts`. Terminal B: `claude --plugin-dir /home/giganotosaurus/Sites/remote-agent/spike/mod`. Read the results in Terminal A's `MOD:` lines.

| ID | Do this in Terminal B (or via curl) | Expected |
|---|---|---|
| E1a | Start the session | `E1 loaded … interactive=true` |
| E1b | In a **different, already running** plain `claude` session: add `"CLAUDE_CODE_PLUGIN_DIRS": "/home/giganotosaurus/Sites/remote-agent/spike/mod"` to the `env` block of `~/.claude/settings.json`, then type `/reload-plugins`. Remove the env entry afterwards. | `E1 loaded` appears for that session |
| E2/E3a | Prompt: `Use AskUserQuestion to ask me to pick red or blue.` Don't touch the dialog for 15 s. | `winner=remote after≈15000ms`; Claude reports the answer `remote-answer`. **Note what happens to the terminal dialog.** |
| E3b | Same prompt, then answer in the terminal within 15 s | `winner=local` |
| E4 | Prompt: `Run: touch /tmp/spike-$RANDOM`. Don't answer. Then run `curl --unix-socket /tmp/remote-agent-spike.sock -d deny http://bridge/set-answer` and repeat. | First run allowed after ≈15 s, second denied. Note whether a native dialog was visible during the wait. |
| E5 | While idle: `curl --unix-socket /tmp/remote-agent-spike.sock -d 'Say hello from the spike' http://bridge/instruction`. Repeat while Claude is busy on a long task. | A new turn starts and shows as a user message. While busy, it is held until idle. |
| E6 | Read the E6 lines | `tool_use_id` is a non-empty string in both `tool.call` and `tool.check` |
| E7 | Prompt: `Read package.json` (any file) | The E7 line shows ≈12000 ms and the Read still ran |
| E9 | Read the E6/E9 line for `tool=AskUserQuestion` | Record which `decision` `tool.check` gives AskUserQuestion, or that it doesn't fire |

- [ ] **Step 6: Record the results**

Write `references/spike-results.md` with one row per experiment: `ID | Expected | Observed (paste the MOD lines) | Consequence`. Fill in the Consequence column using Step 7.

- [ ] **Step 7: Apply the decision rules (write the chosen consequence in the results file)**

- **E1b fails:** no design change. README tells the user to restart already-running Sessions once.
- **E3a: the terminal dialog stays open after the remote side wins.** If pressing Esc on it does **not** interrupt the turn, record it as a known limitation. If Esc on the stale dialog interrupts the turn, **stop and re-plan with the human partner**, because the local race would then need to be gated on Away mode.
- **E4 or E5 fails:** **stop and re-plan.** The ADR's premise is broken.
- **E6: `tool_use_id` is missing.** In Task 13, replace `` `q:${e.tool_use_id}` `` and `` `p:${e.tool_use_id}` `` with `` `q:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}` `` (`p:` for permissions), and delete the `e.tool_use_id === undefined` guards.
- **E7: the hook was skipped.** Keep Task 13's `sleepPort` on `$.clock.sleep` with `maxFailures: 3`. **E7 passed:** in Task 13, change `sleepPort` to `ms => new Promise<void>(resolve => { $.clock.after(ms, resolve) })` and pass `maxFailures: 15, retryDelayMs: 2_000` so the mod survives a Bridge restart.
- **E9:** if `tool.check` gives `ask` for AskUserQuestion, Task 13's `e.tool === 'AskUserQuestion'` guard is required. Keep it in any case.

- [ ] **Step 8: Commit**

```bash
git add references/spike-results.md
git commit -m "docs: record mod spike results"
```

---

### Task 2: Project scaffold and text utilities

**Files:**
- Create: `package.json`, `tsconfig.json`, `src/core/text.ts`
- Test: `test/core/text.test.ts`

**Interfaces:**
- Produces: `truncate(text: string, max: number): string`, `redactSecrets(text: string): string`, `escapeHtml(text: string): string`, `REDACTED = '[REDACTED]'`

- [ ] **Step 1: Scaffold the package**

Don't use `bun init`: it rewrites `.gitignore` and adds files we don't want. Write `package.json` first, then add dependencies:

```json
{
  "name": "remote-agent",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "bridge": "bun run src/bridge/main.ts"
  }
}
```

```bash
cd /home/giganotosaurus/Sites/remote-agent
bun add grammy @grammyjs/auto-retry zod@3
bun add -d typescript @types/bun
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["bun"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src", "test", "mod/remote-agent/hooks"],
  "exclude": ["mod/remote-agent/hooks/register.ts"]
}
```

(`register.ts` imports the engine's `claude-code` types, which only exist once the mod is loaded. Task 13 type-checks it separately.)

- [ ] **Step 2: Write the failing tests**

`test/core/text.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { escapeHtml, REDACTED, redactSecrets, truncate } from '../../src/core/text.ts'

describe('truncate', () => {
  test('returns short text unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })
  test('cuts long text and says how much was dropped', () => {
    expect(truncate('abcdefghij', 4)).toBe('abcd… [+6 chars]')
  })
})

describe('redactSecrets', () => {
  test('redacts KEY=value assignments with secret-looking names', () => {
    expect(redactSecrets('API_KEY=abc123 other=fine')).toBe(`API_KEY=${REDACTED} other=fine`)
    expect(redactSecrets('export GITHUB_TOKEN="ghp_abc"')).toBe(`export GITHUB_TOKEN="${REDACTED}"`)
    expect(redactSecrets('password: hunter2')).toBe(`password: ${REDACTED}`)
  })
  test('redacts well-known token formats anywhere', () => {
    const anthropic = 'sk-ant-api03-' + 'a'.repeat(40)
    const aws = 'AKIA' + 'B'.repeat(16)
    const telegram = '123456789:' + 'C'.repeat(35)
    const out = redactSecrets(`curl -H "x-api-key: ${anthropic}" ${aws} ${telegram}`)
    expect(out).not.toContain(anthropic)
    expect(out).not.toContain(aws)
    expect(out).not.toContain(telegram)
  })
  test('redacts PEM private keys', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----'
    expect(redactSecrets(`key:\n${pem}\nend`)).toBe(`key:\n${REDACTED}\nend`)
  })
  test('leaves ordinary code alone', () => {
    expect(redactSecrets('const total = items.length')).toBe('const total = items.length')
  })
})

describe('escapeHtml', () => {
  test('escapes the three characters Telegram HTML requires', () => {
    expect(escapeHtml('a < b && c > d')).toBe('a &lt; b &amp;&amp; c &gt; d')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test test/core/text.test.ts`
Expected: FAIL, "Cannot find module '../../src/core/text.ts'"

- [ ] **Step 4: Implement**

`src/core/text.ts`:

```ts
export const REDACTED = '[REDACTED]'

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-ant-[A-Za-z0-9_-]{10,}/g,
  /\bsk-[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g,
]

const SECRET_ASSIGNMENT =
  /\b([A-Za-z0-9_]*(?:secret|token|password|passwd|api_key|apikey|private_key|access_key)[A-Za-z0-9_]*)(\s*[=:]\s*)(["']?)([^\s"']+)\3/gi

export function redactSecrets(text: string): string {
  let out = text.replace(
    SECRET_ASSIGNMENT,
    (_match, name: string, separator: string, quote: string) => `${name}${separator}${quote}${REDACTED}${quote}`,
  )
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTED)
  }
  return out
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text
  }
  return `${text.slice(0, max)}… [+${text.length - max} chars]`
}

export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test test/core/text.test.ts && bun run typecheck`
Expected: all PASS, no type errors

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock tsconfig.json src/core test/core
git commit -m "feat: scaffold bun project with redaction and text utilities"
```

---

### Task 3: Wire protocol and Bridge config

**Files:**
- Create: `mod/remote-agent/hooks/protocol.ts`, `src/bridge/config.ts`
- Test: `test/mod/protocol.test.ts`, `test/bridge/config.test.ts`

**Interfaces:**
- Produces (protocol.ts, used by every later task): `BRIDGE_ORIGIN`, `MAX_WAIT_MS`, `SessionInfo`, `QuestionOption`, `QuestionItem`, `QuestionBody`, `PermissionBody`, `PromptBody`, `CreatePromptRequest`, `QuestionAnswer`, `PermissionAnswer`, `Answer`, `AnswerSource`, `AnswerState`, `AnswerResult`, `Report`, `ReportRequest`, `Instruction`, `defaultSocketPath(env)`, `projectName(cwd)`
- Produces (config.ts): `type Config = { botToken: string; chatId: number; allowedUserId: number; socketPath: string; dbPath: string; reminderAfterMs: number }`, `loadConfig(env: Record<string, string | undefined>): Config`

- [ ] **Step 1: Write the failing tests**

`test/mod/protocol.test.ts`:

```ts
import { expect, test } from 'bun:test'
import { defaultSocketPath, projectName } from '../../mod/remote-agent/hooks/protocol.ts'

test('socket lives under XDG_RUNTIME_DIR when set', () => {
  expect(defaultSocketPath({ XDG_RUNTIME_DIR: '/run/user/1000', HOME: '/home/u' })).toBe('/run/user/1000/remote-agent/bridge.sock')
})

test('socket falls back to HOME state dir', () => {
  expect(defaultSocketPath({ HOME: '/home/u' })).toBe('/home/u/.local/state/remote-agent/bridge.sock')
})

test('socket path needs XDG_RUNTIME_DIR or HOME', () => {
  expect(() => defaultSocketPath({})).toThrow('XDG_RUNTIME_DIR')
})

test('project name is the last path segment', () => {
  expect(projectName('/home/u/Sites/remote-agent')).toBe('remote-agent')
  expect(projectName('/home/u/Sites/remote-agent/')).toBe('remote-agent')
  expect(projectName('/')).toBe('/')
})
```

`test/bridge/config.test.ts`:

```ts
import { expect, test } from 'bun:test'
import { loadConfig } from '../../src/bridge/config.ts'

const base = {
  TELEGRAM_BOT_TOKEN: '123456:ABC-def_ghi',
  TELEGRAM_CHAT_ID: '-1001234567890',
  TELEGRAM_ALLOWED_USER_ID: '42',
  HOME: '/home/u',
  XDG_RUNTIME_DIR: '/run/user/1000',
}

test('loads a valid environment with defaults', () => {
  expect(loadConfig(base)).toEqual({
    botToken: '123456:ABC-def_ghi',
    chatId: -1001234567890,
    allowedUserId: 42,
    socketPath: '/run/user/1000/remote-agent/bridge.sock',
    dbPath: '/home/u/.local/state/remote-agent/bridge.db',
    reminderAfterMs: 30 * 60_000,
  })
})

test('honours explicit overrides', () => {
  const config = loadConfig({ ...base, REMOTE_AGENT_SOCKET: '/tmp/b.sock', REMOTE_AGENT_DB: '/tmp/b.db', REMOTE_AGENT_REMINDER_MINUTES: '5' })
  expect(config.socketPath).toBe('/tmp/b.sock')
  expect(config.dbPath).toBe('/tmp/b.db')
  expect(config.reminderAfterMs).toBe(5 * 60_000)
})

test('names the missing variable', () => {
  expect(() => loadConfig({ ...base, TELEGRAM_BOT_TOKEN: undefined })).toThrow('TELEGRAM_BOT_TOKEN')
})

test('rejects a non-supergroup chat id', () => {
  expect(() => loadConfig({ ...base, TELEGRAM_CHAT_ID: '42' })).toThrow('TELEGRAM_CHAT_ID')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/mod/protocol.test.ts test/bridge/config.test.ts`
Expected: FAIL, modules not found

- [ ] **Step 3: Implement**

`mod/remote-agent/hooks/protocol.ts`:

```ts
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

export type Instruction = { id: string; sessionId: string; text: string }

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
```

`src/bridge/config.ts`:

```ts
import { z } from 'zod'
import { defaultSocketPath } from '../../mod/remote-agent/hooks/protocol.ts'

export type Config = {
  botToken: string
  chatId: number
  allowedUserId: number
  socketPath: string
  dbPath: string
  reminderAfterMs: number
}

const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string({ required_error: 'TELEGRAM_BOT_TOKEN is required' }).regex(/^\d+:[A-Za-z0-9_-]+$/, 'TELEGRAM_BOT_TOKEN must look like 123456:ABC...'),
  TELEGRAM_CHAT_ID: z.coerce.number({ required_error: 'TELEGRAM_CHAT_ID is required' }).int().negative('TELEGRAM_CHAT_ID must be a supergroup id (negative, -100...)'),
  TELEGRAM_ALLOWED_USER_ID: z.coerce.number({ required_error: 'TELEGRAM_ALLOWED_USER_ID is required' }).int().positive(),
  REMOTE_AGENT_SOCKET: z.string().optional(),
  REMOTE_AGENT_DB: z.string().optional(),
  REMOTE_AGENT_REMINDER_MINUTES: z.coerce.number().positive().default(30),
  XDG_RUNTIME_DIR: z.string().optional(),
  HOME: z.string({ required_error: 'HOME is required' }),
})

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    const problems = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    throw new Error(`Invalid configuration: ${problems}`)
  }
  const values = parsed.data
  return {
    botToken: values.TELEGRAM_BOT_TOKEN,
    chatId: values.TELEGRAM_CHAT_ID,
    allowedUserId: values.TELEGRAM_ALLOWED_USER_ID,
    socketPath: values.REMOTE_AGENT_SOCKET ?? defaultSocketPath(values),
    dbPath: values.REMOTE_AGENT_DB ?? `${values.HOME}/.local/state/remote-agent/bridge.db`,
    reminderAfterMs: values.REMOTE_AGENT_REMINDER_MINUTES * 60_000,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test test/mod/protocol.test.ts test/bridge/config.test.ts && bun run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mod/remote-agent/hooks/protocol.ts src/bridge/config.ts test/mod test/bridge
git commit -m "feat: add shared wire protocol and bridge configuration"
```

---

### Task 4: SQLite store

**Files:**
- Create: `src/bridge/store.ts`
- Test: `test/bridge/store.test.ts`

**Interfaces:**
- Consumes: protocol types, `projectName` (Task 3)
- Produces:
  - `type SessionRow = { id: string; cwd: string; project: string; threadId: string | null; endedAt: number | null }`
  - `type PromptRow = { id: string; sessionId: string; body: PromptBody; status: 'pending' | 'answered'; answer: Answer | null; source: AnswerSource | null; partial: Record<string, string>; createdAt: number; reminded: boolean }`
  - `type PromptMessageLink = { promptId: string; questionIndex: number }`
  - `class Store(path: string, now?: () => number)` with `close()`, `upsertSession(info): SessionRow`, `getSession(id)`, `findSessionByThread(threadId)`, `listActiveSessions(): SessionRow[]`, `setSessionThread(id, threadId: string | null)`, `endSession(id)`, `insertPrompt(id, sessionId, body): boolean`, `getPrompt(id): PromptRow | undefined`, `resolvePrompt(id, answer, source): boolean`, `setPartial(id, partial)`, `listPendingPrompts(): PromptRow[]`, `listStalePrompts(cutoff: number): PromptRow[]`, `markReminded(id)`, `addPromptMessage(promptId, messageRef, questionIndex)`, `findPromptMessage(messageRef): PromptMessageLink | undefined`, `listPromptMessageRefs(promptId): string[]`, `enqueueInstruction(sessionId, text): Instruction`, `getInstruction(id): Instruction | undefined`, `listPendingInstructions(sessionId): Instruction[]`, `markInstructionDelivered(id): boolean`

- [ ] **Step 1: Write the failing tests**

`test/bridge/store.test.ts`:

```ts
import { beforeEach, expect, test } from 'bun:test'
import type { PromptBody } from '../../mod/remote-agent/hooks/protocol.ts'
import { Store } from '../../src/bridge/store.ts'

let clock = 1_000
let store: Store
const permission: PromptBody = { kind: 'permission', tool: 'Bash', input: { command: 'ls' } }

beforeEach(() => {
  clock = 1_000
  store = new Store(':memory:', () => clock)
  store.upsertSession({ sessionId: 's1', cwd: '/home/u/Sites/app' })
})

test('upsertSession derives the project and reopens ended sessions', () => {
  store.endSession('s1')
  expect(store.getSession('s1')?.endedAt).toBe(1_000)
  const reopened = store.upsertSession({ sessionId: 's1', cwd: '/home/u/Sites/app' })
  expect(reopened).toEqual({ id: 's1', cwd: '/home/u/Sites/app', project: 'app', threadId: null, endedAt: null })
})

test('threads are stored and looked up', () => {
  store.setSessionThread('s1', 't9')
  expect(store.findSessionByThread('t9')?.id).toBe('s1')
  expect(store.listActiveSessions().map(session => session.id)).toEqual(['s1'])
})

test('insertPrompt is idempotent', () => {
  expect(store.insertPrompt('p1', 's1', permission)).toBe(true)
  expect(store.insertPrompt('p1', 's1', permission)).toBe(false)
  expect(store.getPrompt('p1')).toMatchObject({ id: 'p1', sessionId: 's1', body: permission, status: 'pending', answer: null, partial: {}, reminded: false })
})

test('resolvePrompt lets only the first answer win', () => {
  store.insertPrompt('p1', 's1', permission)
  expect(store.resolvePrompt('p1', { kind: 'permission', decision: 'allow' }, 'local')).toBe(true)
  expect(store.resolvePrompt('p1', { kind: 'permission', decision: 'deny' }, 'remote')).toBe(false)
  expect(store.getPrompt('p1')).toMatchObject({ status: 'answered', answer: { decision: 'allow' }, source: 'local' })
})

test('partial answers round-trip', () => {
  store.insertPrompt('p1', 's1', permission)
  store.setPartial('p1', { 'Q1?': 'A' })
  expect(store.getPrompt('p1')?.partial).toEqual({ 'Q1?': 'A' })
})

test('stale prompts are pending, unreminded and old enough', () => {
  store.insertPrompt('old', 's1', permission)
  clock = 5_000
  store.insertPrompt('new', 's1', permission)
  expect(store.listStalePrompts(2_000).map(prompt => prompt.id)).toEqual(['old'])
  store.markReminded('old')
  expect(store.listStalePrompts(2_000)).toEqual([])
  expect(store.listPendingPrompts().map(prompt => prompt.id)).toEqual(['old', 'new'])
})

test('prompt messages link back to prompt and question', () => {
  store.insertPrompt('p1', 's1', permission)
  store.addPromptMessage('p1', 'm2', 1)
  store.addPromptMessage('p1', 'm1', 0)
  expect(store.findPromptMessage('m2')).toEqual({ promptId: 'p1', questionIndex: 1 })
  expect(store.findPromptMessage('nope')).toBeUndefined()
  expect(store.listPromptMessageRefs('p1')).toEqual(['m1', 'm2'])
})

test('instructions are delivered exactly once', () => {
  const instruction = store.enqueueInstruction('s1', 'add tests')
  expect(store.listPendingInstructions('s1')).toEqual([instruction])
  expect(store.getInstruction(instruction.id)).toEqual(instruction)
  expect(store.markInstructionDelivered(instruction.id)).toBe(true)
  expect(store.markInstructionDelivered(instruction.id)).toBe(false)
  expect(store.listPendingInstructions('s1')).toEqual([])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/bridge/store.test.ts`
Expected: FAIL, module not found

- [ ] **Step 3: Implement**

`src/bridge/store.ts`:

```ts
import { Database } from 'bun:sqlite'
import { projectName, type Answer, type AnswerSource, type Instruction, type PromptBody, type SessionInfo } from '../../mod/remote-agent/hooks/protocol.ts'

export type SessionRow = { id: string; cwd: string; project: string; threadId: string | null; endedAt: number | null }

export type PromptRow = {
  id: string
  sessionId: string
  body: PromptBody
  status: 'pending' | 'answered'
  answer: Answer | null
  source: AnswerSource | null
  partial: Record<string, string>
  createdAt: number
  reminded: boolean
}

export type PromptMessageLink = { promptId: string; questionIndex: number }

type SessionRecord = { id: string; cwd: string; project: string; thread_id: string | null; ended_at: number | null }
type PromptRecord = {
  id: string
  session_id: string
  body: string
  status: 'pending' | 'answered'
  answer: string | null
  source: AnswerSource | null
  partial: string
  created_at: number
  reminded: number
}
type InstructionRecord = { id: string; session_id: string; text: string }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, cwd TEXT NOT NULL, project TEXT NOT NULL, thread_id TEXT,
  created_at INTEGER NOT NULL, ended_at INTEGER
);
CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', answer TEXT, source TEXT, partial TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL, answered_at INTEGER, reminded INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS prompt_messages (
  message_ref TEXT PRIMARY KEY, prompt_id TEXT NOT NULL REFERENCES prompts(id), question_index INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS instructions (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, delivered_at INTEGER
);
`

const SESSION_COLUMNS = 'id, cwd, project, thread_id, ended_at'
const PROMPT_COLUMNS = 'id, session_id, body, status, answer, source, partial, created_at, reminded'

function toSession(record: SessionRecord): SessionRow {
  return { id: record.id, cwd: record.cwd, project: record.project, threadId: record.thread_id, endedAt: record.ended_at }
}

function toPrompt(record: PromptRecord): PromptRow {
  return {
    id: record.id,
    sessionId: record.session_id,
    body: JSON.parse(record.body) as PromptBody,
    status: record.status,
    answer: record.answer === null ? null : (JSON.parse(record.answer) as Answer),
    source: record.source,
    partial: JSON.parse(record.partial) as Record<string, string>,
    createdAt: record.created_at,
    reminded: record.reminded === 1,
  }
}

function toInstruction(record: InstructionRecord): Instruction {
  return { id: record.id, sessionId: record.session_id, text: record.text }
}

export class Store {
  private readonly db: Database

  constructor(path: string, private readonly now: () => number = Date.now) {
    this.db = new Database(path, { create: true, strict: true })
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec('PRAGMA foreign_keys = ON;')
    this.db.exec(SCHEMA)
  }

  close(): void {
    this.db.close()
  }

  upsertSession(info: SessionInfo): SessionRow {
    this.db
      .query(
        `INSERT INTO sessions (id, cwd, project, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET cwd = excluded.cwd, project = excluded.project, ended_at = NULL`,
      )
      .run(info.sessionId, info.cwd, projectName(info.cwd), this.now())
    const session = this.getSession(info.sessionId)
    if (session === undefined) {
      throw new Error(`Session ${info.sessionId} vanished after upsert`)
    }
    return session
  }

  getSession(id: string): SessionRow | undefined {
    const record = this.db.query<SessionRecord, [string]>(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`).get(id)
    return record === null ? undefined : toSession(record)
  }

  findSessionByThread(threadId: string): SessionRow | undefined {
    const record = this.db.query<SessionRecord, [string]>(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE thread_id = ?`).get(threadId)
    return record === null ? undefined : toSession(record)
  }

  listActiveSessions(): SessionRow[] {
    return this.db
      .query<SessionRecord, []>(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE ended_at IS NULL ORDER BY created_at`)
      .all()
      .map(toSession)
  }

  setSessionThread(id: string, threadId: string | null): void {
    this.db.query('UPDATE sessions SET thread_id = ? WHERE id = ?').run(threadId, id)
  }

  endSession(id: string): void {
    this.db.query('UPDATE sessions SET ended_at = ? WHERE id = ?').run(this.now(), id)
  }

  insertPrompt(id: string, sessionId: string, body: PromptBody): boolean {
    const result = this.db
      .query('INSERT OR IGNORE INTO prompts (id, session_id, body, created_at) VALUES (?, ?, ?, ?)')
      .run(id, sessionId, JSON.stringify(body), this.now())
    return result.changes === 1
  }

  getPrompt(id: string): PromptRow | undefined {
    const record = this.db.query<PromptRecord, [string]>(`SELECT ${PROMPT_COLUMNS} FROM prompts WHERE id = ?`).get(id)
    return record === null ? undefined : toPrompt(record)
  }

  resolvePrompt(id: string, answer: Answer, source: AnswerSource): boolean {
    const result = this.db
      .query(`UPDATE prompts SET status = 'answered', answer = ?, source = ?, answered_at = ? WHERE id = ? AND status = 'pending'`)
      .run(JSON.stringify(answer), source, this.now(), id)
    return result.changes === 1
  }

  setPartial(id: string, partial: Record<string, string>): void {
    this.db.query('UPDATE prompts SET partial = ? WHERE id = ?').run(JSON.stringify(partial), id)
  }

  listPendingPrompts(): PromptRow[] {
    return this.db
      .query<PromptRecord, []>(`SELECT ${PROMPT_COLUMNS} FROM prompts WHERE status = 'pending' ORDER BY created_at`)
      .all()
      .map(toPrompt)
  }

  listStalePrompts(cutoff: number): PromptRow[] {
    return this.db
      .query<PromptRecord, [number]>(
        `SELECT ${PROMPT_COLUMNS} FROM prompts WHERE status = 'pending' AND reminded = 0 AND created_at <= ? ORDER BY created_at`,
      )
      .all(cutoff)
      .map(toPrompt)
  }

  markReminded(id: string): void {
    this.db.query('UPDATE prompts SET reminded = 1 WHERE id = ?').run(id)
  }

  addPromptMessage(promptId: string, messageRef: string, questionIndex: number): void {
    this.db
      .query('INSERT OR REPLACE INTO prompt_messages (message_ref, prompt_id, question_index) VALUES (?, ?, ?)')
      .run(messageRef, promptId, questionIndex)
  }

  findPromptMessage(messageRef: string): PromptMessageLink | undefined {
    const record = this.db
      .query<{ prompt_id: string; question_index: number }, [string]>('SELECT prompt_id, question_index FROM prompt_messages WHERE message_ref = ?')
      .get(messageRef)
    return record === null ? undefined : { promptId: record.prompt_id, questionIndex: record.question_index }
  }

  listPromptMessageRefs(promptId: string): string[] {
    return this.db
      .query<{ message_ref: string }, [string]>('SELECT message_ref FROM prompt_messages WHERE prompt_id = ? ORDER BY question_index')
      .all(promptId)
      .map(record => record.message_ref)
  }

  enqueueInstruction(sessionId: string, text: string): Instruction {
    const id = crypto.randomUUID()
    this.db.query('INSERT INTO instructions (id, session_id, text, created_at) VALUES (?, ?, ?, ?)').run(id, sessionId, text, this.now())
    return { id, sessionId, text }
  }

  getInstruction(id: string): Instruction | undefined {
    const record = this.db.query<InstructionRecord, [string]>('SELECT id, session_id, text FROM instructions WHERE id = ?').get(id)
    return record === null ? undefined : toInstruction(record)
  }

  listPendingInstructions(sessionId: string): Instruction[] {
    return this.db
      .query<InstructionRecord, [string]>(`SELECT id, session_id, text FROM instructions WHERE session_id = ? AND status = 'pending' ORDER BY created_at`)
      .all(sessionId)
      .map(toInstruction)
  }

  markInstructionDelivered(id: string): boolean {
    const result = this.db
      .query(`UPDATE instructions SET status = 'delivered', delivered_at = ? WHERE id = ? AND status = 'pending'`)
      .run(this.now(), id)
    return result.changes === 1
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test test/bridge/store.test.ts && bun run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bridge/store.ts test/bridge/store.test.ts
git commit -m "feat: persist sessions, prompts and instructions in sqlite"
```

---

### Task 5: Channel contract, views and fake channel

**Files:**
- Create: `src/channel/types.ts`, `src/bridge/views.ts`, `test/support/fake-channel.ts`
- Test: `test/bridge/views.test.ts`

**Interfaces:**
- Consumes: `SessionRow`, `PromptRow` (Task 4); `truncate`, `redactSecrets` (Task 2)
- Produces (types.ts): `ThreadRef`, `MessageRef`, `ButtonData = { promptId: string; questionIndex: number; optionIndex: number }`, `PromptViewItem = { text: string; buttons: { label: string; data: ButtonData }[] }`, `PromptView = { promptId: string; title: string; items: PromptViewItem[] }`, `InboundText = { thread: ThreadRef | null; replyTo: MessageRef | null; text: string }`, `InboundCommand = { name: string; thread: ThreadRef | null }`, `interface ChannelHandlers { onButton(press: ButtonData): Promise<string>; onText(message: InboundText): Promise<string | null>; onCommand(command: InboundCommand): Promise<string> }`, `interface Channel { start(handlers); stop(); createThread(title): Promise<ThreadRef>; closeThread(thread): Promise<void>; sendText(thread: ThreadRef | null, text: string, replyTo: MessageRef | null): Promise<MessageRef>; sendPrompt(thread, view): Promise<MessageRef[]>; markResolved(thread, messages: MessageRef[], note: string): Promise<void> }`
- Produces (views.ts): `LIMITS`, `sessionLabel(session)`, `threadTitle(session)`, `promptView(prompt, session): PromptView`, `permissionSummary(tool, input): string`, `reportText(report, session): string`, `resolutionNote(answer, source): string`, `formatDuration(ms): string`
- Produces (fake-channel.ts): `class FakeChannel implements Channel` with public arrays `threads`, `texts`, `prompts`, `resolved`, `handlers`, a `createThreadDelayMs` knob, and `flush(): Promise<void>`

- [ ] **Step 1: Write the channel contract and fake (no behaviour to test yet)**

`src/channel/types.ts`:

```ts
// The Bridge's view of a messaging service. No Telegram types may appear here.

export type ThreadRef = string
export type MessageRef = string

export type ButtonData = { promptId: string; questionIndex: number; optionIndex: number }
export type PromptViewItem = { text: string; buttons: { label: string; data: ButtonData }[] }
export type PromptView = { promptId: string; title: string; items: PromptViewItem[] }

export type InboundText = { thread: ThreadRef | null; replyTo: MessageRef | null; text: string }
export type InboundCommand = { name: string; thread: ThreadRef | null }

export interface ChannelHandlers {
  /** Returns the short toast shown to the user. */
  onButton(press: ButtonData): Promise<string>
  /** Returns a reply to post, or null for none. */
  onText(message: InboundText): Promise<string | null>
  onCommand(command: InboundCommand): Promise<string>
}

export interface Channel {
  start(handlers: ChannelHandlers): Promise<void>
  stop(): Promise<void>
  createThread(title: string): Promise<ThreadRef>
  closeThread(thread: ThreadRef): Promise<void>
  sendText(thread: ThreadRef | null, text: string, replyTo: MessageRef | null): Promise<MessageRef>
  /** Sends one message per view item, in order. */
  sendPrompt(thread: ThreadRef, view: PromptView): Promise<MessageRef[]>
  /** Removes buttons from the Prompt messages and posts the note. */
  markResolved(thread: ThreadRef, messages: MessageRef[], note: string): Promise<void>
}
```

`test/support/fake-channel.ts`:

```ts
import type { Channel, ChannelHandlers, MessageRef, PromptView, ThreadRef } from '../../src/channel/types.ts'

export class FakeChannel implements Channel {
  threads: { ref: ThreadRef; title: string; closed: boolean }[] = []
  texts: { thread: ThreadRef | null; text: string; replyTo: MessageRef | null }[] = []
  prompts: { thread: ThreadRef; view: PromptView; refs: MessageRef[] }[] = []
  resolved: { thread: ThreadRef; messages: MessageRef[]; note: string }[] = []
  handlers: ChannelHandlers | null = null
  createThreadDelayMs = 0
  private nextId = 1

  async start(handlers: ChannelHandlers): Promise<void> {
    this.handlers = handlers
  }

  async stop(): Promise<void> {}

  async createThread(title: string): Promise<ThreadRef> {
    if (this.createThreadDelayMs > 0) {
      await Bun.sleep(this.createThreadDelayMs)
    }
    const ref = `t${this.nextId++}`
    this.threads.push({ ref, title, closed: false })
    return ref
  }

  async closeThread(thread: ThreadRef): Promise<void> {
    const found = this.threads.find(item => item.ref === thread)
    if (found !== undefined) {
      found.closed = true
    }
  }

  async sendText(thread: ThreadRef | null, text: string, replyTo: MessageRef | null): Promise<MessageRef> {
    this.texts.push({ thread, text, replyTo })
    return `m${this.nextId++}`
  }

  async sendPrompt(thread: ThreadRef, view: PromptView): Promise<MessageRef[]> {
    const refs = view.items.map(() => `m${this.nextId++}`)
    this.prompts.push({ thread, view, refs })
    return refs
  }

  async markResolved(thread: ThreadRef, messages: MessageRef[], note: string): Promise<void> {
    this.resolved.push({ thread, messages, note })
  }
}

/** Lets fire-and-forget promise chains settle. */
export function flush(): Promise<void> {
  return Bun.sleep(10)
}
```

- [ ] **Step 2: Write the failing view tests**

`test/bridge/views.test.ts`:

```ts
import { expect, test } from 'bun:test'
import type { PromptRow, SessionRow } from '../../src/bridge/store.ts'
import { formatDuration, permissionSummary, promptView, reportText, resolutionNote, threadTitle } from '../../src/bridge/views.ts'

const session: SessionRow = { id: 'abcdef1234567890', cwd: '/home/u/app', project: 'app', threadId: null, endedAt: null }

function prompt(body: PromptRow['body']): PromptRow {
  return { id: 'q:toolu_1', sessionId: session.id, body, status: 'pending', answer: null, source: null, partial: {}, createdAt: 0, reminded: false }
}

test('thread title is project plus short session id', () => {
  expect(threadTitle(session)).toBe('app · abcdef12')
})

test('permission view has Allow and Deny buttons and a redacted summary', () => {
  const view = promptView(prompt({ kind: 'permission', tool: 'Bash', input: { command: 'curl -H "Authorization: x" API_KEY=s3cret' } }), session)
  expect(view.title).toBe('app · abcdef12')
  expect(view.items).toHaveLength(1)
  const item = view.items[0]!
  expect(item.text).toContain('🔐 Permission: Bash')
  expect(item.text).toContain('API_KEY=[REDACTED]')
  expect(item.text).not.toContain('s3cret')
  expect(item.buttons.map(button => button.label)).toEqual(['✅ Allow', '❌ Deny'])
  expect(item.buttons[1]!.data).toEqual({ promptId: 'q:toolu_1', questionIndex: 0, optionIndex: 1 })
})

test('question view: buttons for single-select, reply hint for multi-select', () => {
  const view = promptView(
    prompt({
      kind: 'question',
      questions: [
        { question: 'Which DB?', header: 'Storage', multiSelect: false, options: [{ label: 'SQLite', description: 'embedded' }, { label: 'Postgres', description: '' }] },
        { question: 'Which extras?', header: 'Extras', multiSelect: true, options: [{ label: 'Docs', description: '' }, { label: 'Tests', description: '' }] },
      ],
    }),
    session,
  )
  expect(view.items).toHaveLength(2)
  expect(view.items[0]!.text).toContain('1. SQLite — embedded')
  expect(view.items[0]!.buttons.map(button => button.data)).toEqual([
    { promptId: 'q:toolu_1', questionIndex: 0, optionIndex: 0 },
    { promptId: 'q:toolu_1', questionIndex: 0, optionIndex: 1 },
  ])
  expect(view.items[1]!.buttons).toEqual([])
  expect(view.items[1]!.text).toContain('Reply to this message with option numbers')
})

test('permission summary picks the meaningful field per tool', () => {
  expect(permissionSummary('Bash', { command: 'ls -la' })).toBe('$ ls -la')
  expect(permissionSummary('Write', { file_path: '/a.ts', content: 'x' })).toBe('/a.ts\nx')
  expect(permissionSummary('Edit', { file_path: '/a.ts', old_string: 'a', new_string: 'b' })).toBe('/a.ts\n--- old\na\n+++ new\nb')
  expect(permissionSummary('WebFetch', { url: 'https://x.dev' })).toBe('https://x.dev')
  expect(permissionSummary('mcp__x__y', { a: 1 })).toBe('{\n  "a": 1\n}')
})

test('permission summary truncates huge input', () => {
  expect(permissionSummary('Bash', { command: 'x'.repeat(10_000) }).length).toBeLessThan(1_600)
})

test('report texts', () => {
  expect(reportText({ kind: 'session_started' }, session)).toBe('🟢 Session started in /home/u/app')
  expect(reportText({ kind: 'session_ended', reason: 'exit' }, session)).toBe('⚪ Session ended (exit)')
  expect(reportText({ kind: 'turn_complete', text: 'Done.', durationMs: 75_000, isAborted: false }, session)).toBe('✅ Turn finished after 1m 15s\n\nDone.')
  expect(reportText({ kind: 'turn_complete', text: '', durationMs: 5_000, isAborted: true }, session)).toBe('⛔ Turn interrupted after 5s')
})

test('resolution notes', () => {
  expect(resolutionNote({ kind: 'permission', decision: 'allow' }, 'local')).toBe('✅ Allowed (local)')
  expect(resolutionNote({ kind: 'permission', decision: 'deny', message: 'use pnpm' }, 'remote')).toBe('❌ Denied (remote): use pnpm')
  expect(resolutionNote({ kind: 'question', answers: { 'A?': 'x', 'B?': 'y' } }, 'remote')).toBe('✅ Answered (remote): x / y')
  expect(resolutionNote({ kind: 'question', answers: {} }, 'local')).toBe('🚫 Dismissed (local)')
})

test('durations', () => {
  expect(formatDuration(999)).toBe('0s')
  expect(formatDuration(59_000)).toBe('59s')
  expect(formatDuration(3_725_000)).toBe('62m 5s')
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test test/bridge/views.test.ts`
Expected: FAIL, module not found

- [ ] **Step 4: Implement**

`src/bridge/views.ts`:

```ts
import type { Answer, AnswerSource, QuestionItem, Report } from '../../mod/remote-agent/hooks/protocol.ts'
import type { PromptView, PromptViewItem } from '../channel/types.ts'
import { redactSecrets, truncate } from '../core/text.ts'
import type { PromptRow, SessionRow } from './store.ts'

export const LIMITS = { question: 1_500, toolInput: 1_500, report: 1_000, note: 300, reason: 300 }

function clean(text: string, max: number): string {
  return truncate(redactSecrets(text), max)
}

function field(input: unknown, key: string): string | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined
  }
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

export function sessionLabel(session: SessionRow): string {
  return `${session.project} · ${session.id.slice(0, 8)}`
}

export function threadTitle(session: SessionRow): string {
  return sessionLabel(session).slice(0, 128)
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1_000)
  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`
}

export function permissionSummary(tool: string, input: unknown): string {
  const command = field(input, 'command')
  const filePath = field(input, 'file_path')
  const url = field(input, 'url')
  let summary: string
  if (tool === 'Bash' && command !== undefined) {
    summary = `$ ${command}`
  } else if (tool === 'Edit' && filePath !== undefined) {
    summary = `${filePath}\n--- old\n${field(input, 'old_string') ?? ''}\n+++ new\n${field(input, 'new_string') ?? ''}`
  } else if (tool === 'Write' && filePath !== undefined) {
    summary = `${filePath}\n${field(input, 'content') ?? ''}`
  } else if (url !== undefined) {
    summary = url
  } else if (filePath !== undefined) {
    summary = filePath
  } else {
    summary = JSON.stringify(input, null, 2) ?? String(input)
  }
  return clean(summary, LIMITS.toolInput)
}

function questionItem(promptId: string, question: QuestionItem, questionIndex: number): PromptViewItem {
  const options = question.options
    .map((option, index) => `${index + 1}. ${option.label}${option.description === '' ? '' : ` — ${option.description}`}`)
    .join('\n')
  const hint = question.multiSelect
    ? 'Reply to this message with option numbers, e.g. 1,3'
    : 'Tap an option, or reply to this message with your own answer.'
  return {
    text: `${clean(`❓ ${question.header}\n${question.question}\n\n${options}`, LIMITS.question)}\n\n${hint}`,
    buttons: question.multiSelect
      ? []
      : question.options.map((option, optionIndex) => ({ label: option.label, data: { promptId, questionIndex, optionIndex } })),
  }
}

export function promptView(prompt: PromptRow, session: SessionRow): PromptView {
  const title = sessionLabel(session)
  const body = prompt.body
  if (body.kind === 'question') {
    return { promptId: prompt.id, title, items: body.questions.map((question, index) => questionItem(prompt.id, question, index)) }
  }
  const who = body.agentId === undefined ? '' : ' (subagent)'
  const reason = body.reason === undefined ? '' : `\nWhy: ${clean(body.reason, LIMITS.reason)}`
  return {
    promptId: prompt.id,
    title,
    items: [
      {
        text: `🔐 Permission: ${body.tool}${who}${reason}\n\n${permissionSummary(body.tool, body.input)}\n\nReply to this message to deny with feedback.`,
        buttons: [
          { label: '✅ Allow', data: { promptId: prompt.id, questionIndex: 0, optionIndex: 0 } },
          { label: '❌ Deny', data: { promptId: prompt.id, questionIndex: 0, optionIndex: 1 } },
        ],
      },
    ],
  }
}

export function reportText(report: Report, session: SessionRow): string {
  if (report.kind === 'session_started') {
    return `🟢 Session started in ${session.cwd}`
  }
  if (report.kind === 'session_ended') {
    return `⚪ Session ended (${report.reason})`
  }
  const head = `${report.isAborted ? '⛔ Turn interrupted' : '✅ Turn finished'} after ${formatDuration(report.durationMs)}`
  return report.text === '' ? head : `${head}\n\n${clean(report.text, LIMITS.report)}`
}

export function resolutionNote(answer: Answer, source: AnswerSource): string {
  if (answer.kind === 'permission') {
    const head = `${answer.decision === 'allow' ? '✅ Allowed' : '❌ Denied'} (${source})`
    return answer.message === undefined ? head : `${head}: ${clean(answer.message, LIMITS.note)}`
  }
  const values = Object.values(answer.answers)
  if (values.length === 0) {
    return `🚫 Dismissed (${source})`
  }
  return `✅ Answered (${source}): ${clean(values.join(' / '), LIMITS.note)}`
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test test/bridge/views.test.ts && bun run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/channel/types.ts src/bridge/views.ts test/support test/bridge/views.test.ts
git commit -m "feat: define channel contract and render prompts, reports and resolutions"
```

---

### Task 6: PromptService (first Answer wins, long-poll waiters, reminders)

**Files:**
- Create: `src/bridge/errors.ts`, `src/bridge/prompts.ts`
- Test: `test/bridge/prompts.test.ts`

**Interfaces:**
- Consumes: `Store`, `PromptRow` (Task 4); protocol types (Task 3)
- Produces:
  - `class BadRequest extends Error` (errors.ts)
  - `type Log = (message: string, error?: unknown) => void`
  - `interface PromptEvents { promptCreated(prompt: PromptRow): Promise<void>; promptResolved(prompt: PromptRow): Promise<void>; promptReminder(prompt: PromptRow): Promise<void> }`
  - `class PromptService(store: Store, events: PromptEvents, options: { reminderAfterMs: number; now?: () => number; log?: Log })` with `create(request: CreatePromptRequest): AnswerState`, `state(id): AnswerState | undefined`, `waitFor(id, waitMs): Promise<AnswerState | undefined>`, `answer(id, answer, source): AnswerResult | undefined`, `answerQuestionPart(id, questionIndex, value): AnswerResult | undefined`, `remindStale(): Promise<void>`

- [ ] **Step 1: Write the failing tests**

`test/bridge/prompts.test.ts`:

```ts
import { beforeEach, expect, test } from 'bun:test'
import type { CreatePromptRequest } from '../../mod/remote-agent/hooks/protocol.ts'
import { BadRequest } from '../../src/bridge/errors.ts'
import { PromptService, type PromptEvents } from '../../src/bridge/prompts.ts'
import { Store, type PromptRow } from '../../src/bridge/store.ts'
import { flush } from '../support/fake-channel.ts'

class RecordingEvents implements PromptEvents {
  created: string[] = []
  resolved: string[] = []
  reminded: string[] = []
  async promptCreated(prompt: PromptRow) {
    this.created.push(prompt.id)
  }
  async promptResolved(prompt: PromptRow) {
    this.resolved.push(prompt.id)
  }
  async promptReminder(prompt: PromptRow) {
    this.reminded.push(prompt.id)
  }
}

const session = { sessionId: 's1', cwd: '/home/u/app' }
const permission: CreatePromptRequest = { promptId: 'p:1', session, body: { kind: 'permission', tool: 'Bash', input: { command: 'ls' } } }
const twoQuestions: CreatePromptRequest = {
  promptId: 'q:1',
  session,
  body: {
    kind: 'question',
    questions: [
      { question: 'A?', header: 'A', multiSelect: false, options: [{ label: 'a1', description: '' }, { label: 'a2', description: '' }] },
      { question: 'B?', header: 'B', multiSelect: false, options: [{ label: 'b1', description: '' }, { label: 'b2', description: '' }] },
    ],
  },
}

let clock: number
let events: RecordingEvents
let service: PromptService

beforeEach(() => {
  clock = 0
  events = new RecordingEvents()
  const store = new Store(':memory:', () => clock)
  service = new PromptService(store, events, { reminderAfterMs: 30 * 60_000, now: () => clock })
})

test('create is idempotent and announces a prompt once', async () => {
  expect(service.create(permission)).toEqual({ status: 'pending' })
  expect(service.create(permission)).toEqual({ status: 'pending' })
  await flush()
  expect(events.created).toEqual(['p:1'])
})

test('first answer wins', async () => {
  service.create(permission)
  const first = service.answer('p:1', { kind: 'permission', decision: 'allow' }, 'local')
  const second = service.answer('p:1', { kind: 'permission', decision: 'deny' }, 'remote')
  expect(first?.accepted).toBe(true)
  expect(second).toEqual({ accepted: false, state: { status: 'answered', answer: { kind: 'permission', decision: 'allow' }, source: 'local' } })
  await flush()
  expect(events.resolved).toEqual(['p:1'])
})

test('answer of the wrong kind is a bad request', () => {
  service.create(permission)
  expect(() => service.answer('p:1', { kind: 'question', answers: {} }, 'local')).toThrow(BadRequest)
})

test('unknown prompts are undefined', async () => {
  expect(service.answer('nope', { kind: 'permission', decision: 'allow' }, 'local')).toBeUndefined()
  expect(await service.waitFor('nope', 10)).toBeUndefined()
})

test('waitFor resolves as soon as the prompt is answered', async () => {
  service.create(permission)
  const waiting = service.waitFor('p:1', 5_000)
  service.answer('p:1', { kind: 'permission', decision: 'deny' }, 'remote')
  expect(await waiting).toEqual({ status: 'answered', answer: { kind: 'permission', decision: 'deny' }, source: 'remote' })
})

test('waitFor returns pending after the timeout', async () => {
  service.create(permission)
  expect(await service.waitFor('p:1', 20)).toEqual({ status: 'pending' })
})

test('multi-question prompts complete when every question is answered', () => {
  service.create(twoQuestions)
  expect(service.answerQuestionPart('q:1', 0, 'a2')).toEqual({ accepted: true, state: { status: 'pending' } })
  expect(service.answerQuestionPart('q:1', 1, 'b1')).toEqual({
    accepted: true,
    state: { status: 'answered', answer: { kind: 'question', answers: { 'A?': 'a2', 'B?': 'b1' } }, source: 'remote' },
  })
  expect(service.answerQuestionPart('q:1', 0, 'a1')?.accepted).toBe(false)
})

test('answerQuestionPart rejects a bad question index', () => {
  service.create(twoQuestions)
  expect(() => service.answerQuestionPart('q:1', 7, 'x')).toThrow(BadRequest)
})

test('remindStale reminds each old pending prompt once', async () => {
  service.create(permission)
  clock = 31 * 60_000
  await service.remindStale()
  await service.remindStale()
  expect(events.reminded).toEqual(['p:1'])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/bridge/prompts.test.ts`
Expected: FAIL, modules not found

- [ ] **Step 3: Implement**

`src/bridge/errors.ts`:

```ts
/** A caller sent something structurally valid but semantically wrong. Mapped to HTTP 400. */
export class BadRequest extends Error {}
```

`src/bridge/prompts.ts`:

```ts
import type { Answer, AnswerResult, AnswerSource, AnswerState, CreatePromptRequest } from '../../mod/remote-agent/hooks/protocol.ts'
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
    const isComplete = prompt.body.questions.every(item => item.question in partial)
    if (isComplete) {
      return this.answer(id, { kind: 'question', answers: partial }, 'remote')
    }
    this.store.setPartial(id, partial)
    return { accepted: true, state: { status: 'pending' } }
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test test/bridge/prompts.test.ts && bun run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bridge/errors.ts src/bridge/prompts.ts test/bridge/prompts.test.ts
git commit -m "feat: add prompt service with first-answer-wins and long-poll waiters"
```

---

### Task 7: Notifier and Away mode

**Files:**
- Create: `src/bridge/notifier.ts`
- Test: `test/bridge/notifier.test.ts`

**Interfaces:**
- Consumes: `Store` (Task 4), `Channel`/`FakeChannel`, views (Task 5), `PromptEvents` (Task 6)
- Produces: `class AwayMode(initial: boolean)` with `isAway(): boolean` and `set(on: boolean): void`. `class Notifier(store, channel, away: AwayMode) implements PromptEvents` with a public readonly `away`, plus `ensureThread(sessionId): Promise<ThreadRef>`, `report(request: ReportRequest): Promise<void>` and `instructionDelivered(instruction: Instruction): Promise<void>`

- [ ] **Step 1: Write the failing tests**

`test/bridge/notifier.test.ts`:

```ts
import { beforeEach, expect, test } from 'bun:test'
import type { PromptBody } from '../../mod/remote-agent/hooks/protocol.ts'
import { AwayMode, Notifier } from '../../src/bridge/notifier.ts'
import { Store } from '../../src/bridge/store.ts'
import { FakeChannel } from '../support/fake-channel.ts'

const session = { sessionId: 'abcdef1234', cwd: '/home/u/app' }
const permission: PromptBody = { kind: 'permission', tool: 'Bash', input: { command: 'ls' } }

let store: Store
let channel: FakeChannel
let notifier: Notifier

beforeEach(() => {
  store = new Store(':memory:')
  channel = new FakeChannel()
  notifier = new Notifier(store, channel, new AwayMode(true))
  store.upsertSession(session)
})

function addPrompt(id: string) {
  store.insertPrompt(id, session.sessionId, permission)
  return store.getPrompt(id)!
}

test('creates one thread for concurrent prompts', async () => {
  channel.createThreadDelayMs = 20
  await Promise.all([notifier.promptCreated(addPrompt('p:1')), notifier.promptCreated(addPrompt('p:2'))])
  expect(channel.threads).toEqual([{ ref: 't1', title: 'app · abcdef12', closed: false }])
  expect(channel.prompts.map(sent => sent.thread)).toEqual(['t1', 't1'])
  expect(store.getSession(session.sessionId)?.threadId).toBe('t1')
  expect(store.findPromptMessage(channel.prompts[0]!.refs[0]!)).toEqual({ promptId: 'p:1', questionIndex: 0 })
})

test('promptResolved removes buttons once and posts the note', async () => {
  await notifier.promptCreated(addPrompt('p:1'))
  store.resolvePrompt('p:1', { kind: 'permission', decision: 'allow' }, 'local')
  await notifier.promptResolved(store.getPrompt('p:1')!)
  await notifier.promptResolved(store.getPrompt('p:1')!)
  expect(channel.resolved).toEqual([{ thread: 't1', messages: channel.prompts[0]!.refs, note: '✅ Allowed (local)' }])
})

test('a prompt answered before its message was sent is marked resolved right after sending', async () => {
  const prompt = addPrompt('p:1')
  store.resolvePrompt('p:1', { kind: 'permission', decision: 'deny' }, 'local')
  await notifier.promptResolved(store.getPrompt('p:1')!)
  await notifier.promptCreated(prompt)
  expect(channel.resolved).toHaveLength(1)
  expect(channel.resolved[0]!.note).toBe('❌ Denied (local)')
})

test('reminder replies to the prompt message', async () => {
  await notifier.promptCreated(addPrompt('p:1'))
  await notifier.promptReminder(store.getPrompt('p:1')!)
  expect(channel.texts.at(-1)).toEqual({ thread: 't1', text: '⏰ Still waiting for your answer (app · abcdef12)', replyTo: channel.prompts[0]!.refs[0]! })
})

test('turn reports are sent only in away mode', async () => {
  await notifier.report({ session, report: { kind: 'turn_complete', text: 'ok', durationMs: 1_000, isAborted: false } })
  expect(channel.texts.map(sent => sent.text)).toEqual(['✅ Turn finished after 1s\n\nok'])
  notifier.away.set(false)
  await notifier.report({ session, report: { kind: 'turn_complete', text: 'ok', durationMs: 1_000, isAborted: false } })
  expect(channel.texts).toHaveLength(1)
})

test('session end closes and forgets the thread', async () => {
  await notifier.report({ session, report: { kind: 'session_started' } })
  await notifier.report({ session, report: { kind: 'session_ended', reason: 'exit' } })
  expect(channel.threads[0]!.closed).toBe(true)
  expect(channel.texts.map(sent => sent.text)).toEqual(['🟢 Session started in /home/u/app', '⚪ Session ended (exit)'])
  const ended = store.getSession(session.sessionId)!
  expect(ended.threadId).toBeNull()
  expect(ended.endedAt).not.toBeNull()
})

test('session end closes the thread silently when not away', async () => {
  await notifier.ensureThread(session.sessionId)
  notifier.away.set(false)
  await notifier.report({ session, report: { kind: 'session_ended', reason: 'clear' } })
  expect(channel.threads[0]!.closed).toBe(true)
  expect(channel.texts).toEqual([])
})

test('instructionDelivered confirms in the thread', async () => {
  await notifier.ensureThread(session.sessionId)
  const instruction = store.enqueueInstruction(session.sessionId, 'add tests')
  await notifier.instructionDelivered(instruction)
  expect(channel.texts.at(-1)?.text).toBe('📨 Delivered: add tests')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/bridge/notifier.test.ts`
Expected: FAIL, module not found

- [ ] **Step 3: Implement**

`src/bridge/notifier.ts`:

```ts
import type { Instruction, ReportRequest } from '../../mod/remote-agent/hooks/protocol.ts'
import type { Channel, ThreadRef } from '../channel/types.ts'
import { redactSecrets, truncate } from '../core/text.ts'
import type { PromptEvents } from './prompts.ts'
import type { PromptRow, SessionRow, Store } from './store.ts'
import { promptView, reportText, resolutionNote, sessionLabel, threadTitle } from './views.ts'

export class AwayMode {
  constructor(private on: boolean) {}

  isAway(): boolean {
    return this.on
  }

  set(on: boolean): void {
    this.on = on
  }
}

export class Notifier implements PromptEvents {
  private readonly creating = new Map<string, Promise<ThreadRef>>()
  private readonly resolvedNotified = new Set<string>()

  constructor(
    private readonly store: Store,
    private readonly channel: Channel,
    readonly away: AwayMode,
  ) {}

  async ensureThread(sessionId: string): Promise<ThreadRef> {
    const session = this.requireSession(sessionId)
    if (session.threadId !== null) {
      return session.threadId
    }
    const inFlight = this.creating.get(sessionId)
    if (inFlight !== undefined) {
      return inFlight
    }
    const created = this.channel
      .createThread(threadTitle(session))
      .then(threadId => {
        this.store.setSessionThread(sessionId, threadId)
        return threadId
      })
      .finally(() => {
        this.creating.delete(sessionId)
      })
    this.creating.set(sessionId, created)
    return created
  }

  async promptCreated(prompt: PromptRow): Promise<void> {
    const thread = await this.ensureThread(prompt.sessionId)
    const session = this.requireSession(prompt.sessionId)
    const refs = await this.channel.sendPrompt(thread, promptView(prompt, session))
    refs.forEach((ref, index) => {
      this.store.addPromptMessage(prompt.id, ref, index)
    })
    const latest = this.store.getPrompt(prompt.id)
    if (latest !== undefined && latest.status === 'answered') {
      await this.promptResolved(latest)
    }
  }

  async promptResolved(prompt: PromptRow): Promise<void> {
    if (prompt.answer === null || prompt.source === null || this.resolvedNotified.has(prompt.id)) {
      return
    }
    const refs = this.store.listPromptMessageRefs(prompt.id)
    const session = this.store.getSession(prompt.sessionId)
    if (refs.length === 0 || session === undefined || session.threadId === null) {
      return
    }
    this.resolvedNotified.add(prompt.id)
    await this.channel.markResolved(session.threadId, refs, resolutionNote(prompt.answer, prompt.source))
  }

  async promptReminder(prompt: PromptRow): Promise<void> {
    const session = this.store.getSession(prompt.sessionId)
    if (session === undefined || session.threadId === null) {
      return
    }
    const refs = this.store.listPromptMessageRefs(prompt.id)
    await this.channel.sendText(session.threadId, `⏰ Still waiting for your answer (${sessionLabel(session)})`, refs[0] ?? null)
  }

  async report(request: ReportRequest): Promise<void> {
    const session = this.store.upsertSession(request.session)
    if (request.report.kind === 'session_ended') {
      await this.endSession(session, reportText(request.report, session))
      return
    }
    if (!this.away.isAway()) {
      return
    }
    const thread = await this.ensureThread(session.id)
    await this.channel.sendText(thread, reportText(request.report, session), null)
  }

  async instructionDelivered(instruction: Instruction): Promise<void> {
    const session = this.store.getSession(instruction.sessionId)
    if (session === undefined || session.threadId === null) {
      return
    }
    await this.channel.sendText(session.threadId, `📨 Delivered: ${truncate(redactSecrets(instruction.text), 200)}`, null)
  }

  private async endSession(session: SessionRow, text: string): Promise<void> {
    this.store.endSession(session.id)
    if (session.threadId === null) {
      return
    }
    if (this.away.isAway()) {
      await this.channel.sendText(session.threadId, text, null)
    }
    await this.channel.closeThread(session.threadId)
    this.store.setSessionThread(session.id, null)
  }

  private requireSession(id: string): SessionRow {
    const session = this.store.getSession(id)
    if (session === undefined) {
      throw new Error(`Unknown session ${id}`)
    }
    return session
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test test/bridge/notifier.test.ts && bun run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bridge/notifier.ts test/bridge/notifier.test.ts
git commit -m "feat: deliver prompts and reports to per-session threads with away mode"
```

---

### Task 8: Inbound (buttons, replies, commands)

**Files:**
- Create: `src/bridge/inbound.ts`
- Test: `test/bridge/inbound.test.ts`

**Interfaces:**
- Consumes: `Store` (Task 4), `PromptService` (Task 6), `Notifier` (Task 7), `ChannelHandlers` (Task 5)
- Produces: `class Inbound(store, prompts, notifier) implements ChannelHandlers`; `parseQuestionReply(question: QuestionItem, text: string): string`

- [ ] **Step 1: Write the failing tests**

`test/bridge/inbound.test.ts`:

```ts
import { beforeEach, expect, test } from 'bun:test'
import type { QuestionItem } from '../../mod/remote-agent/hooks/protocol.ts'
import { Inbound, parseQuestionReply } from '../../src/bridge/inbound.ts'
import { AwayMode, Notifier } from '../../src/bridge/notifier.ts'
import { PromptService } from '../../src/bridge/prompts.ts'
import { Store } from '../../src/bridge/store.ts'
import { FakeChannel, flush } from '../support/fake-channel.ts'

const session = { sessionId: 's1', cwd: '/home/u/app' }
const single: QuestionItem = { question: 'DB?', header: 'DB', multiSelect: false, options: [{ label: 'SQLite', description: '' }, { label: 'Postgres', description: '' }] }
const multi: QuestionItem = { question: 'Extras?', header: 'X', multiSelect: true, options: [{ label: 'Docs', description: '' }, { label: 'Tests', description: '' }, { label: 'CI', description: '' }] }

let store: Store
let channel: FakeChannel
let prompts: PromptService
let notifier: Notifier
let inbound: Inbound

beforeEach(async () => {
  store = new Store(':memory:')
  channel = new FakeChannel()
  notifier = new Notifier(store, channel, new AwayMode(true))
  prompts = new PromptService(store, notifier, { reminderAfterMs: 60_000 })
  inbound = new Inbound(store, prompts, notifier)
})

test('parseQuestionReply maps numbers to labels and keeps free text', () => {
  expect(parseQuestionReply(single, '2')).toBe('Postgres')
  expect(parseQuestionReply(single, ' use MySQL ')).toBe('use MySQL')
  expect(parseQuestionReply(single, '1,2')).toBe('1,2')
  expect(parseQuestionReply(single, '9')).toBe('9')
  expect(parseQuestionReply(multi, '1, 3')).toBe('Docs, CI')
})

test('permission buttons answer allow/deny and a double tap is refused', async () => {
  prompts.create({ promptId: 'p:1', session, body: { kind: 'permission', tool: 'Bash', input: {} } })
  expect(await inbound.onButton({ promptId: 'p:1', questionIndex: 0, optionIndex: 0 })).toBe('Allowed')
  expect(await inbound.onButton({ promptId: 'p:1', questionIndex: 0, optionIndex: 1 })).toBe('Already answered.')
  expect(prompts.state('p:1')).toEqual({ status: 'answered', answer: { kind: 'permission', decision: 'allow' }, source: 'remote' })
})

test('question buttons record the chosen label', async () => {
  prompts.create({ promptId: 'q:1', session, body: { kind: 'question', questions: [single] } })
  expect(await inbound.onButton({ promptId: 'q:1', questionIndex: 0, optionIndex: 1 })).toBe('Answered: Postgres')
  expect(prompts.state('q:1')).toMatchObject({ status: 'answered', answer: { answers: { 'DB?': 'Postgres' } } })
})

test('unknown prompts and options are reported', async () => {
  expect(await inbound.onButton({ promptId: 'nope', questionIndex: 0, optionIndex: 0 })).toBe('This prompt no longer exists.')
  prompts.create({ promptId: 'q:1', session, body: { kind: 'question', questions: [single] } })
  expect(await inbound.onButton({ promptId: 'q:1', questionIndex: 0, optionIndex: 5 })).toBe('Unknown option.')
})

test('reply to a question message answers it', async () => {
  prompts.create({ promptId: 'q:1', session, body: { kind: 'question', questions: [multi] } })
  await flush()
  const ref = channel.prompts[0]!.refs[0]!
  expect(await inbound.onText({ thread: 't1', replyTo: ref, text: '2,3' })).toBe('Answered: Tests, CI')
})

test('reply to a permission message: words allow/deny, anything else denies with feedback', async () => {
  prompts.create({ promptId: 'p:1', session, body: { kind: 'permission', tool: 'Bash', input: {} } })
  prompts.create({ promptId: 'p:2', session, body: { kind: 'permission', tool: 'Bash', input: {} } })
  await flush()
  expect(await inbound.onText({ thread: 't1', replyTo: channel.prompts[0]!.refs[0]!, text: 'Yes' })).toBe('Allowed')
  expect(await inbound.onText({ thread: 't1', replyTo: channel.prompts[1]!.refs[0]!, text: 'use pnpm instead' })).toBe('Denied')
  expect(prompts.state('p:2')).toMatchObject({ answer: { decision: 'deny', message: 'use pnpm instead' } })
})

test('other text in a session thread is queued as an instruction', async () => {
  store.upsertSession(session)
  store.setSessionThread('s1', 't1')
  expect(await inbound.onText({ thread: 't1', replyTo: null, text: 'now add tests' })).toBe('📥 Queued. It will be sent when the session is idle.')
  expect(store.listPendingInstructions('s1').map(instruction => instruction.text)).toEqual(['now add tests'])
})

test('text outside a session thread is refused', async () => {
  expect(await inbound.onText({ thread: null, replyTo: null, text: 'hi' })).toBe('Send instructions inside a session topic.')
  expect(await inbound.onText({ thread: 'gone', replyTo: null, text: 'hi' })).toBe('This session has ended.')
})

test('commands toggle away mode and report status', async () => {
  expect(await inbound.onCommand({ name: 'back', thread: null })).toBe('🏠 Away mode off: only prompts will be sent.')
  expect(notifier.away.isAway()).toBe(false)
  expect(await inbound.onCommand({ name: 'away', thread: null })).toBe('🛫 Away mode on: prompts and reports will be sent.')
  store.upsertSession(session)
  prompts.create({ promptId: 'p:1', session, body: { kind: 'permission', tool: 'Bash', input: {} } })
  expect(await inbound.onCommand({ name: 'status', thread: null })).toBe('Away mode: on\nActive sessions: 1\n• app · s1\nPending prompts: 1')
  expect(await inbound.onCommand({ name: 'nope', thread: null })).toBe('Unknown command. Try /away, /back or /status.')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/bridge/inbound.test.ts`
Expected: FAIL, module not found

- [ ] **Step 3: Implement**

`src/bridge/inbound.ts`:

```ts
import type { AnswerResult, QuestionItem } from '../../mod/remote-agent/hooks/protocol.ts'
import type { ButtonData, ChannelHandlers, InboundCommand, InboundText } from '../channel/types.ts'
import type { Notifier } from './notifier.ts'
import type { PromptService } from './prompts.ts'
import type { PromptMessageLink, Store } from './store.ts'
import { sessionLabel } from './views.ts'

const ALLOW_WORDS = new Set(['allow', 'yes', 'y', 'ok', 'approve'])
const DENY_WORDS = new Set(['deny', 'no', 'n', 'reject'])

export function parseQuestionReply(question: QuestionItem, text: string): string {
  const trimmed = text.trim()
  const parts = trimmed.split(/\s*,\s*/)
  if (!parts.every(part => /^\d+$/.test(part))) {
    return trimmed
  }
  if (!question.multiSelect && parts.length > 1) {
    return trimmed
  }
  const labels = parts.map(part => question.options[Number(part) - 1]?.label)
  if (labels.some(label => label === undefined)) {
    return trimmed
  }
  return labels.join(', ')
}

function describe(result: AnswerResult | undefined, fallback: string): string {
  if (result === undefined) {
    return 'This prompt no longer exists.'
  }
  if (!result.accepted) {
    return 'Already answered.'
  }
  if (result.state.status === 'pending') {
    return 'Recorded. Answer the remaining questions to continue.'
  }
  return fallback
}

export class Inbound implements ChannelHandlers {
  constructor(
    private readonly store: Store,
    private readonly prompts: PromptService,
    private readonly notifier: Notifier,
  ) {}

  async onButton(press: ButtonData): Promise<string> {
    const prompt = this.store.getPrompt(press.promptId)
    if (prompt === undefined) {
      return 'This prompt no longer exists.'
    }
    if (prompt.status === 'answered') {
      return 'Already answered.'
    }
    if (prompt.body.kind === 'permission') {
      const decision = press.optionIndex === 0 ? 'allow' : 'deny'
      const result = this.prompts.answer(prompt.id, { kind: 'permission', decision }, 'remote')
      return describe(result, decision === 'allow' ? 'Allowed' : 'Denied')
    }
    const option = prompt.body.questions[press.questionIndex]?.options[press.optionIndex]
    if (option === undefined) {
      return 'Unknown option.'
    }
    return describe(this.prompts.answerQuestionPart(prompt.id, press.questionIndex, option.label), `Answered: ${option.label}`)
  }

  async onText(message: InboundText): Promise<string | null> {
    if (message.replyTo !== null) {
      const link = this.store.findPromptMessage(message.replyTo)
      if (link !== undefined) {
        return this.answerByText(link, message.text)
      }
    }
    if (message.thread === null) {
      return 'Send instructions inside a session topic.'
    }
    const session = this.store.findSessionByThread(message.thread)
    if (session === undefined || session.endedAt !== null) {
      return 'This session has ended.'
    }
    this.store.enqueueInstruction(session.id, message.text)
    return '📥 Queued. It will be sent when the session is idle.'
  }

  async onCommand(command: InboundCommand): Promise<string> {
    if (command.name === 'away') {
      this.notifier.away.set(true)
      return '🛫 Away mode on: prompts and reports will be sent.'
    }
    if (command.name === 'back') {
      this.notifier.away.set(false)
      return '🏠 Away mode off: only prompts will be sent.'
    }
    if (command.name === 'status') {
      const sessions = this.store.listActiveSessions()
      const lines = [
        `Away mode: ${this.notifier.away.isAway() ? 'on' : 'off'}`,
        `Active sessions: ${sessions.length}`,
        ...sessions.map(session => `• ${sessionLabel(session)}`),
        `Pending prompts: ${this.store.listPendingPrompts().length}`,
      ]
      return lines.join('\n')
    }
    return 'Unknown command. Try /away, /back or /status.'
  }

  private answerByText(link: PromptMessageLink, text: string): string {
    const prompt = this.store.getPrompt(link.promptId)
    if (prompt === undefined) {
      return 'This prompt no longer exists.'
    }
    if (prompt.status === 'answered') {
      return 'Already answered.'
    }
    if (prompt.body.kind === 'permission') {
      const word = text.trim().toLowerCase()
      const decision = ALLOW_WORDS.has(word) ? 'allow' : 'deny'
      const message = decision === 'deny' && !DENY_WORDS.has(word) ? text.trim() : undefined
      const result = this.prompts.answer(prompt.id, { kind: 'permission', decision, ...(message === undefined ? {} : { message }) }, 'remote')
      return describe(result, decision === 'allow' ? 'Allowed' : 'Denied')
    }
    const question = prompt.body.questions[link.questionIndex]
    if (question === undefined) {
      return 'Unknown question.'
    }
    const value = parseQuestionReply(question, text)
    return describe(this.prompts.answerQuestionPart(prompt.id, link.questionIndex, value), `Answered: ${value}`)
  }
}
```

The status test expects `• app · s1`. `sessionLabel` takes the first 8 chars of `s1`, which is `s1`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test test/bridge/inbound.test.ts && bun run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bridge/inbound.ts test/bridge/inbound.test.ts
git commit -m "feat: turn channel buttons, replies and commands into answers and instructions"
```

---

### Task 9: HTTP API

**Files:**
- Create: `src/bridge/schemas.ts`, `src/bridge/http.ts`
- Test: `test/bridge/http.test.ts`

**Interfaces:**
- Consumes: `PromptService`, `Log` (Task 6), `Notifier` (Task 7), `Store` (Task 4), `Inbound` (Task 8, in tests), `BadRequest`, `MAX_WAIT_MS`
- Produces: `CreatePromptSchema`, `LocalAnswerSchema`, `ReportRequestSchema`; `type HttpDeps = { prompts: PromptService; notifier: Notifier; store: Store; log: Log }`; `createHandler(deps): (request: Request) => Promise<Response>`

- [ ] **Step 1: Write the failing tests**

`test/bridge/http.test.ts`:

```ts
import { beforeEach, expect, test } from 'bun:test'
import { createHandler } from '../../src/bridge/http.ts'
import { Inbound } from '../../src/bridge/inbound.ts'
import { AwayMode, Notifier } from '../../src/bridge/notifier.ts'
import { PromptService } from '../../src/bridge/prompts.ts'
import { Store } from '../../src/bridge/store.ts'
import { FakeChannel, flush } from '../support/fake-channel.ts'

const session = { sessionId: 's1', cwd: '/home/u/app' }
const permissionRequest = { promptId: 'p:toolu_1', session, body: { kind: 'permission', tool: 'Bash', input: { command: 'rm -rf build' } } }

let handle: (request: Request) => Promise<Response>
let channel: FakeChannel
let inbound: Inbound
let store: Store
let logged: string[]

function call(method: string, path: string, body?: unknown): Promise<Response> {
  return handle(new Request(`http://bridge${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) }))
}

beforeEach(() => {
  store = new Store(':memory:')
  channel = new FakeChannel()
  const notifier = new Notifier(store, channel, new AwayMode(true))
  const prompts = new PromptService(store, notifier, { reminderAfterMs: 60_000 })
  inbound = new Inbound(store, prompts, notifier)
  logged = []
  handle = createHandler({ prompts, notifier, store, log: message => logged.push(message) })
})

test('health', async () => {
  expect(await (await call('GET', '/health')).json()).toEqual({ ok: true })
})

test('remote answer reaches a long-polling session', async () => {
  expect(await (await call('POST', '/prompts', permissionRequest)).json()).toEqual({ status: 'pending' })
  await flush()
  expect(channel.prompts).toHaveLength(1)
  const polling = call('GET', '/prompts/p%3Atoolu_1?waitMs=5000')
  await inbound.onButton({ promptId: 'p:toolu_1', questionIndex: 0, optionIndex: 0 })
  expect(await (await polling).json()).toEqual({ status: 'answered', answer: { kind: 'permission', decision: 'allow' }, source: 'remote' })
})

test('a late local answer is rejected and told the winner', async () => {
  await call('POST', '/prompts', permissionRequest)
  await inbound.onButton({ promptId: 'p:toolu_1', questionIndex: 0, optionIndex: 1 })
  const response = await call('POST', '/prompts/p%3Atoolu_1/answer', { answer: { kind: 'permission', decision: 'allow' } })
  expect(await response.json()).toEqual({ accepted: false, state: { status: 'answered', answer: { kind: 'permission', decision: 'deny' }, source: 'remote' } })
})

test('a local answer resolves the telegram message', async () => {
  await call('POST', '/prompts', permissionRequest)
  await flush()
  const response = await call('POST', '/prompts/p%3Atoolu_1/answer', { answer: { kind: 'permission', decision: 'allow' } })
  expect((await response.json()).accepted).toBe(true)
  await flush()
  expect(channel.resolved.map(resolved => resolved.note)).toEqual(['✅ Allowed (local)'])
})

test('waitMs is capped and pending is returned on timeout', async () => {
  await call('POST', '/prompts', permissionRequest)
  const started = Date.now()
  expect(await (await call('GET', '/prompts/p%3Atoolu_1?waitMs=30')).json()).toEqual({ status: 'pending' })
  expect(Date.now() - started).toBeLessThan(1_000)
})

test('unknown prompts are 404', async () => {
  expect((await call('GET', '/prompts/nope')).status).toBe(404)
  expect((await call('POST', '/prompts/nope/answer', { answer: { kind: 'permission', decision: 'allow' } })).status).toBe(404)
})

test('malformed bodies and mismatched kinds are 400', async () => {
  expect((await call('POST', '/prompts', { promptId: 'x' })).status).toBe(400)
  await call('POST', '/prompts', permissionRequest)
  expect((await call('POST', '/prompts/p%3Atoolu_1/answer', { answer: { kind: 'question', answers: {} } })).status).toBe(400)
})

test('reports are accepted asynchronously', async () => {
  const response = await call('POST', '/reports', { session, report: { kind: 'turn_complete', text: 'done', durationMs: 2_000, isAborted: false } })
  expect(response.status).toBe(202)
  await flush()
  expect(channel.texts.map(sent => sent.text)).toEqual(['✅ Turn finished after 2s\n\ndone'])
})

test('instructions are listed until acknowledged', async () => {
  store.upsertSession(session)
  store.setSessionThread('s1', 't1')
  await inbound.onText({ thread: 't1', replyTo: null, text: 'continue' })
  const [instruction] = (await (await call('GET', '/sessions/s1/instructions')).json()) as { id: string; text: string }[]
  expect(instruction?.text).toBe('continue')
  expect((await call('POST', `/instructions/${instruction!.id}/delivered`)).status).toBe(204)
  expect(await (await call('GET', '/sessions/s1/instructions')).json()).toEqual([])
  expect((await call('POST', '/instructions/nope/delivered')).status).toBe(404)
  await flush()
  expect(channel.texts.at(-1)?.text).toBe('📨 Delivered: continue')
})

test('unknown routes are 404', async () => {
  expect((await call('GET', '/nope')).status).toBe(404)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/bridge/http.test.ts`
Expected: FAIL, module not found

- [ ] **Step 3: Implement**

`src/bridge/schemas.ts`:

```ts
import { z } from 'zod'

const SessionInfoSchema = z.object({ sessionId: z.string().min(1), cwd: z.string().min(1) })

const QuestionItemSchema = z.object({
  question: z.string().min(1),
  header: z.string(),
  multiSelect: z.boolean(),
  options: z.array(z.object({ label: z.string().min(1), description: z.string() })).min(1),
})

const PromptBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('question'), questions: z.array(QuestionItemSchema).min(1).max(4) }),
  z.object({ kind: z.literal('permission'), tool: z.string().min(1), input: z.unknown(), reason: z.string().optional(), agentId: z.string().optional() }),
])

// 56 chars keeps Telegram callback_data (`<id>|q|o`) under its 64-byte limit.
export const CreatePromptSchema = z.object({ promptId: z.string().min(1).max(56), session: SessionInfoSchema, body: PromptBodySchema })

const AnswerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('question'), answers: z.record(z.string()) }),
  z.object({ kind: z.literal('permission'), decision: z.enum(['allow', 'deny']), message: z.string().optional() }),
])

export const LocalAnswerSchema = z.object({ answer: AnswerSchema })

export const ReportRequestSchema = z.object({
  session: SessionInfoSchema,
  report: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('session_started') }),
    z.object({ kind: z.literal('session_ended'), reason: z.string() }),
    z.object({ kind: z.literal('turn_complete'), text: z.string(), durationMs: z.number().nonnegative(), isAborted: z.boolean() }),
  ]),
})
```

`src/bridge/http.ts`:

```ts
import { ZodError } from 'zod'
import { MAX_WAIT_MS, type Answer, type CreatePromptRequest, type ReportRequest } from '../../mod/remote-agent/hooks/protocol.ts'
import { BadRequest } from './errors.ts'
import type { Notifier } from './notifier.ts'
import type { Log, PromptService } from './prompts.ts'
import { CreatePromptSchema, LocalAnswerSchema, ReportRequestSchema } from './schemas.ts'
import type { Store } from './store.ts'

export type HttpDeps = { prompts: PromptService; notifier: Notifier; store: Store; log: Log }

const PROMPT = /^\/prompts\/([^/]+)$/
const PROMPT_ANSWER = /^\/prompts\/([^/]+)\/answer$/
const SESSION_INSTRUCTIONS = /^\/sessions\/([^/]+)\/instructions$/
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

  if (method === 'POST' && path === '/reports') {
    const body = ReportRequestSchema.parse(await request.json()) as ReportRequest
    void deps.notifier.report(body).catch(error => {
      deps.log('report delivery failed', error)
    })
    return empty(202)
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test test/bridge && bun run typecheck`
Expected: PASS (all bridge tests)

- [ ] **Step 5: Commit**

```bash
git add src/bridge/schemas.ts src/bridge/http.ts test/bridge/http.test.ts
git commit -m "feat: expose bridge http api for sessions"
```

---

### Task 10: Telegram channel adapter

**Files:**
- Create: `src/channel/telegram/render.ts`, `src/channel/telegram/updates.ts`, `src/channel/telegram/adapter.ts`
- Test: `test/channel/telegram.test.ts`

**Interfaces:**
- Consumes: `Channel`, `ChannelHandlers`, `ButtonData`, `PromptView`, `PromptViewItem` (Task 5); `escapeHtml`, `truncate` (Task 2); `Log` (Task 6)
- Produces: `MAX_MESSAGE = 4096`, `encodeButton(data): string`, `decodeButton(raw): ButtonData | undefined`, `renderHtml(title: string | null, body: string): string`, `keyboard(item): { inline_keyboard: { text: string; callback_data: string }[][] }`; `isAuthorized(sender: { chatId?: number; userId?: number }, allowed: { chatId: number; allowedUserId: number }): boolean`, `parseCommand(text): { name: string } | undefined`, `threadOf(message): ThreadRef | null`, `replyTarget(message): MessageRef | null`; `class TelegramChannel(config: { botToken: string; chatId: number; allowedUserId: number }, log: Log) implements Channel`

- [ ] **Step 1: Write the failing tests**

`test/channel/telegram.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { decodeButton, encodeButton, keyboard, MAX_MESSAGE, renderHtml } from '../../src/channel/telegram/render.ts'
import { isAuthorized, parseCommand, replyTarget, threadOf } from '../../src/channel/telegram/updates.ts'

describe('buttons', () => {
  test('round-trip', () => {
    const data = { promptId: 'q:toolu_01ABCDEFGHIJKLMNOPQRSTUV', questionIndex: 3, optionIndex: 2 }
    expect(decodeButton(encodeButton(data))).toEqual(data)
  })
  test('refuse callback data over 64 bytes', () => {
    expect(() => encodeButton({ promptId: 'x'.repeat(70), questionIndex: 0, optionIndex: 0 })).toThrow('64')
  })
  test('ignore foreign data', () => {
    expect(decodeButton('garbage')).toBeUndefined()
  })
  test('keyboard puts one button per row', () => {
    const markup = keyboard({ text: 'x', buttons: [{ label: 'A', data: { promptId: 'p', questionIndex: 0, optionIndex: 0 } }, { label: 'B', data: { promptId: 'p', questionIndex: 0, optionIndex: 1 } }] })
    expect(markup).toEqual({ inline_keyboard: [[{ text: 'A', callback_data: 'p|0|0' }], [{ text: 'B', callback_data: 'p|0|1' }]] })
  })
})

describe('renderHtml', () => {
  test('bolds the title and escapes the body', () => {
    expect(renderHtml('app · 1234', 'a < b')).toBe('<b>app · 1234</b>\na &lt; b')
  })
  test('stays under the limit even when escaping inflates the text', () => {
    const html = renderHtml('t', '<&>'.repeat(5_000))
    expect(html.length).toBeLessThanOrEqual(MAX_MESSAGE)
    expect(html).toContain('chars]')
  })
})

describe('updates', () => {
  const allowed = { chatId: -100, allowedUserId: 42 }
  test('only the configured chat and user are authorized', () => {
    expect(isAuthorized({ chatId: -100, userId: 42 }, allowed)).toBe(true)
    expect(isAuthorized({ chatId: -100, userId: 7 }, allowed)).toBe(false)
    expect(isAuthorized({ chatId: -999, userId: 42 }, allowed)).toBe(false)
    expect(isAuthorized({}, allowed)).toBe(false)
  })
  test('commands, with or without the bot suffix', () => {
    expect(parseCommand('/status')).toEqual({ name: 'status' })
    expect(parseCommand('/away@my_bot now')).toEqual({ name: 'away' })
    expect(parseCommand('hello /status')).toBeUndefined()
  })
  test('thread is the topic id only for topic messages', () => {
    expect(threadOf({ is_topic_message: true, message_thread_id: 77 })).toBe('77')
    expect(threadOf({ message_thread_id: 77 })).toBeNull()
  })
  test('a plain message in a topic is not a reply (Telegram marks it as a reply to the topic root)', () => {
    expect(replyTarget({ message_thread_id: 77, reply_to_message: { message_id: 77 } })).toBeNull()
    expect(replyTarget({ message_thread_id: 77, reply_to_message: { message_id: 90 } })).toBe('90')
    expect(replyTarget({})).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/channel/telegram.test.ts`
Expected: FAIL, modules not found

- [ ] **Step 3: Implement the pure helpers**

`src/channel/telegram/render.ts`:

```ts
import { escapeHtml, truncate } from '../../core/text.ts'
import type { ButtonData, PromptViewItem } from '../types.ts'

export const MAX_MESSAGE = 4096
const MAX_CALLBACK_BYTES = 64

export function encodeButton(data: ButtonData): string {
  const raw = `${data.promptId}|${data.questionIndex}|${data.optionIndex}`
  if (new TextEncoder().encode(raw).length > MAX_CALLBACK_BYTES) {
    throw new Error(`callback_data exceeds ${MAX_CALLBACK_BYTES} bytes: ${raw}`)
  }
  return raw
}

export function decodeButton(raw: string): ButtonData | undefined {
  const match = /^(.+)\|(\d+)\|(\d+)$/.exec(raw)
  if (match === null) {
    return undefined
  }
  return { promptId: match[1] ?? '', questionIndex: Number(match[2]), optionIndex: Number(match[3]) }
}

export function keyboard(item: PromptViewItem): { inline_keyboard: { text: string; callback_data: string }[][] } {
  return { inline_keyboard: item.buttons.map(button => [{ text: button.label, callback_data: encodeButton(button.data) }]) }
}

export function renderHtml(title: string | null, body: string): string {
  const head = title === null ? '' : `<b>${escapeHtml(title)}</b>\n`
  let keep = body.length
  while (keep > 0) {
    const html = head + escapeHtml(truncate(body, keep))
    if (html.length <= MAX_MESSAGE) {
      return html
    }
    keep = Math.floor(keep * 0.8)
  }
  return head.slice(0, MAX_MESSAGE)
}
```

`src/channel/telegram/updates.ts`:

```ts
import type { MessageRef, ThreadRef } from '../types.ts'

export function isAuthorized(sender: { chatId?: number; userId?: number }, allowed: { chatId: number; allowedUserId: number }): boolean {
  return sender.chatId === allowed.chatId && sender.userId === allowed.allowedUserId
}

export function parseCommand(text: string): { name: string } | undefined {
  const match = /^\/([a-z_]+)(?:@\w+)?(?:\s|$)/i.exec(text)
  return match === null ? undefined : { name: (match[1] ?? '').toLowerCase() }
}

export function threadOf(message: { is_topic_message?: boolean; message_thread_id?: number }): ThreadRef | null {
  if (message.is_topic_message !== true || message.message_thread_id === undefined) {
    return null
  }
  return String(message.message_thread_id)
}

/** Telegram marks every message in a topic as a reply to the topic's root message, so that is not a real reply. */
export function replyTarget(message: { message_thread_id?: number; reply_to_message?: { message_id: number } }): MessageRef | null {
  const reply = message.reply_to_message
  if (reply === undefined || reply.message_id === message.message_thread_id) {
    return null
  }
  return String(reply.message_id)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test test/channel/telegram.test.ts`
Expected: PASS

- [ ] **Step 5: Implement the grammY adapter**

`src/channel/telegram/adapter.ts`:

```ts
import { autoRetry } from '@grammyjs/auto-retry'
import { Bot } from 'grammy'
import type { Log } from '../../bridge/prompts.ts'
import { escapeHtml } from '../../core/text.ts'
import type { Channel, ChannelHandlers, MessageRef, PromptView, ThreadRef } from '../types.ts'
import { decodeButton, keyboard, renderHtml } from './render.ts'
import { isAuthorized, parseCommand, replyTarget, threadOf } from './updates.ts'

export type TelegramConfig = { botToken: string; chatId: number; allowedUserId: number }

export class TelegramChannel implements Channel {
  private readonly bot: Bot

  constructor(
    private readonly config: TelegramConfig,
    private readonly log: Log,
  ) {
    this.bot = new Bot(config.botToken)
    this.bot.api.config.use(autoRetry())
  }

  async start(handlers: ChannelHandlers): Promise<void> {
    this.bot.use(async (ctx, next) => {
      if (!isAuthorized({ chatId: ctx.chat?.id, userId: ctx.from?.id }, this.config)) {
        this.log(`ignored update from chat=${ctx.chat?.id} user=${ctx.from?.id}`)
        return
      }
      await next()
    })

    this.bot.on('callback_query:data', async ctx => {
      const press = decodeButton(ctx.callbackQuery.data)
      if (press === undefined) {
        await ctx.answerCallbackQuery({ text: 'Unknown button.' })
        return
      }
      await ctx.answerCallbackQuery({ text: await handlers.onButton(press) })
    })

    this.bot.on('message:text', async ctx => {
      const message = ctx.message
      const thread = threadOf(message)
      const command = parseCommand(message.text)
      const reply = command === undefined
        ? await handlers.onText({ thread, replyTo: replyTarget(message), text: message.text })
        : await handlers.onCommand({ name: command.name, thread })
      if (reply === null) {
        return
      }
      await this.bot.api.sendMessage(this.config.chatId, escapeHtml(reply), {
        parse_mode: 'HTML',
        message_thread_id: thread === null ? undefined : Number(thread),
        reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
      })
    })

    this.bot.catch(error => {
      this.log('telegram handler failed', error.error)
    })

    await this.bot.api.setMyCommands([
      { command: 'away', description: 'Send prompts and reports' },
      { command: 'back', description: 'Send prompts only' },
      { command: 'status', description: 'Show sessions and pending prompts' },
    ])
    void this.bot.start({ allowed_updates: ['message', 'callback_query'] })
  }

  async stop(): Promise<void> {
    await this.bot.stop()
  }

  async createThread(title: string): Promise<ThreadRef> {
    const topic = await this.bot.api.createForumTopic(this.config.chatId, title.slice(0, 128))
    return String(topic.message_thread_id)
  }

  async closeThread(thread: ThreadRef): Promise<void> {
    await this.bot.api.closeForumTopic(this.config.chatId, Number(thread)).catch(error => {
      this.log(`closing topic ${thread} failed`, error)
    })
  }

  async sendText(thread: ThreadRef | null, text: string, replyTo: MessageRef | null): Promise<MessageRef> {
    const message = await this.bot.api.sendMessage(this.config.chatId, renderHtml(null, text), {
      parse_mode: 'HTML',
      message_thread_id: thread === null ? undefined : Number(thread),
      reply_parameters: replyTo === null ? undefined : { message_id: Number(replyTo), allow_sending_without_reply: true },
    })
    return String(message.message_id)
  }

  async sendPrompt(thread: ThreadRef, view: PromptView): Promise<MessageRef[]> {
    const refs: MessageRef[] = []
    for (const item of view.items) {
      const message = await this.bot.api.sendMessage(this.config.chatId, renderHtml(view.title, item.text), {
        parse_mode: 'HTML',
        message_thread_id: Number(thread),
        reply_markup: item.buttons.length > 0 ? keyboard(item) : { force_reply: true, input_field_placeholder: 'e.g. 1,3' },
      })
      refs.push(String(message.message_id))
    }
    return refs
  }

  async markResolved(thread: ThreadRef, messages: MessageRef[], note: string): Promise<void> {
    for (const ref of messages) {
      await this.bot.api
        .editMessageReplyMarkup(this.config.chatId, Number(ref), { reply_markup: { inline_keyboard: [] } })
        .catch(error => {
          this.log(`removing buttons from ${ref} failed`, error)
        })
    }
    await this.sendText(thread, note, messages[0] ?? null)
  }
}
```

- [ ] **Step 6: Type-check and run all tests**

Run: `bun run typecheck && bun test`
Expected: no type errors, all PASS. If grammY's types reject a field name (for example `reply_parameters` on an older grammY), check `node_modules/grammy/out/types.d.ts` and use the field that version declares. Don't remove the field.

- [ ] **Step 7: Commit**

```bash
git add src/channel/telegram test/channel
git commit -m "feat: add telegram channel with forum topics, buttons and allowlist"
```

---

### Task 11: Bridge entrypoint, service unit and setup docs

**Files:**
- Create: `src/bridge/main.ts`, `deploy/remote-agent.service`, `.env.example`, `README.md`

**Interfaces:**
- Consumes: everything from Tasks 3–10
- Produces: a runnable Bridge (`bun run bridge`)

- [ ] **Step 1: Write the composition root**

`src/bridge/main.ts`:

```ts
import { chmod, mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { TelegramChannel } from '../channel/telegram/adapter.ts'
import { loadConfig } from './config.ts'
import { createHandler } from './http.ts'
import { Inbound } from './inbound.ts'
import { AwayMode, Notifier } from './notifier.ts'
import { PromptService, type Log } from './prompts.ts'
import { Store } from './store.ts'

const log: Log = (message, error) => {
  if (error === undefined) {
    console.error(`[bridge] ${message}`)
    return
  }
  console.error(`[bridge] ${message}`, error)
}

const config = loadConfig(process.env)
await mkdir(dirname(config.dbPath), { recursive: true, mode: 0o700 })
await mkdir(dirname(config.socketPath), { recursive: true, mode: 0o700 })
await rm(config.socketPath, { force: true })

const store = new Store(config.dbPath)
const channel = new TelegramChannel(config, log)
const notifier = new Notifier(store, channel, new AwayMode(true))
const prompts = new PromptService(store, notifier, { reminderAfterMs: config.reminderAfterMs, log })
const inbound = new Inbound(store, prompts, notifier)

const server = Bun.serve({
  unix: config.socketPath,
  idleTimeout: 60,
  fetch: createHandler({ prompts, notifier, store, log }),
})
await chmod(config.socketPath, 0o600)
await channel.start(inbound)
const reminders = setInterval(() => {
  void prompts.remindStale()
}, 60_000)
log(`listening on ${config.socketPath}`)
await channel.sendText(null, '🟢 Bridge started. Away mode is on.', null).catch(error => {
  log('startup message failed', error)
})

let stopping = false
async function shutdown(signal: string): Promise<void> {
  if (stopping) {
    return
  }
  stopping = true
  log(`${signal} received, shutting down`)
  clearInterval(reminders)
  server.stop(true)
  await channel.stop()
  store.close()
  await rm(config.socketPath, { force: true })
  process.exit(0)
}
process.on('SIGINT', () => {
  void shutdown('SIGINT')
})
process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
```

- [ ] **Step 2: Write the service unit and env example**

`deploy/remote-agent.service`:

```ini
[Unit]
Description=Remote Agent bridge (Claude Code <-> Telegram)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/Sites/remote-agent
EnvironmentFile=%h/.config/remote-agent/env
ExecStart=%h/.bun/bin/bun run src/bridge/main.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

`.env.example`:

```bash
# Copy to ~/.config/remote-agent/env (chmod 600). Never commit real values.
TELEGRAM_BOT_TOKEN=123456789:replace-me
# Private supergroup with Topics enabled (negative, starts with -100)
TELEGRAM_CHAT_ID=-1001234567890
# Your own Telegram user id
TELEGRAM_ALLOWED_USER_ID=123456789
# Optional overrides
# REMOTE_AGENT_SOCKET=/run/user/1000/remote-agent/bridge.sock
# REMOTE_AGENT_DB=/home/you/.local/state/remote-agent/bridge.db
# REMOTE_AGENT_REMINDER_MINUTES=30
```

- [ ] **Step 3: Write README.md**

`README.md` must contain these sections with this content:

1. **What it is.** Two sentences from the spec Goal, plus links to `CONTEXT.md`, the ADR and `references/`.
2. **Telegram setup**, in order:
   1. In @BotFather: `/newbot`, then copy the token.
   2. Create a private group, open its settings, enable **Topics** (this converts it to a supergroup).
   3. Add the bot as an **admin** with **Manage Topics**. Admin bots receive every message, so privacy mode doesn't matter.
   4. Turn off "Remain anonymous" for your own admin account. Anonymous posts arrive from the group, not from you, and the allowlist drops them.
   5. Get the chat id: send a message in the group, then `curl "https://api.telegram.org/bot<TOKEN>/getUpdates"` and read `message.chat.id`. It is negative and starts with `-100`. Get your user id from `message.from.id` in the same output.
3. **Run the Bridge**:
   ```bash
   mkdir -p ~/.config/remote-agent && cp .env.example ~/.config/remote-agent/env && chmod 600 ~/.config/remote-agent/env
   # edit the values, then:
   mkdir -p ~/.config/systemd/user && cp deploy/remote-agent.service ~/.config/systemd/user/
   systemctl --user daemon-reload && systemctl --user enable --now remote-agent
   journalctl --user -u remote-agent -f
   ```
4. **Install the mod.** These are the exact commands from Task 13 Step 6.
5. **Using it**: the Telegram behaviour list from the spec section "Telegram behaviour", plus `/away`, `/back` and `/status`.
6. **Security notes**: the socket is user-only (0600). Only one chat and one user are accepted. Text is redacted and truncated, but Telegram bot chats are **not** end-to-end encrypted. The mod runs with your permissions and never approves anything without an Answer.
7. **Known limitations**: copy the limitations recorded in `references/spike-results.md`, and add "headless (`-p`/SDK) sessions are not bridged".

- [ ] **Step 4: Smoke-test the Bridge against real Telegram (human partner)**

Fill `~/.config/remote-agent/env`, then run `set -a; source ~/.config/remote-agent/env; set +a; bun run bridge` in one terminal, and in another:

```bash
SOCK="$XDG_RUNTIME_DIR/remote-agent/bridge.sock"
curl --unix-socket "$SOCK" http://bridge/health
curl --unix-socket "$SOCK" -X POST http://bridge/prompts -d '{"promptId":"p:smoke1","session":{"sessionId":"smoke-session","cwd":"/tmp/demo"},"body":{"kind":"permission","tool":"Bash","input":{"command":"echo API_KEY=hunter2"}}}'
curl --unix-socket "$SOCK" "http://bridge/prompts/p%3Asmoke1?waitMs=25000"
```

Expected:
- `/health` returns `{"ok":true}`, and the group shows "🟢 Bridge started".
- A topic `demo · smoke-se` appears with a Permission message, its command shown as `API_KEY=[REDACTED]`.
- Tap **Allow** while the third curl is waiting. It returns `{"status":"answered",…"decision":"allow","source":"remote"}`, the buttons disappear, and "✅ Allowed (remote)" is posted.
- Type `hello` in the topic: the bot replies "📥 Queued…". `/status` lists one session and 0 pending prompts.
- A message from a second Telegram account in the group gets no response, and the bridge logs `ignored update`.

- [ ] **Step 5: Commit**

```bash
git add src/bridge/main.ts deploy .env.example README.md
git commit -m "feat: add bridge entrypoint, systemd unit and setup guide"
```

---

### Task 12: Mod bridge client and flows

**Files:**
- Create: `mod/remote-agent/hooks/bridge-client.ts`, `mod/remote-agent/hooks/flows.ts`
- Test: `test/mod/bridge-client.test.ts`, `test/mod/flows.test.ts`

**Interfaces:**
- Consumes: protocol types (Task 3)
- Produces:
  - `type HttpPort = (path: string, init?: { method?: string; body?: string }) => Promise<{ status: number; text: string }>`; `class BridgeError extends Error`; `class BridgeClient(http: HttpPort)` with `createPrompt(request): Promise<AnswerState>`, `waitAnswer(promptId, waitMs): Promise<AnswerState>`, `postLocalAnswer(promptId, answer): Promise<AnswerResult>`, `report(request): Promise<void>`, `instructions(sessionId): Promise<Instruction[]>`, `ackInstruction(id): Promise<void>`
  - `type BridgePort = Pick<BridgeClient, 'createPrompt' | 'waitAnswer' | 'postLocalAnswer' | 'instructions' | 'ackInstruction'>`, `type Sleep = (ms: number) => Promise<void>`, `type AskPort = (question: string, options: { options: string[]; header?: string; multiSelect?: true }) => Promise<string>`, `class DismissedError extends Error`, `resolvePrompt(options: ResolveOptions): Promise<Answer | null>`, `askQuestionsLocally(ask, questions): () => Promise<Answer>`, `askPermissionLocally(ask, tool, input): () => Promise<Answer>`, `shortSummary(tool, input): string`, `type InstructionState = { inFlight: Set<string>; submitted: Set<string> }`, `pollInstructions(bridge, sessionId, state, submit): Promise<void>`

- [ ] **Step 1: Write the failing client tests**

`test/mod/bridge-client.test.ts`:

```ts
import { expect, test } from 'bun:test'
import { BridgeClient, BridgeError, type HttpPort } from '../../mod/remote-agent/hooks/bridge-client.ts'

function recording(responses: { status: number; text: string }[]) {
  const calls: { path: string; method?: string; body?: string }[] = []
  const http: HttpPort = async (path, init) => {
    calls.push({ path, method: init?.method, body: init?.body })
    const next = responses.shift()
    if (next === undefined) {
      throw new Error('no response queued')
    }
    return next
  }
  return { calls, client: new BridgeClient(http) }
}

test('createPrompt posts JSON and parses the state', async () => {
  const { calls, client } = recording([{ status: 200, text: '{"status":"pending"}' }])
  const state = await client.createPrompt({ promptId: 'p:1', session: { sessionId: 's', cwd: '/' }, body: { kind: 'permission', tool: 'Bash', input: {} } })
  expect(state).toEqual({ status: 'pending' })
  expect(calls[0]).toMatchObject({ path: '/prompts', method: 'POST' })
  expect(JSON.parse(calls[0]!.body!)).toMatchObject({ promptId: 'p:1' })
})

test('waitAnswer encodes the id and passes waitMs', async () => {
  const { calls, client } = recording([{ status: 200, text: '{"status":"pending"}' }])
  await client.waitAnswer('p:1', 20_000)
  expect(calls[0]!.path).toBe('/prompts/p%3A1?waitMs=20000')
})

test('empty-bodied endpoints resolve without parsing', async () => {
  const { client } = recording([{ status: 202, text: '' }, { status: 204, text: '' }])
  await client.report({ session: { sessionId: 's', cwd: '/' }, report: { kind: 'session_started' } })
  await client.ackInstruction('i1')
})

test('http errors and transport failures become BridgeError', async () => {
  const { client } = recording([{ status: 404, text: '' }])
  await expect(client.waitAnswer('x', 0)).rejects.toBeInstanceOf(BridgeError)
  const broken = new BridgeClient(async () => {
    throw new Error('ECONNREFUSED')
  })
  await expect(broken.instructions('s')).rejects.toBeInstanceOf(BridgeError)
})
```

- [ ] **Step 2: Write the failing flow tests**

`test/mod/flows.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { BridgeError } from '../../mod/remote-agent/hooks/bridge-client.ts'
import {
  askPermissionLocally,
  askQuestionsLocally,
  DismissedError,
  pollInstructions,
  resolvePrompt,
  shortSummary,
  type BridgePort,
  type InstructionState,
} from '../../mod/remote-agent/hooks/flows.ts'
import type { Answer, AnswerState, CreatePromptRequest, Instruction } from '../../mod/remote-agent/hooks/protocol.ts'

const request: CreatePromptRequest = { promptId: 'p:1', session: { sessionId: 's', cwd: '/' }, body: { kind: 'permission', tool: 'Bash', input: { command: 'ls' } } }
const allow: Answer = { kind: 'permission', decision: 'allow' }
const deny: Answer = { kind: 'permission', decision: 'deny' }
const never = <T>() => new Promise<T>(() => {})
const noSleep = async () => {}

class FakeBridge implements BridgePort {
  created = 0
  posted: Answer[] = []
  acked: string[] = []
  createFails = false
  waitQueue: (AnswerState | 'error' | 'hang')[] = []
  postResult: ((answer: Answer) => { accepted: boolean; state: AnswerState }) | null = null
  pending: Instruction[] = []

  async createPrompt(): Promise<AnswerState> {
    this.created += 1
    if (this.createFails) {
      throw new BridgeError('down')
    }
    return { status: 'pending' }
  }
  async waitAnswer(): Promise<AnswerState> {
    const next = this.waitQueue.shift() ?? 'hang'
    if (next === 'error') {
      throw new BridgeError('down')
    }
    if (next === 'hang') {
      return never<AnswerState>()
    }
    return next
  }
  async postLocalAnswer(_id: string, answer: Answer) {
    this.posted.push(answer)
    return this.postResult?.(answer) ?? { accepted: true, state: { status: 'answered' as const, answer, source: 'local' as const } }
  }
  async instructions(): Promise<Instruction[]> {
    return this.pending
  }
  async ackInstruction(id: string): Promise<void> {
    this.acked.push(id)
  }
}

function options(bridge: FakeBridge, localAsk: () => Promise<Answer>, signal = new AbortController().signal) {
  return { bridge, request, localAsk, signal, sleep: noSleep, retryDelayMs: 0 }
}

describe('resolvePrompt', () => {
  test('falls back when the bridge is unreachable', async () => {
    const bridge = new FakeBridge()
    bridge.createFails = true
    let asked = false
    const result = await resolvePrompt(options(bridge, async () => {
      asked = true
      return allow
    }))
    expect(result).toBeNull()
    expect(asked).toBe(false)
  })

  test('remote answer wins while the terminal is untouched', async () => {
    const bridge = new FakeBridge()
    bridge.waitQueue = [{ status: 'pending' }, { status: 'answered', answer: deny, source: 'remote' }]
    expect(await resolvePrompt(options(bridge, () => never<Answer>()))).toEqual(deny)
    expect(bridge.posted).toEqual([])
  })

  test('local answer wins and is posted to the bridge', async () => {
    const bridge = new FakeBridge()
    expect(await resolvePrompt(options(bridge, async () => allow))).toEqual(allow)
    expect(bridge.posted).toEqual([allow])
  })

  test('local answer loses to an earlier remote answer', async () => {
    const bridge = new FakeBridge()
    bridge.postResult = () => ({ accepted: false, state: { status: 'answered', answer: deny, source: 'remote' } })
    expect(await resolvePrompt(options(bridge, async () => allow))).toEqual(deny)
  })

  test('remote polling survives transient errors and re-registers the prompt', async () => {
    const bridge = new FakeBridge()
    bridge.waitQueue = ['error', { status: 'answered', answer: allow, source: 'remote' }]
    expect(await resolvePrompt({ ...options(bridge, () => never<Answer>()), maxFailures: 3 })).toEqual(allow)
    expect(bridge.created).toBe(2)
  })

  test('a dismissed permission dialog becomes a local deny', async () => {
    const bridge = new FakeBridge()
    const result = await resolvePrompt(options(bridge, async () => {
      throw new Error('dismissed')
    }))
    expect(result).toEqual({ kind: 'permission', decision: 'deny', message: 'Dismissed in the terminal.' })
  })

  test('a dismissed question throws DismissedError', async () => {
    const bridge = new FakeBridge()
    const question: CreatePromptRequest = { ...request, promptId: 'q:1', body: { kind: 'question', questions: [] } }
    await expect(
      resolvePrompt({ ...options(bridge, async () => { throw new Error('dismissed') }), request: question }),
    ).rejects.toBeInstanceOf(DismissedError)
    expect(bridge.posted).toEqual([{ kind: 'question', answers: {} }])
  })

  test('aborting the dispatch rejects', async () => {
    const bridge = new FakeBridge()
    const controller = new AbortController()
    const pending = resolvePrompt(options(bridge, () => never<Answer>(), controller.signal))
    controller.abort(new Error('interrupted'))
    await expect(pending).rejects.toThrow('interrupted')
  })
})

describe('local asks', () => {
  test('questions are asked in order and keyed by question text', async () => {
    const asked: string[] = []
    const ask = async (question: string, opts: { options: string[]; multiSelect?: true }) => {
      asked.push(`${question}|${opts.options.join('/')}|${opts.multiSelect === true}`)
      return opts.options[0]!
    }
    const answer = await askQuestionsLocally(ask, [
      { question: 'A?', header: 'A header that is long', multiSelect: false, options: [{ label: 'a1', description: '' }, { label: 'a2', description: '' }] },
      { question: 'B?', header: 'B', multiSelect: true, options: [{ label: 'b1', description: '' }, { label: 'b2', description: '' }] },
    ])()
    expect(answer).toEqual({ kind: 'question', answers: { 'A?': 'a1', 'B?': 'b1' } })
    expect(asked).toEqual(['A?|a1/a2|false', 'B?|b1/b2|true'])
  })

  test('permission: Allow, Deny, or free text as denial feedback', async () => {
    expect(await askPermissionLocally(async () => 'Allow', 'Bash', { command: 'ls' })()).toEqual(allow)
    expect(await askPermissionLocally(async () => 'Deny', 'Bash', { command: 'ls' })()).toEqual(deny)
    expect(await askPermissionLocally(async () => 'use pnpm', 'Bash', { command: 'npm i' })()).toEqual({ kind: 'permission', decision: 'deny', message: 'use pnpm' })
  })

  test('short summary is one line and bounded', () => {
    expect(shortSummary('Bash', { command: 'ls\n  -la' })).toBe('ls -la')
    expect(shortSummary('Edit', { file_path: '/a.ts' })).toBe('/a.ts')
    expect(shortSummary('X', { n: 1 })).toBe('{"n":1}')
    expect(shortSummary('Bash', { command: 'x'.repeat(500) }).length).toBe(161)
  })
})

describe('pollInstructions', () => {
  test('submits each instruction once and acknowledges it', async () => {
    const bridge = new FakeBridge()
    bridge.pending = [{ id: 'i1', sessionId: 's', text: 'go on' }]
    const state: InstructionState = { inFlight: new Set(), submitted: new Set() }
    const submitted: string[] = []
    await pollInstructions(bridge, 's', state, async text => {
      submitted.push(text)
    })
    expect(submitted).toEqual(['go on'])
    expect(bridge.acked).toEqual(['i1'])
  })

  test('does not resubmit while a submission is still waiting for the session to be idle', async () => {
    const bridge = new FakeBridge()
    bridge.pending = [{ id: 'i1', sessionId: 's', text: 'go on' }]
    const state: InstructionState = { inFlight: new Set(), submitted: new Set() }
    let calls = 0
    const submit = () => {
      calls += 1
      return never<void>()
    }
    void pollInstructions(bridge, 's', state, submit)
    await Bun.sleep(5)
    void pollInstructions(bridge, 's', state, submit)
    await Bun.sleep(5)
    expect(calls).toBe(1)
  })

  test('only retries the acknowledgement when ack failed after submit', async () => {
    const bridge = new FakeBridge()
    bridge.pending = [{ id: 'i1', sessionId: 's', text: 'go on' }]
    let failAck = true
    bridge.ackInstruction = async (id: string) => {
      if (failAck) {
        failAck = false
        throw new BridgeError('down')
      }
      bridge.acked.push(id)
    }
    const state: InstructionState = { inFlight: new Set(), submitted: new Set() }
    let submits = 0
    const submit = async () => {
      submits += 1
    }
    await pollInstructions(bridge, 's', state, submit)
    await pollInstructions(bridge, 's', state, submit)
    expect(submits).toBe(1)
    expect(bridge.acked).toEqual(['i1'])
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test test/mod`
Expected: FAIL, modules not found (protocol tests still pass)

- [ ] **Step 4: Implement the client**

`mod/remote-agent/hooks/bridge-client.ts`:

```ts
import type { Answer, AnswerResult, AnswerState, CreatePromptRequest, Instruction, ReportRequest } from './protocol.ts'

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

  instructions(sessionId: string): Promise<Instruction[]> {
    return this.json(`/sessions/${encodeURIComponent(sessionId)}/instructions`, 'GET')
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
```

- [ ] **Step 5: Implement the flows**

`mod/remote-agent/hooks/flows.ts`:

```ts
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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test test/mod && bun run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add mod/remote-agent/hooks/bridge-client.ts mod/remote-agent/hooks/flows.ts test/mod
git commit -m "feat: add mod bridge client and local/remote answer race"
```

---

### Task 13: Mod wiring, install and end-to-end check

**Files:**
- Create: `mod/remote-agent/.claude-plugin/plugin.json`, `mod/remote-agent/hooks/hooks.json`, `mod/remote-agent/hooks/register.ts`, `mod/.claude-plugin/marketplace.json`

**Interfaces:**
- Consumes: `BridgeClient`, `HttpPort` (Task 12); `resolvePrompt`, `askQuestionsLocally`, `askPermissionLocally`, `pollInstructions`, `DismissedError`, `InstructionState`, `AskPort`, `Sleep` (Task 12); `BRIDGE_ORIGIN`, `defaultSocketPath`, `SessionInfo` (Task 3); the engine's `EngineInterface` and `Register` from `'claude-code'`
- Produces: the installed `remote-agent` plugin

- [ ] **Step 1: Write the manifests**

`mod/remote-agent/.claude-plugin/plugin.json`:

```json
{ "name": "remote-agent", "version": "0.1.0", "description": "Relays Prompts and Reports from every Claude Code session to the remote-agent Bridge (Telegram), and Answers and Instructions back." }
```

`mod/remote-agent/hooks/hooks.json`:

```json
{ "modules": ["./register.ts"] }
```

`mod/.claude-plugin/marketplace.json`:

```json
{
  "name": "remote-agent-local",
  "owner": { "name": "Muhammad Zhafarudin" },
  "plugins": [{ "name": "remote-agent", "source": "./remote-agent" }]
}
```

- [ ] **Step 2: Write the hooks module**

Spike results (`references/spike-results.md`) are already applied below: `tool_use_id` is present (no promptId fallback), `sleepPort` stays on `$.clock.sleep` (E7: `clock.after` waits count against the 10 s budget), AskUserQuestion is answered by returning `{ result }` (E12), and the `tool.check` AskUserQuestion guard is required (E9).

`mod/remote-agent/hooks/register.ts`:

```ts
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

export const register: Register = on => {
  const instructionState: InstructionState = { inFlight: new Set(), submitted: new Set(), delivered: new Set() }
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
```

- [ ] **Step 3: Validate the mod**

Run: `claude plugin validate mod/remote-agent && claude plugin validate mod`
Expected: no errors. Hooks are listed on `session.start`, `session.end`, `turn.complete`, `tool.call` (AskUserQuestion) and `tool.check`. The marketplace lists `remote-agent`. Fix every reported problem before going on.

- [ ] **Step 4: Type-check the mod with the engine's types**

Run: `claude --plugin-dir /home/giganotosaurus/Sites/remote-agent/mod/remote-agent -p "reply ok"`. This lays down `mod/remote-agent/.claude-plugin/types/`, which is git-ignored. Then run `bunx tsc -p mod/remote-agent`.
Expected: no type errors. If the `types/` folder or `tsconfig.json` is not laid down by a `-p` run, use the fallback the plugin-authoring skill describes. Write a `tsconfig.json` in the scratchpad that `include`s the bundled `claude-code.d.ts` and `mod/remote-agent/hooks/*.ts`, and run `bunx tsc -p <that file>`.

- [ ] **Step 5: Run the whole test suite**

Run: `bun test && bun run typecheck`
Expected: all PASS

- [ ] **Step 6: Install at user scope**

```bash
claude plugin marketplace add /home/giganotosaurus/Sites/remote-agent/mod
claude plugin install remote-agent@remote-agent-local --scope user
claude plugin list
```

Expected: `remote-agent` is listed, with `Read from: /home/giganotosaurus/Sites/remote-agent/mod/remote-agent`. New sessions load it automatically. Already-running sessions load it after `/reload-plugins`.

- [ ] **Step 7: End-to-end check (human partner, Bridge running from Task 11)**

| # | Do | Expected |
|---|---|---|
| 1 | Start `claude` in some project | With Away mode on, the topic `<project> · <id8>` appears with "🟢 Session started" |
| 2 | Ask: `Use AskUserQuestion to ask me SQLite or Postgres.` Tap **Postgres** in Telegram | Claude continues with Postgres. Telegram buttons are removed and "✅ Answered (remote): Postgres" is posted |
| 3 | Same, but answer in the terminal | "✅ Answered (local): …" is posted in Telegram |
| 4 | Ask Claude to run `touch /tmp/ra-$RANDOM` in default permission mode. Reply `use mkdir instead` in Telegram | Claude is denied with that feedback, and Telegram shows "❌ Denied (remote): use mkdir instead" |
| 5 | Leave a Permission Request unanswered with `REMOTE_AGENT_REMINDER_MINUTES=1` | One "⏰ Still waiting…" reply after about 1–2 min |
| 6 | When the turn ends, type `now list the files` in the topic | "📥 Queued…", then a new user turn in the terminal and "📨 Delivered: now list the files" |
| 7 | Run `systemctl --user stop remote-agent`, then trigger a Permission Request | Stock local behaviour, with no hang |
| 8 | `/back`, finish a turn | No turn Report. Prompts still arrive |
| 9 | `/exit` the session | With Away mode on, "⚪ Session ended (…)" and the topic closes |

Record anything that deviates in `references/spike-results.md` under "E2E findings", and update README "Known limitations".

- [ ] **Step 8: Commit**

```bash
git add mod README.md references/spike-results.md
git commit -m "feat: wire remote-agent mod into claude code sessions"
```
