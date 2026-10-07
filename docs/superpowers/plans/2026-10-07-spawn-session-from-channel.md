# Spawn a Session from the Channel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/new` in Telegram starts an interactive `claude` in a detached tmux session in a trusted folder; the user steers it from its Thread, attaches with `tmux attach`, and can `/end` it.

**Architecture:** Three new Bridge modules: `TrustedFolders` (reads `~/.claude.json`), `Launcher` (all `systemd-run`/tmux calls over an injected `run(argv)`), and `Spawner` (the use case: picker, start, ready, timeout, end, reconcile). The Channel contract grows a tagged `ButtonData` union, command args and `sendButtons`. The mod is unchanged: a spawned `claude` connects like any Session, and any mod request marks a Spawned Session as started.

**Tech Stack:** Bun 1.x, TypeScript (strict, `noUncheckedIndexedAccess`), `bun:sqlite`, grammY, zod 3, `bun test`.

**Spec:** `docs/superpowers/specs/2026-10-07-spawn-session-from-channel-design.md` (decision: `docs/adr/0003-spawned-sessions-in-tmux.md`, glossary: `CONTEXT.md`)

## Global Constraints

- Allowed directory = exact match (after `~` expansion, `realpath`, trailing-slash strip) with a `~/.claude.json` `projects` key whose `hasTrustDialogAccepted` is `true`. Subfolders and relative paths are refused.
- Launch argv (array, never a shell): `systemd-run --user --scope --quiet --collect tmux new-session -d -s ra-<sessionId[0:8]> -c <cwd> claude --session-id <sessionId>`. No `--permission-mode` flag.
- Startup timeout `30_000` ms; `/end` grace `5_000` ms; pane capture keeps the last `15` lines.
- Thread title for a Spawned Session is the existing `<project> · <sessionId[0:8]>` (`threadTitle`). The Thread is created **before** launch.
- Messages (exact): `⏳ Starting… attach with: tmux attach -t <name>`, `✅ Ready. Send your task here.`, `Not a trusted folder. Open it once in Claude Code locally and accept the trust dialog.`, `Project list changed. Send /new again.`, `Can't read Claude Code's trusted folders.`, `Only sessions started from Telegram can be ended remotely.`
- Everything posted from pane captures or launch errors goes through `redactSecrets` + `truncate`.
- TypeScript style: never `if (x) return`; always braces (CLAUDE.md). Match the surrounding code: no semicolons, single quotes, 2-space indent.
- Commit messages: conventional (`feat:`, `fix:`, `docs:`, `test:`), **no `Co-Authored-By` line** (CLAUDE.md).
- After every task: `bun test` and `bun run typecheck` both clean.

## Review Focus

1. **A path with spaces in `/new`** (`/new ~/Sites/My Projects/app`): the whole remainder is one path, passed as one argv element; expected to launch in that folder. Test in Task 7.
2. **Telegram fails to create the Thread**: expected no tmux launch and the Session row ended, so no orphan `claude` and no stale active Session. Test in Task 7.
3. **Several mod requests arrive at once for a new Spawned Session** (instruction poll + `session_started` Report): expected exactly one `✅ Ready`. Test in Task 7.
4. **`/end` sent twice within the 5 s grace**: expected the second reply `⏹ Already ending.` and a single `/exit` keystroke. Test in Task 8.
5. **Relative path or `~user` path in `/new`** (`/new remote-agent`): must not be resolved against the Bridge's working directory; expected the not-trusted reply. Test in Task 4.

---

### Task 1: Store — Spawned Session columns

**Files:**
- Modify: `src/bridge/store.ts`
- Modify: `test/bridge/store.test.ts`, `test/bridge/views.test.ts` (fixtures gain the new fields)

**Interfaces:**
- Produces:
  - `SessionRow` gains `spawned: boolean; tmuxName: string | null; startedAt: number | null`
  - `Store.createSpawnedSession(spawn: { id: string; cwd: string; tmuxName: string }): SessionRow`
  - `Store.markSpawnedStarted(id: string): boolean` — true only on the first call for a spawned Session

- [ ] **Step 1: Write the failing tests** — append to `test/bridge/store.test.ts`:

```ts
test('createSpawnedSession records the tmux name and is not started yet', () => {
  const row = store.createSpawnedSession({ id: 'sp1', cwd: '/home/u/Sites/api', tmuxName: 'ra-sp1' })
  expect(row).toEqual({
    id: 'sp1', cwd: '/home/u/Sites/api', project: 'api', threadId: null, title: null, endedAt: null,
    spawned: true, tmuxName: 'ra-sp1', startedAt: null,
  })
})

test('upsertSession from the mod keeps the spawn fields and the thread', () => {
  store.createSpawnedSession({ id: 'sp1', cwd: '/home/u/Sites/api', tmuxName: 'ra-sp1' })
  store.setSessionThread('sp1', 't1')
  store.markSpawnedStarted('sp1')
  const row = store.upsertSession({ sessionId: 'sp1', cwd: '/home/u/Sites/api' })
  expect(row).toMatchObject({ threadId: 't1', spawned: true, tmuxName: 'ra-sp1', startedAt: 1_000 })
})

test('markSpawnedStarted is true once, and never for a terminal-started session', () => {
  store.createSpawnedSession({ id: 'sp1', cwd: '/home/u/Sites/api', tmuxName: 'ra-sp1' })
  expect(store.markSpawnedStarted('sp1')).toBe(true)
  expect(store.markSpawnedStarted('sp1')).toBe(false)
  expect(store.markSpawnedStarted('s1')).toBe(false)
})

test('an existing database gains the spawn columns', async () => {
  const { Database } = await import('bun:sqlite')
  const { mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const path = `${await mkdtemp(`${tmpdir()}/ra-store-`)}/old.db`
  const old = new Database(path, { create: true })
  old.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT NOT NULL, project TEXT NOT NULL, thread_id TEXT, created_at INTEGER NOT NULL, ended_at INTEGER)')
  old.exec("INSERT INTO sessions (id, cwd, project, created_at) VALUES ('o1', '/x/app', 'app', 1)")
  old.close()
  const migrated = new Store(path)
  expect(migrated.getSession('o1')).toMatchObject({ spawned: false, tmuxName: null, startedAt: null, title: null })
  migrated.close()
})
```

Update the existing expectation in `test/bridge/store.test.ts` (`upsertSession derives the project…`):

```ts
  expect(reopened).toEqual({ id: 's1', cwd: '/home/u/Sites/app', project: 'app', threadId: null, title: null, endedAt: null, spawned: false, tmuxName: null, startedAt: null })
```

Update the fixture in `test/bridge/views.test.ts` line 6:

```ts
const session: SessionRow = { id: 'abcdef1234567890', cwd: '/home/u/app', project: 'app', threadId: null, title: null, endedAt: null, spawned: false, tmuxName: null, startedAt: null }
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/bridge/store.test.ts`
Expected: FAIL — `store.createSpawnedSession is not a function`, and the `toEqual` on `reopened` fails on missing keys.

- [ ] **Step 3: Implement** in `src/bridge/store.ts`:

```ts
export type SessionRow = {
  id: string
  cwd: string
  project: string
  threadId: string | null
  title: string | null
  endedAt: number | null
  spawned: boolean
  tmuxName: string | null
  startedAt: number | null
}
```

```ts
type SessionRecord = {
  id: string
  cwd: string
  project: string
  thread_id: string | null
  title: string | null
  ended_at: number | null
  spawned: number
  tmux_name: string | null
  started_at: number | null
}
```

```ts
const SESSION_COLUMNS = 'id, cwd, project, thread_id, title, ended_at, spawned, tmux_name, started_at'
```

```ts
function toSession(record: SessionRecord): SessionRow {
  return {
    id: record.id,
    cwd: record.cwd,
    project: record.project,
    threadId: record.thread_id,
    title: record.title,
    endedAt: record.ended_at,
    spawned: record.spawned === 1,
    tmuxName: record.tmux_name,
    startedAt: record.started_at,
  }
}
```

Replace `migrate()`:

```ts
  private migrate(): void {
    const columns = new Set(this.db.query<{ name: string }, []>('PRAGMA table_info(sessions)').all().map(column => column.name))
    const added: [string, string][] = [
      ['title', 'title TEXT'],
      ['spawned', 'spawned INTEGER NOT NULL DEFAULT 0'],
      ['tmux_name', 'tmux_name TEXT'],
      ['started_at', 'started_at INTEGER'],
    ]
    for (const [name, definition] of added) {
      if (!columns.has(name)) {
        this.db.exec(`ALTER TABLE sessions ADD COLUMN ${definition}`)
      }
    }
  }
```

Add after `upsertSession` (the existing `ON CONFLICT … DO UPDATE` only touches `cwd`, `project`, `ended_at`, so it already keeps the new columns; the test pins that):

```ts
  createSpawnedSession(spawn: { id: string; cwd: string; tmuxName: string }): SessionRow {
    this.db
      .query('INSERT INTO sessions (id, cwd, project, created_at, spawned, tmux_name) VALUES (?, ?, ?, ?, 1, ?)')
      .run(spawn.id, spawn.cwd, projectName(spawn.cwd), this.now(), spawn.tmuxName)
    const session = this.getSession(spawn.id)
    if (session === undefined) {
      throw new Error(`Session ${spawn.id} vanished after insert`)
    }
    return session
  }

  /** True only for the first call on a Spawned Session, so concurrent mod requests post one Ready. */
  markSpawnedStarted(id: string): boolean {
    const result = this.db
      .query('UPDATE sessions SET started_at = ? WHERE id = ? AND spawned = 1 AND started_at IS NULL')
      .run(this.now(), id)
    return result.changes === 1
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test && bun run typecheck`
Expected: all tests pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/bridge/store.ts test/bridge/store.test.ts test/bridge/views.test.ts
git commit -m "feat: store spawned sessions with their tmux name and start time"
```

---

### Task 2: Channel contract — launch buttons, command args, `sendButtons`

**Files:**
- Modify: `src/channel/types.ts`, `src/channel/telegram/render.ts`, `src/channel/telegram/updates.ts`, `src/channel/telegram/adapter.ts`, `src/bridge/views.ts`, `src/bridge/inbound.ts`
- Modify: `test/support/fake-channel.ts`
- Test: `test/channel/telegram.test.ts`, plus mechanical updates to `test/bridge/inbound.test.ts`, `test/bridge/http.test.ts`, `test/bridge/views.test.ts`

**Interfaces:**
- Produces:
  - `AnswerButton = { kind: 'answer'; promptId: string; questionIndex: number; optionIndex: number }`
  - `LaunchButton = { kind: 'launch'; pickerId: string; choice: number }`
  - `ButtonData = AnswerButton | LaunchButton`
  - `InboundCommand = { name: string; args: string; thread: ThreadRef | null }`
  - `ChannelHandlers.onCommand(command): Promise<string | null>` (null = no reply)
  - `Channel.sendButtons(thread: ThreadRef | null, text: string, buttons: { label: string; data: ButtonData }[]): Promise<MessageRef>`
  - `FakeChannel.buttons: { thread: ThreadRef | null; text: string; buttons: { label: string; data: ButtonData }[] }[]`, `FakeChannel.createThreadFails: boolean`
  - `parseCommand(text): { name: string; args: string } | undefined`

- [ ] **Step 1: Mechanical test updates** (existing answer buttons gain `kind: 'answer'`; commands gain `args`):

```bash
sed -i "s/{ promptId: \([^,]*\), questionIndex/{ kind: 'answer', promptId: \1, questionIndex/g" test/bridge/inbound.test.ts test/bridge/http.test.ts test/bridge/views.test.ts test/channel/telegram.test.ts
sed -i "s/onCommand({ name: \('[a-z]*'\), thread: null })/onCommand({ name: \1, args: '', thread: null })/g" test/bridge/inbound.test.ts
git diff --stat test
```

Expected: only the four test files change; `grep -n "promptId:" test/bridge/http.test.ts` still shows `promptId: 'p:toolu_1', session` (request bodies, untouched, because they are not followed by `questionIndex`).

- [ ] **Step 2: Write the failing tests** — in `test/channel/telegram.test.ts`, replace the `parseCommand` expectations and add to `describe('buttons')`:

```ts
    expect(parseCommand('/status')).toEqual({ name: 'status', args: '' })
    expect(parseCommand('/away@my_bot now')).toEqual({ name: 'away', args: 'now' })
    expect(parseCommand('/new  ~/Sites/My Projects/app  ')).toEqual({ name: 'new', args: '~/Sites/My Projects/app' })
    expect(parseCommand('hello /status')).toBeUndefined()
```

```ts
  test('launch buttons round-trip and never collide with answer buttons', () => {
    const launch = { kind: 'launch' as const, pickerId: '3f2a9c1b', choice: 4 }
    expect(encodeButton(launch)).toBe('launch:3f2a9c1b:4')
    expect(decodeButton('launch:3f2a9c1b:4')).toEqual(launch)
    const answer = { kind: 'answer' as const, promptId: 'launch:x', questionIndex: 0, optionIndex: 1 }
    expect(decodeButton(encodeButton(answer))).toEqual(answer)
  })
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test test/channel/telegram.test.ts`
Expected: FAIL — `args` missing from `parseCommand`, `kind` missing from decoded buttons.

- [ ] **Step 4: Implement**

`src/channel/types.ts` — replace the button and command types and extend the interfaces:

```ts
export type AnswerButton = { kind: 'answer'; promptId: string; questionIndex: number; optionIndex: number }
/** A tap on a project in the /new picker. `choice` indexes the picker's project list. */
export type LaunchButton = { kind: 'launch'; pickerId: string; choice: number }
export type ButtonData = AnswerButton | LaunchButton
export type Button = { label: string; data: ButtonData }
export type PromptViewItem = { text: string; buttons: { label: string; data: AnswerButton }[] }
export type PromptView = { promptId: string; title: string; items: PromptViewItem[] }

export type InboundText = { thread: ThreadRef | null; replyTo: MessageRef | null; text: string }
/** `args` is the text after the command, trimmed. */
export type InboundCommand = { name: string; args: string; thread: ThreadRef | null }
```

In `ChannelHandlers`:

```ts
  /** Returns a reply to post, or null for none. */
  onCommand(command: InboundCommand): Promise<string | null>
```

In `Channel`, after `sendText`:

```ts
  /** Sends one message with one button per row. */
  sendButtons(thread: ThreadRef | null, text: string, buttons: Button[]): Promise<MessageRef>
```

`src/channel/telegram/render.ts`:

```ts
import type { Button, ButtonData } from '../types.ts'

export function encodeButton(data: ButtonData): string {
  const raw = data.kind === 'answer' ? `${data.promptId}|${data.questionIndex}|${data.optionIndex}` : `launch:${data.pickerId}:${data.choice}`
  if (new TextEncoder().encode(raw).length > MAX_CALLBACK_BYTES) {
    throw new Error(`callback_data exceeds ${MAX_CALLBACK_BYTES} bytes: ${raw}`)
  }
  return raw
}

// Answer buttons always contain '|', launch buttons never do, so the two formats cannot collide.
export function decodeButton(raw: string): ButtonData | undefined {
  const launch = /^launch:([A-Za-z0-9-]+):(\d+)$/.exec(raw)
  if (launch !== null) {
    return { kind: 'launch', pickerId: launch[1] ?? '', choice: Number(launch[2]) }
  }
  const match = /^(.+)\|(\d+)\|(\d+)$/.exec(raw)
  if (match === null) {
    return undefined
  }
  return { kind: 'answer', promptId: match[1] ?? '', questionIndex: Number(match[2]), optionIndex: Number(match[3]) }
}

export function keyboard(item: { buttons: Button[] }): { inline_keyboard: { text: string; callback_data: string }[][] } {
  return { inline_keyboard: item.buttons.map(button => [{ text: button.label, callback_data: encodeButton(button.data) }]) }
}
```

(Remove the now-unused `PromptViewItem` import from `render.ts`.)

`src/channel/telegram/updates.ts`:

```ts
export function parseCommand(text: string): { name: string; args: string } | undefined {
  const match = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text)
  if (match === null) {
    return undefined
  }
  return { name: (match[1] ?? '').toLowerCase(), args: (match[2] ?? '').trim() }
}
```

`src/channel/telegram/adapter.ts` — pass args, register commands, add `sendButtons`:

```ts
        : await handlers.onCommand({ name: command.name, args: command.args, thread })
```

```ts
    await this.bot.api.setMyCommands([
      { command: 'new', description: 'Start a session (pick a project or give a trusted path)' },
      { command: 'end', description: 'End the session started from Telegram in this topic' },
      { command: 'away', description: 'Send prompts and reports' },
      { command: 'back', description: 'Send prompts only' },
      { command: 'status', description: 'Show sessions and pending prompts' },
    ])
```

```ts
  async sendButtons(thread: ThreadRef | null, text: string, buttons: Button[]): Promise<MessageRef> {
    const message = await this.bot.api.sendMessage(this.config.chatId, renderHtml(null, text), {
      parse_mode: 'HTML',
      message_thread_id: thread === null ? undefined : Number(thread),
      reply_markup: keyboard({ buttons }),
    })
    return String(message.message_id)
  }
```

(Add `Button` to the `../types.ts` import in `adapter.ts`.)

`src/bridge/views.ts` — the four `data: { promptId…` literals gain the tag:

```bash
sed -i "s/data: { promptId/data: { kind: 'answer', promptId/g" src/bridge/views.ts
```

`src/bridge/inbound.ts` — narrow the union and allow a null reply:

```ts
  async onButton(press: ButtonData): Promise<string> {
    if (press.kind !== 'answer') {
      return 'Unknown button.'
    }
    const prompt = this.store.getPrompt(press.promptId)
```

```ts
  async onCommand(command: InboundCommand): Promise<string | null> {
```

(Task 9 replaces the `press.kind !== 'answer'` branch with real launch handling.)

`test/support/fake-channel.ts` — add (import `Button` from the types):

```ts
  buttons: { thread: ThreadRef | null; text: string; buttons: Button[] }[] = []
  createThreadFails = false
```

At the top of `createThread`:

```ts
    if (this.createThreadFails) {
      throw new Error('createForumTopic failed')
    }
```

And the method:

```ts
  async sendButtons(thread: ThreadRef | null, text: string, buttons: Button[]): Promise<MessageRef> {
    this.buttons.push({ thread, text, buttons })
    return `m${this.nextId++}`
  }
```

- [ ] **Step 5: Run to verify pass**

Run: `bun test && bun run typecheck`
Expected: all pass, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/channel src/bridge/views.ts src/bridge/inbound.ts test
git commit -m "feat: let the channel carry launch buttons, command arguments and button messages"
```

---

### Task 3: Config — projects and Claude config path

**Files:**
- Modify: `src/bridge/config.ts`
- Test: `test/bridge/config.test.ts`

**Interfaces:**
- Produces: `Config` gains `home: string; projects: string[]; claudeConfigPath: string`; exports `STARTUP_TIMEOUT_MS = 30_000`, `END_GRACE_MS = 5_000`

- [ ] **Step 1: Write the failing tests** — update the first expectation in `test/bridge/config.test.ts` and add one test:

```ts
test('loads a valid environment with defaults', () => {
  expect(loadConfig(base)).toEqual({
    botToken: '123456:ABC-def_ghi',
    chatId: -1001234567890,
    allowedUserId: 42,
    socketPath: '/run/user/1000/remote-agent/bridge.sock',
    dbPath: '/home/u/.local/state/remote-agent/bridge.db',
    reminderAfterMs: 30 * 60_000,
    home: '/home/u',
    projects: [],
    claudeConfigPath: '/home/u/.claude.json',
  })
})

test('reads the project list and the Claude config path', () => {
  const config = loadConfig({ ...base, REMOTE_AGENT_PROJECTS: ' ~/Sites/api , /srv/app,, ', CLAUDE_CONFIG_PATH: '/tmp/claude.json' })
  expect(config.projects).toEqual(['~/Sites/api', '/srv/app'])
  expect(config.claudeConfigPath).toBe('/tmp/claude.json')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/bridge/config.test.ts`
Expected: FAIL — missing `home`, `projects`, `claudeConfigPath`.

- [ ] **Step 3: Implement** in `src/bridge/config.ts`:

```ts
export const STARTUP_TIMEOUT_MS = 30_000
export const END_GRACE_MS = 5_000

export type Config = {
  botToken: string
  chatId: number
  allowedUserId: number
  socketPath: string
  dbPath: string
  reminderAfterMs: number
  home: string
  /** Raw entries; `~` is expanded by TrustedFolders. */
  projects: string[]
  claudeConfigPath: string
}
```

In `EnvSchema` add:

```ts
  REMOTE_AGENT_PROJECTS: z.string().optional(),
  CLAUDE_CONFIG_PATH: z.string().optional(),
```

In the returned object add:

```ts
    home: values.HOME,
    projects: (values.REMOTE_AGENT_PROJECTS ?? '').split(',').map(entry => entry.trim()).filter(entry => entry !== ''),
    claudeConfigPath: values.CLAUDE_CONFIG_PATH ?? `${values.HOME}/.claude.json`,
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test && bun run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/bridge/config.ts test/bridge/config.test.ts
git commit -m "feat: configure the projects offered by /new and the claude config path"
```

---

### Task 4: `TrustedFolders`

**Files:**
- Create: `src/bridge/trusted.ts`
- Test: `test/bridge/trusted.test.ts`

**Interfaces:**
- Produces:
  - `class TrustedFoldersUnavailable extends Error`
  - `type Project = { label: string; cwd: string }`
  - `class TrustedFolders { constructor(options: { configPath: string; home: string; projects: string[] }); isTrusted(path: string): Promise<string | null>; configuredProjects(): Promise<Project[]>; untrustedProjects(): Promise<string[]> }`
  - `isTrusted` returns the normalised real path or `null`; throws `TrustedFoldersUnavailable` when the config file cannot be read or parsed.

- [ ] **Step 1: Write the failing tests** — `test/bridge/trusted.test.ts`:

```ts
import { beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { TrustedFolders, TrustedFoldersUnavailable } from '../../src/bridge/trusted.ts'

let home: string
let configPath: string

async function trust(entries: Record<string, boolean>): Promise<void> {
  const projects = Object.fromEntries(Object.entries(entries).map(([path, accepted]) => [path, { hasTrustDialogAccepted: accepted }]))
  await writeFile(configPath, JSON.stringify({ projects }))
}

function folders(projects: string[] = []): TrustedFolders {
  return new TrustedFolders({ configPath, home, projects })
}

beforeEach(async () => {
  home = await realpath(await mkdtemp(`${tmpdir()}/ra-trusted-`))
  configPath = `${home}/.claude.json`
  await mkdir(`${home}/Sites/api/src`, { recursive: true })
  await mkdir(`${home}/Sites/My Projects/app`, { recursive: true })
  await mkdir(`${home}/Sites/secret`, { recursive: true })
  await trust({ [`${home}/Sites/api`]: true, [`${home}/Sites/My Projects/app/`]: true, [`${home}/Sites/secret`]: false })
})

test('exact trusted folders are accepted, with ~ and a trailing slash', async () => {
  expect(await folders().isTrusted(`${home}/Sites/api`)).toBe(`${home}/Sites/api`)
  expect(await folders().isTrusted('~/Sites/api/')).toBe(`${home}/Sites/api`)
  expect(await folders().isTrusted('~/Sites/My Projects/app')).toBe(`${home}/Sites/My Projects/app`)
})

test('subfolders, untrusted, missing, relative and ~user paths are refused', async () => {
  expect(await folders().isTrusted('~/Sites/api/src')).toBeNull()
  expect(await folders().isTrusted('~/Sites/secret')).toBeNull()
  expect(await folders().isTrusted('~/Sites/nope')).toBeNull()
  expect(await folders().isTrusted('Sites/api')).toBeNull()
  expect(await folders().isTrusted('~root/Sites/api')).toBeNull()
})

test('a symlink to a trusted folder resolves to it', async () => {
  await symlink(`${home}/Sites/api`, `${home}/api-link`)
  expect(await folders().isTrusted('~/api-link')).toBe(`${home}/Sites/api`)
})

test('configured projects keep their order and drop untrusted entries', async () => {
  const trusted = folders(['~/Sites/My Projects/app', '~/Sites/secret', '~/Sites/api'])
  expect(await trusted.configuredProjects()).toEqual([
    { label: 'app', cwd: `${home}/Sites/My Projects/app` },
    { label: 'api', cwd: `${home}/Sites/api` },
  ])
  expect(await trusted.untrustedProjects()).toEqual(['~/Sites/secret'])
})

test('an unreadable or invalid config is reported', async () => {
  await writeFile(configPath, '{not json')
  await expect(folders().isTrusted('~/Sites/api')).rejects.toBeInstanceOf(TrustedFoldersUnavailable)
  const missing = new TrustedFolders({ configPath: `${home}/none.json`, home, projects: [] })
  await expect(missing.isTrusted('~/Sites/api')).rejects.toBeInstanceOf(TrustedFoldersUnavailable)
})

test('a config without projects trusts nothing', async () => {
  await writeFile(configPath, '{}')
  expect(await folders().isTrusted('~/Sites/api')).toBeNull()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/bridge/trusted.test.ts`
Expected: FAIL — `Cannot find module '../../src/bridge/trusted.ts'`.

- [ ] **Step 3: Implement** — `src/bridge/trusted.ts`:

```ts
import { readFile, realpath } from 'node:fs/promises'
import { basename, isAbsolute, resolve } from 'node:path'

/** Claude Code's config could not be read, so nothing can be checked. */
export class TrustedFoldersUnavailable extends Error {}

export type Project = { label: string; cwd: string }

type Options = { configPath: string; home: string; projects: string[] }

function expandHome(path: string, home: string): string {
  if (path === '~') {
    return home
  }
  if (path.startsWith('~/')) {
    return `${home}${path.slice(1)}`
  }
  return path
}

/** Absolute, symlink-free, no trailing slash; null for relative or missing paths. */
async function normalise(path: string, home: string): Promise<string | null> {
  const expanded = expandHome(path.trim(), home)
  if (!isAbsolute(expanded)) {
    return null
  }
  try {
    return await realpath(resolve(expanded))
  } catch {
    return null
  }
}

/** The folders where the user accepted Claude Code's trust dialog: the only places a Spawned Session may start. */
export class TrustedFolders {
  constructor(private readonly options: Options) {}

  async isTrusted(path: string): Promise<string | null> {
    return this.match(await this.load(), path)
  }

  async configuredProjects(): Promise<Project[]> {
    const trusted = await this.load()
    const projects: Project[] = []
    for (const entry of this.options.projects) {
      const cwd = await this.match(trusted, entry)
      if (cwd !== null) {
        projects.push({ label: basename(cwd), cwd })
      }
    }
    return projects
  }

  async untrustedProjects(): Promise<string[]> {
    const trusted = await this.load()
    const untrusted: string[] = []
    for (const entry of this.options.projects) {
      if ((await this.match(trusted, entry)) === null) {
        untrusted.push(entry)
      }
    }
    return untrusted
  }

  private async match(trusted: Set<string>, path: string): Promise<string | null> {
    const cwd = await normalise(path, this.options.home)
    if (cwd === null || !trusted.has(cwd)) {
      return null
    }
    return cwd
  }

  /** Read fresh every time: folders trusted since the Bridge started count immediately. */
  private async load(): Promise<Set<string>> {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(this.options.configPath, 'utf8'))
    } catch (error) {
      throw new TrustedFoldersUnavailable(`Cannot read ${this.options.configPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
    const projects = typeof parsed === 'object' && parsed !== null ? (parsed as { projects?: unknown }).projects : undefined
    const trusted = new Set<string>()
    if (typeof projects !== 'object' || projects === null) {
      return trusted
    }
    for (const [path, entry] of Object.entries(projects)) {
      if (typeof entry !== 'object' || entry === null || (entry as { hasTrustDialogAccepted?: unknown }).hasTrustDialogAccepted !== true) {
        continue
      }
      const cwd = await normalise(path, this.options.home)
      if (cwd !== null) {
        trusted.add(cwd)
      }
    }
    return trusted
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test && bun run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/bridge/trusted.ts test/bridge/trusted.test.ts
git commit -m "feat: check folders against claude code's trusted folders"
```

---

### Task 5: `Launcher` (tmux over `systemd-run`)

**Files:**
- Create: `src/bridge/launcher.ts`
- Create: `test/support/fake-tmux.ts`
- Test: `test/bridge/launcher.test.ts`

**Interfaces:**
- Produces:
  - `type RunResult = { code: number; stdout: string; stderr: string }`, `type Run = (argv: string[]) => Promise<RunResult>`, `const runCommand: Run`
  - `class LaunchError extends Error`
  - `function tmuxNameFor(sessionId: string): string` → `ra-<first 8 chars>`
  - `class Launcher { constructor(run?: Run); launch(spec: { sessionId: string; cwd: string }): Promise<{ tmuxName: string }>; exists(name: string): Promise<boolean>; capture(name: string, lines: number): Promise<string>; sendExit(name: string): Promise<void>; kill(name: string): Promise<void> }`
  - `class FakeTmux { calls: string[][]; alive: Set<string>; launchFails: string | null; exitWorks: boolean; screen: string; run: Run }` (test support, reused by Tasks 7–8)

- [ ] **Step 1: Write the fake** — `test/support/fake-tmux.ts`:

```ts
import type { Run, RunResult } from '../../src/bridge/launcher.ts'

const OK: RunResult = { code: 0, stdout: '', stderr: '' }

function missing(name: string): RunResult {
  return { code: 1, stdout: '', stderr: `can't find session: ${name}` }
}

/** Simulates systemd-run + tmux: tracks which tmux sessions are alive. */
export class FakeTmux {
  calls: string[][] = []
  alive = new Set<string>()
  launchFails: string | null = null
  /** When false, `/exit` is ignored and only kill-session ends the session. */
  exitWorks = true
  screen = ''

  run: Run = async argv => {
    this.calls.push(argv)
    if (argv[0] === 'systemd-run') {
      if (this.launchFails !== null) {
        return { code: 1, stdout: '', stderr: this.launchFails }
      }
      this.alive.add(argv[argv.indexOf('-s') + 1] ?? '')
      return OK
    }
    const target = (argv[argv.indexOf('-t') + 1] ?? '').replace(/^=/, '')
    if (argv[1] === 'has-session') {
      return this.alive.has(target) ? OK : missing(target)
    }
    if (argv[1] === 'kill-session') {
      return this.alive.delete(target) ? OK : missing(target)
    }
    if (argv[1] === 'send-keys') {
      if (this.exitWorks) {
        this.alive.delete(target)
      }
      return OK
    }
    if (argv[1] === 'capture-pane') {
      return { code: 0, stdout: this.screen, stderr: '' }
    }
    return { code: 1, stdout: '', stderr: `unexpected: ${argv.join(' ')}` }
  }

  commands(): string[] {
    return this.calls.map(argv => (argv[0] === 'systemd-run' ? 'launch' : argv[1] ?? ''))
  }
}
```

- [ ] **Step 2: Write the failing tests** — `test/bridge/launcher.test.ts`:

```ts
import { beforeEach, expect, test } from 'bun:test'
import { LaunchError, Launcher, runCommand, tmuxNameFor } from '../../src/bridge/launcher.ts'
import { FakeTmux } from '../support/fake-tmux.ts'

const id = '3f2a9c1b-0000-4000-8000-000000000000'
let tmux: FakeTmux
let launcher: Launcher

beforeEach(() => {
  tmux = new FakeTmux()
  launcher = new Launcher(tmux.run)
})

test('tmux names use the first 8 characters of the session id', () => {
  expect(tmuxNameFor(id)).toBe('ra-3f2a9c1b')
})

test('launch runs claude in a detached tmux session in its own systemd scope', async () => {
  expect(await launcher.launch({ sessionId: id, cwd: '/home/u/Sites/My Projects/app' })).toEqual({ tmuxName: 'ra-3f2a9c1b' })
  expect(tmux.calls[0]).toEqual([
    'systemd-run', '--user', '--scope', '--quiet', '--collect',
    'tmux', 'new-session', '-d', '-s', 'ra-3f2a9c1b', '-c', '/home/u/Sites/My Projects/app',
    'claude', '--session-id', id,
  ])
})

test('a failed launch throws a redacted LaunchError', async () => {
  tmux.launchFails = 'Failed to connect to bus: token=abcdef123456'
  const failure = launcher.launch({ sessionId: id, cwd: '/x' })
  await expect(failure).rejects.toBeInstanceOf(LaunchError)
  await expect(failure).rejects.toThrow('token=[REDACTED]')
})

test('exists, sendExit, kill and capture address the exact session', async () => {
  tmux.alive.add('ra-3f2a9c1b')
  tmux.screen = 'one\ntwo\nthree\n\n\n'
  expect(await launcher.exists('ra-3f2a9c1b')).toBe(true)
  expect(await launcher.capture('ra-3f2a9c1b', 2)).toBe('two\nthree')
  await launcher.sendExit('ra-3f2a9c1b')
  expect(await launcher.exists('ra-3f2a9c1b')).toBe(false)
  expect(tmux.calls).toEqual([
    ['tmux', 'has-session', '-t', '=ra-3f2a9c1b'],
    ['tmux', 'capture-pane', '-p', '-t', 'ra-3f2a9c1b'],
    ['tmux', 'send-keys', '-t', 'ra-3f2a9c1b', '/exit', 'Enter'],
    ['tmux', 'has-session', '-t', '=ra-3f2a9c1b'],
  ])
})

test('kill tolerates a session that is already gone', async () => {
  await launcher.kill('ra-gone')
  expect(tmux.calls).toEqual([['tmux', 'kill-session', '-t', '=ra-gone']])
})

test('runCommand reports a missing executable instead of throwing', async () => {
  const result = await runCommand(['/nonexistent/definitely-not-here'])
  expect(result.code).not.toBe(0)
  expect(result.stderr).not.toBe('')
})
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test test/bridge/launcher.test.ts`
Expected: FAIL — `Cannot find module '../../src/bridge/launcher.ts'`.

- [ ] **Step 4: Implement** — `src/bridge/launcher.ts`:

```ts
import { redactSecrets, truncate } from '../core/text.ts'

export type RunResult = { code: number; stdout: string; stderr: string }
export type Run = (argv: string[]) => Promise<RunResult>

/** A tmux or systemd-run call failed. The message is redacted and safe to post. */
export class LaunchError extends Error {}

const ERROR_MAX = 500
const GONE = /can't find session|no server running|session not found/i

/** Runs argv without a shell. A missing executable becomes a failed result, not an exception. */
export const runCommand: Run = async argv => {
  try {
    const child = Bun.spawn(argv, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    return { code, stdout, stderr }
  } catch (error) {
    return { code: 127, stdout: '', stderr: error instanceof Error ? error.message : String(error) }
  }
}

export function tmuxNameFor(sessionId: string): string {
  return `ra-${sessionId.slice(0, 8)}`
}

function failure(result: RunResult): LaunchError {
  const text = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`
  return new LaunchError(truncate(redactSecrets(text), ERROR_MAX))
}

/** Every tmux and systemd-run call a Spawned Session needs. */
export class Launcher {
  constructor(private readonly run: Run = runCommand) {}

  /** The scope keeps tmux (and claude) outside the Bridge service's cgroup, so restarting the Bridge does not kill them. */
  async launch(spec: { sessionId: string; cwd: string }): Promise<{ tmuxName: string }> {
    const tmuxName = tmuxNameFor(spec.sessionId)
    const result = await this.run([
      'systemd-run', '--user', '--scope', '--quiet', '--collect',
      'tmux', 'new-session', '-d', '-s', tmuxName, '-c', spec.cwd,
      'claude', '--session-id', spec.sessionId,
    ])
    if (result.code !== 0) {
      throw failure(result)
    }
    return { tmuxName }
  }

  async exists(name: string): Promise<boolean> {
    return (await this.run(['tmux', 'has-session', '-t', `=${name}`])).code === 0
  }

  async capture(name: string, lines: number): Promise<string> {
    const result = await this.run(['tmux', 'capture-pane', '-p', '-t', name])
    if (result.code !== 0) {
      throw failure(result)
    }
    return result.stdout.trimEnd().split('\n').slice(-lines).join('\n')
  }

  async sendExit(name: string): Promise<void> {
    const result = await this.run(['tmux', 'send-keys', '-t', name, '/exit', 'Enter'])
    if (result.code !== 0) {
      throw failure(result)
    }
  }

  async kill(name: string): Promise<void> {
    const result = await this.run(['tmux', 'kill-session', '-t', `=${name}`])
    if (result.code !== 0 && !GONE.test(result.stderr)) {
      throw failure(result)
    }
  }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `bun test && bun run typecheck`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/bridge/launcher.ts test/bridge/launcher.test.ts test/support/fake-tmux.ts
git commit -m "feat: launch claude in a detached tmux session in its own systemd scope"
```

---

### Task 6: `Notifier.closeSession`

**Files:**
- Modify: `src/bridge/notifier.ts`
- Test: `test/bridge/notifier.test.ts`

**Interfaces:**
- Produces: `Notifier.closeSession(sessionId: string): Promise<void>` — ends a Session the Bridge stopped itself (no `session_ended` Report will come): marks it ended, dismisses its pending Prompts, closes its Thread, posts nothing. No-op for unknown or already-ended Sessions.

- [ ] **Step 1: Write the failing test** — append to `test/bridge/notifier.test.ts` (it already has `store`, `channel`, `notifier` in `beforeEach`; if the local names differ, use the file's names):

```ts
test('closeSession ends the session and closes its thread silently, once', async () => {
  store.createSpawnedSession({ id: 'sp1', cwd: '/home/u/api', tmuxName: 'ra-sp1' })
  const thread = await notifier.ensureThread('sp1')
  const textsBefore = channel.texts.length
  await notifier.closeSession('sp1')
  await notifier.closeSession('sp1')
  expect(store.getSession('sp1')?.endedAt).not.toBeNull()
  expect(channel.threads.find(item => item.ref === thread)?.closed).toBe(true)
  expect(channel.texts.length).toBe(textsBefore)
  await notifier.closeSession('unknown')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/bridge/notifier.test.ts`
Expected: FAIL — `notifier.closeSession is not a function`.

- [ ] **Step 3: Implement** in `src/bridge/notifier.ts`. Change `endSession` to accept `null` text and add the public method:

```ts
  /** Ends a Session the Bridge stopped itself, so no session_ended Report will come. Idempotent. */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.store.getSession(sessionId)
    if (session === undefined || session.endedAt !== null) {
      return
    }
    await this.endSession(session, null)
  }
```

```ts
  private async endSession(session: SessionRow, text: string | null): Promise<void> {
    this.store.endSession(session.id)
    await this.dismissPending(session.id)
    if (session.threadId === null) {
      return
    }
    try {
      if (text !== null && this.away.isAway()) {
        await this.channel.sendText(session.threadId, text, null)
      }
    } finally {
      try {
        await this.channel.closeThread(session.threadId)
      } finally {
        this.store.setSessionThread(session.id, null)
      }
    }
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test && bun run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/bridge/notifier.ts test/bridge/notifier.test.ts
git commit -m "feat: let the bridge close a session it stopped itself"
```

---

### Task 7: `Spawner` — picker, start, ready, startup timeout

**Files:**
- Create: `src/bridge/spawner.ts`
- Test: `test/bridge/spawner.test.ts`

**Interfaces:**
- Consumes: `Store.createSpawnedSession`, `Store.markSpawnedStarted`, `Store.endSession` (Task 1); `Channel.sendButtons`, `LaunchButton` (Task 2); `STARTUP_TIMEOUT_MS` (Task 3); `TrustedFolders`, `TrustedFoldersUnavailable`, `Project` (Task 4); `Launcher`, `tmuxNameFor` (Task 5); `Notifier.ensureThread`, `Notifier.closeSession` (Task 6).
- Produces:
  - `type Schedule = (run: () => void, ms: number) => () => void` (returns cancel)
  - `type SpawnerDeps = { store: Store; channel: Channel; notifier: Notifier; launcher: Launcher; trusted: TrustedFolders; log: Log; schedule?: Schedule; sleep?: (ms: number) => Promise<void>; newId?: () => string }`
  - `class Spawner { constructor(deps: SpawnerDeps); newCommand(thread: ThreadRef | null, args: string): Promise<string | null>; startFromPicker(pickerId: string, choice: number): Promise<string>; onSessionStarted(sessionId: string): Promise<void> }` (Task 8 adds `end` and `reconcile`)
  - Exported reply constants: `NOT_TRUSTED`, `STALE_PICKER`, `CONFIG_UNREADABLE`, `USAGE`, `READY`

- [ ] **Step 1: Write the failing tests** — `test/bridge/spawner.test.ts`:

```ts
import { beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Launcher } from '../../src/bridge/launcher.ts'
import { AwayMode, Notifier } from '../../src/bridge/notifier.ts'
import { CONFIG_UNREADABLE, NOT_TRUSTED, READY, STALE_PICKER, Spawner, USAGE, type Schedule } from '../../src/bridge/spawner.ts'
import { Store } from '../../src/bridge/store.ts'
import { TrustedFolders } from '../../src/bridge/trusted.ts'
import { FakeChannel, flush } from '../support/fake-channel.ts'
import { FakeTmux } from '../support/fake-tmux.ts'

type Timer = { run: () => void; ms: number; cancelled: boolean }

let home: string
let store: Store
let channel: FakeChannel
let tmux: FakeTmux
let timers: Timer[]
let projects: string[]
let configPath: string
let spawner: Spawner
let ids: number

const schedule: Schedule = (run, ms) => {
  const timer = { run, ms, cancelled: false }
  timers.push(timer)
  return () => {
    timer.cancelled = true
  }
}

function idFor(n: number): string {
  return `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
}

function build(): Spawner {
  const notifier = new Notifier(store, channel, new AwayMode(false), () => {})
  return new Spawner({
    store,
    channel,
    notifier,
    launcher: new Launcher(tmux.run),
    trusted: new TrustedFolders({ configPath, home, projects }),
    log: () => {},
    schedule,
    sleep: async () => {},
    newId: () => idFor(++ids),
  })
}

beforeEach(async () => {
  home = await realpath(await mkdtemp(`${tmpdir()}/ra-spawner-`))
  await mkdir(`${home}/Sites/api`, { recursive: true })
  await mkdir(`${home}/Sites/My Projects/app`, { recursive: true })
  await mkdir(`${home}/Sites/secret`, { recursive: true })
  configPath = `${home}/.claude.json`
  await writeFile(configPath, JSON.stringify({ projects: {
    [`${home}/Sites/api`]: { hasTrustDialogAccepted: true },
    [`${home}/Sites/My Projects/app`]: { hasTrustDialogAccepted: true },
    [`${home}/Sites/secret`]: { hasTrustDialogAccepted: false },
  } }))
  projects = ['~/Sites/api', '~/Sites/secret']
  store = new Store(':memory:')
  channel = new FakeChannel()
  tmux = new FakeTmux()
  timers = []
  ids = 0
  spawner = build()
})

test('/new posts one button per trusted configured project', async () => {
  expect(await spawner.newCommand(null, '')).toBeNull()
  expect(channel.buttons).toEqual([{
    thread: null,
    text: 'Start a session in:',
    buttons: [{ label: 'api', data: { kind: 'launch', pickerId: '00000001', choice: 0 } }],
  }])
})

test('tapping a project creates the thread first, then launches and arms the startup timer', async () => {
  await spawner.newCommand(null, '')
  const toast = await spawner.startFromPicker('00000001', 0)
  const sessionId = idFor(2)
  expect(toast).toBe('🚀 Starting api. Open its topic.')
  expect(channel.threads.map(thread => thread.title)).toEqual(['api · 00000002'])
  expect(tmux.calls[0]).toEqual([
    'systemd-run', '--user', '--scope', '--quiet', '--collect',
    'tmux', 'new-session', '-d', '-s', 'ra-00000002', '-c', `${home}/Sites/api`,
    'claude', '--session-id', sessionId,
  ])
  expect(store.getSession(sessionId)).toMatchObject({ spawned: true, tmuxName: 'ra-00000002', threadId: channel.threads[0]?.ref, startedAt: null, endedAt: null })
  expect(channel.texts.map(text => text.text)).toEqual(['⏳ Starting… attach with: tmux attach -t ra-00000002'])
  expect(timers.map(timer => timer.ms)).toEqual([30_000])
})

test('/new with a trusted path containing spaces launches there', async () => {
  expect(await spawner.newCommand('t9', '~/Sites/My Projects/app')).toBe('🚀 Starting app. Open its topic.')
  expect(tmux.calls[0]).toContain(`${home}/Sites/My Projects/app`)
})

test('untrusted, subfolder and relative paths are refused without launching', async () => {
  expect(await spawner.newCommand(null, '~/Sites/secret')).toBe(NOT_TRUSTED)
  expect(await spawner.newCommand(null, '~/Sites')).toBe(NOT_TRUSTED)
  expect(await spawner.newCommand(null, 'Sites/api')).toBe(NOT_TRUSTED)
  expect(tmux.calls).toEqual([])
  expect(channel.threads).toEqual([])
})

test('/new without projects or a path explains the usage', async () => {
  projects = []
  spawner = build()
  expect(await spawner.newCommand(null, '')).toBe(USAGE)
})

test('an unknown picker is stale', async () => {
  expect(await spawner.startFromPicker('deadbeef', 0)).toBe(STALE_PICKER)
  await spawner.newCommand(null, '')
  expect(await spawner.startFromPicker('00000001', 5)).toBe(STALE_PICKER)
})

test('an unreadable claude config is reported', async () => {
  await writeFile(configPath, '{oops')
  expect(await spawner.newCommand(null, '')).toBe(CONFIG_UNREADABLE)
  expect(await spawner.newCommand(null, '~/Sites/api')).toBe(CONFIG_UNREADABLE)
})

test('the first mod request posts Ready once, even when several arrive together', async () => {
  await spawner.newCommand(null, '~/Sites/api')
  const sessionId = idFor(1)
  await Promise.all([spawner.onSessionStarted(sessionId), spawner.onSessionStarted(sessionId), spawner.onSessionStarted(sessionId)])
  expect(channel.texts.filter(text => text.text === READY)).toHaveLength(1)
  expect(timers[0]?.cancelled).toBe(true)
  expect(store.getSession(sessionId)?.startedAt).not.toBeNull()
})

test('onSessionStarted ignores terminal-started and unknown sessions', async () => {
  store.upsertSession({ sessionId: 's1', cwd: '/x/app' })
  await spawner.onSessionStarted('s1')
  await spawner.onSessionStarted('nope')
  expect(channel.texts).toEqual([])
})

test('a session that never starts gets its screen posted, then is killed and closed', async () => {
  await spawner.newCommand(null, '~/Sites/api')
  const sessionId = idFor(1)
  tmux.screen = 'Welcome\nAPI key: password=hunter22\nPlease run /login\n'
  timers[0]?.run()
  await flush()
  const posted = channel.texts.at(-1)?.text ?? ''
  expect(posted).toStartWith('❌ Session did not start within 30s. Last output:')
  expect(posted).toContain('password=[REDACTED]')
  expect(posted).toContain('Please run /login')
  expect(tmux.alive.has('ra-00000001')).toBe(false)
  expect(store.getSession(sessionId)?.endedAt).not.toBeNull()
  expect(channel.threads[0]?.closed).toBe(true)
})

test('the startup timer does nothing once the session is ready', async () => {
  await spawner.newCommand(null, '~/Sites/api')
  await spawner.onSessionStarted(idFor(1))
  timers[0]?.run()
  await flush()
  expect(tmux.alive.has('ra-00000001')).toBe(true)
})

test('a failed launch is reported in the thread and the reply, and the thread is closed', async () => {
  tmux.launchFails = 'tmux: command not found'
  const reply = await spawner.newCommand(null, '~/Sites/api')
  expect(reply).toBe('❌ Could not start the session: tmux: command not found')
  expect(channel.texts.map(text => text.text)).toEqual(['❌ Could not start the session:\ntmux: command not found'])
  expect(channel.threads[0]?.closed).toBe(true)
  expect(store.getSession(idFor(1))?.endedAt).not.toBeNull()
  expect(timers).toEqual([])
})

test('when the topic cannot be created nothing is launched and the session is ended', async () => {
  channel.createThreadFails = true
  expect(await spawner.newCommand(null, '~/Sites/api')).toBe('❌ Could not create a topic for the session.')
  expect(tmux.calls).toEqual([])
  expect(store.getSession(idFor(1))?.endedAt).not.toBeNull()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/bridge/spawner.test.ts`
Expected: FAIL — `Cannot find module '../../src/bridge/spawner.ts'`.

- [ ] **Step 3: Implement** — `src/bridge/spawner.ts`:

```ts
import { projectName } from '../../mod/remote-agent/hooks/protocol.ts'
import type { Channel, ThreadRef } from '../channel/types.ts'
import { redactSecrets, truncate } from '../core/text.ts'
import { STARTUP_TIMEOUT_MS } from './config.ts'
import { tmuxNameFor, type Launcher } from './launcher.ts'
import type { Notifier } from './notifier.ts'
import type { Log } from './prompts.ts'
import type { Store } from './store.ts'
import { TrustedFoldersUnavailable, type Project, type TrustedFolders } from './trusted.ts'

export const NOT_TRUSTED = 'Not a trusted folder. Open it once in Claude Code locally and accept the trust dialog.'
export const STALE_PICKER = 'Project list changed. Send /new again.'
export const CONFIG_UNREADABLE = "Can't read Claude Code's trusted folders."
export const USAGE = 'Usage: /new <trusted folder>. Set REMOTE_AGENT_PROJECTS to get buttons for your projects.'
export const READY = '✅ Ready. Send your task here.'

const CAPTURE_LINES = 15
const CAPTURE_MAX = 1_500
const REASON_MAX = 150
const MAX_PICKERS = 20

/** Runs `run` after `ms`; the returned function cancels it. */
export type Schedule = (run: () => void, ms: number) => () => void

export type SpawnerDeps = {
  store: Store
  channel: Channel
  notifier: Notifier
  launcher: Launcher
  trusted: TrustedFolders
  log: Log
  schedule?: Schedule
  sleep?: (ms: number) => Promise<void>
  newId?: () => string
}

const defaultSchedule: Schedule = (run, ms) => {
  const handle = setTimeout(run, ms)
  return () => {
    clearTimeout(handle)
  }
}

function reasonOf(error: unknown): string {
  return truncate(redactSecrets(error instanceof Error ? error.message : String(error)), REASON_MAX)
}

/** Starts Spawned Sessions from the Channel and watches them until they are ready. */
export class Spawner {
  private readonly timers = new Map<string, () => void>()
  private readonly pickers = new Map<string, Project[]>()
  private readonly schedule: Schedule
  private readonly sleep: (ms: number) => Promise<void>
  private readonly newId: () => string

  constructor(private readonly deps: SpawnerDeps) {
    this.schedule = deps.schedule ?? defaultSchedule
    this.sleep = deps.sleep ?? (ms => Bun.sleep(ms))
    this.newId = deps.newId ?? (() => crypto.randomUUID())
  }

  /** `/new [path]`. Returns the reply, or null when the project picker was posted instead. */
  async newCommand(thread: ThreadRef | null, args: string): Promise<string | null> {
    try {
      if (args !== '') {
        return await this.startAt(args)
      }
      return await this.postPicker(thread)
    } catch (error) {
      if (error instanceof TrustedFoldersUnavailable) {
        this.deps.log('reading trusted folders failed', error)
        return CONFIG_UNREADABLE
      }
      throw error
    }
  }

  /** A tap on a picker button. Returns the toast. */
  async startFromPicker(pickerId: string, choice: number): Promise<string> {
    const project = this.pickers.get(pickerId)?.[choice]
    if (project === undefined) {
      return STALE_PICKER
    }
    try {
      return await this.startAt(project.cwd)
    } catch (error) {
      if (error instanceof TrustedFoldersUnavailable) {
        this.deps.log('reading trusted folders failed', error)
        return CONFIG_UNREADABLE
      }
      throw error
    }
  }

  /** Called for every mod request that names a Session; the first one for a Spawned Session marks it ready. */
  async onSessionStarted(sessionId: string): Promise<void> {
    const session = this.deps.store.getSession(sessionId)
    if (session === undefined || !session.spawned || session.startedAt !== null || session.endedAt !== null) {
      return
    }
    if (!this.deps.store.markSpawnedStarted(sessionId)) {
      return
    }
    this.cancelTimer(sessionId)
    if (session.threadId === null) {
      return
    }
    await this.deps.channel.sendText(session.threadId, READY, null)
  }

  private async postPicker(thread: ThreadRef | null): Promise<string | null> {
    const projects = await this.deps.trusted.configuredProjects()
    if (projects.length === 0) {
      return USAGE
    }
    const pickerId = this.newId().slice(0, 8)
    this.pickers.set(pickerId, projects)
    if (this.pickers.size > MAX_PICKERS) {
      const oldest = this.pickers.keys().next().value
      if (oldest !== undefined) {
        this.pickers.delete(oldest)
      }
    }
    const buttons = projects.map((project, choice) => ({ label: project.label, data: { kind: 'launch' as const, pickerId, choice } }))
    await this.deps.channel.sendButtons(thread, 'Start a session in:', buttons)
    return null
  }

  private async startAt(path: string): Promise<string> {
    const cwd = await this.deps.trusted.isTrusted(path)
    if (cwd === null) {
      return NOT_TRUSTED
    }
    return this.start(cwd)
  }

  private async start(cwd: string): Promise<string> {
    const { store, notifier, channel, launcher, log } = this.deps
    const sessionId = this.newId()
    const tmuxName = tmuxNameFor(sessionId)
    store.createSpawnedSession({ id: sessionId, cwd, tmuxName })
    // The Thread must exist before claude starts, or the mod's first request would create a second one.
    let thread: ThreadRef
    try {
      thread = await notifier.ensureThread(sessionId)
    } catch (error) {
      log(`creating the topic for ${sessionId} failed`, error)
      store.endSession(sessionId)
      return '❌ Could not create a topic for the session.'
    }
    try {
      await launcher.launch({ sessionId, cwd })
    } catch (error) {
      const reason = reasonOf(error)
      await channel.sendText(thread, `❌ Could not start the session:\n${reason}`, null).catch(sendError => {
        log(`reporting the failed launch of ${sessionId} failed`, sendError)
      })
      await notifier.closeSession(sessionId)
      return `❌ Could not start the session: ${reason}`
    }
    this.armTimer(sessionId)
    await channel.sendText(thread, `⏳ Starting… attach with: tmux attach -t ${tmuxName}`, null)
    return `🚀 Starting ${projectName(cwd)}. Open its topic.`
  }

  private armTimer(sessionId: string): void {
    this.cancelTimer(sessionId)
    const cancel = this.schedule(() => {
      this.timers.delete(sessionId)
      void this.onTimeout(sessionId).catch(error => {
        this.deps.log(`startup timeout of ${sessionId} failed`, error)
      })
    }, STARTUP_TIMEOUT_MS)
    this.timers.set(sessionId, cancel)
  }

  private cancelTimer(sessionId: string): void {
    this.timers.get(sessionId)?.()
    this.timers.delete(sessionId)
  }

  private async onTimeout(sessionId: string): Promise<void> {
    const { store, channel, launcher, notifier, log } = this.deps
    const session = store.getSession(sessionId)
    if (session === undefined || session.startedAt !== null || session.endedAt !== null || session.tmuxName === null) {
      return
    }
    let tail = ''
    try {
      tail = await launcher.capture(session.tmuxName, CAPTURE_LINES)
    } catch (error) {
      log(`capturing the screen of ${session.tmuxName} failed`, error)
    }
    if (session.threadId !== null) {
      const shown = tail === '' ? '(no output)' : truncate(redactSecrets(tail), CAPTURE_MAX)
      await channel
        .sendText(session.threadId, `❌ Session did not start within ${STARTUP_TIMEOUT_MS / 1_000}s. Last output:\n\n${shown}`, null)
        .catch(error => {
          log(`reporting the startup timeout of ${sessionId} failed`, error)
        })
    }
    await launcher.kill(session.tmuxName)
    await notifier.closeSession(sessionId)
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test && bun run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/bridge/spawner.ts test/bridge/spawner.test.ts
git commit -m "feat: start spawned sessions from a project picker or a trusted path"
```

---

### Task 8: `Spawner` — `/end` and restart reconciliation

**Files:**
- Modify: `src/bridge/spawner.ts`
- Test: `test/bridge/spawner.test.ts`

**Interfaces:**
- Consumes: `END_GRACE_MS` (Task 3), `Launcher.exists/sendExit/kill` (Task 5), `Notifier.closeSession` (Task 6), `armTimer/cancelTimer` (Task 7).
- Produces:
  - `Spawner.end(thread: ThreadRef | null): Promise<string | null>`
  - `Spawner.reconcile(): Promise<void>`
  - Constant `NOT_SPAWNED = 'Only sessions started from Telegram can be ended remotely.'`

- [ ] **Step 1: Write the failing tests** — append to `test/bridge/spawner.test.ts` (add `NOT_SPAWNED` to the import from `spawner.ts`):

```ts
async function startedSession(): Promise<{ id: string; thread: string }> {
  await spawner.newCommand(null, '~/Sites/api')
  const id = idFor(ids)
  await spawner.onSessionStarted(id)
  return { id, thread: store.getSession(id)?.threadId ?? '' }
}

test('/end exits gracefully and closes the thread', async () => {
  const { id, thread } = await startedSession()
  expect(await spawner.end(thread)).toBeNull()
  expect(tmux.commands()).toEqual(['launch', 'has-session', 'send-keys', 'has-session'])
  expect(channel.texts.some(text => text.text === '⏹ Ending the session…')).toBe(true)
  expect(store.getSession(id)?.endedAt).not.toBeNull()
  expect(channel.threads[0]?.closed).toBe(true)
})

test('/end kills the session when /exit does not work within the grace period', async () => {
  const { id, thread } = await startedSession()
  tmux.exitWorks = false
  await spawner.end(thread)
  expect(tmux.commands()).toEqual(['launch', 'has-session', 'send-keys', 'has-session', 'kill-session'])
  expect(tmux.alive.size).toBe(0)
  expect(store.getSession(id)?.endedAt).not.toBeNull()
})

test('a second /end during the grace period is refused', async () => {
  const { thread } = await startedSession()
  let release = (): void => {}
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const notifier = new Notifier(store, channel, new AwayMode(false), () => {})
  spawner = new Spawner({ store, channel, notifier, launcher: new Launcher(tmux.run), trusted: new TrustedFolders({ configPath, home, projects }), log: () => {}, schedule, sleep: () => gate })
  const first = spawner.end(thread)
  await flush()
  expect(await spawner.end(thread)).toBe('⏹ Already ending.')
  release()
  await first
  expect(tmux.commands().filter(command => command === 'send-keys')).toHaveLength(1)
})

test('/end when tmux is already gone just closes the session', async () => {
  const { id, thread } = await startedSession()
  tmux.alive.clear()
  expect(await spawner.end(thread)).toBe('⚪ The session was already gone.')
  expect(store.getSession(id)?.endedAt).not.toBeNull()
})

test('/end refuses terminal-started sessions, ended sessions and the General topic', async () => {
  store.upsertSession({ sessionId: 's1', cwd: '/x/app' })
  store.setSessionThread('s1', 't77')
  expect(await spawner.end('t77')).toBe(NOT_SPAWNED)
  expect(await spawner.end('t-unknown')).toBe('This session has ended.')
  expect(await spawner.end(null)).toBe('Send /end inside a session topic.')
})

test('reconcile closes dead sessions and re-arms the timer for alive ones that never reported', async () => {
  store.createSpawnedSession({ id: 'gone', cwd: `${home}/Sites/api`, tmuxName: 'ra-gone' })
  store.setSessionThread('gone', 't1')
  store.createSpawnedSession({ id: 'ready', cwd: `${home}/Sites/api`, tmuxName: 'ra-ready' })
  store.markSpawnedStarted('ready')
  store.createSpawnedSession({ id: 'booting', cwd: `${home}/Sites/api`, tmuxName: 'ra-booting' })
  store.upsertSession({ sessionId: 'terminal', cwd: '/x/app' })
  tmux.alive.add('ra-ready')
  tmux.alive.add('ra-booting')
  await spawner.reconcile()
  expect(store.getSession('gone')?.endedAt).not.toBeNull()
  expect(store.getSession('ready')?.endedAt).toBeNull()
  expect(store.getSession('booting')?.endedAt).toBeNull()
  expect(store.getSession('terminal')?.endedAt).toBeNull()
  expect(timers.map(timer => timer.ms)).toEqual([30_000])
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/bridge/spawner.test.ts`
Expected: FAIL — `spawner.end is not a function`.

- [ ] **Step 3: Implement** — in `src/bridge/spawner.ts` import `END_GRACE_MS` alongside `STARTUP_TIMEOUT_MS`, add the constant and field, and add the two methods to the class:

```ts
export const NOT_SPAWNED = 'Only sessions started from Telegram can be ended remotely.'
```

```ts
  private readonly ending = new Set<string>()
```

```ts
  /** `/end` in a Thread: `/exit`, then kill after the grace period. Returns the reply, or null when the Thread got its own message. */
  async end(thread: ThreadRef | null): Promise<string | null> {
    if (thread === null) {
      return 'Send /end inside a session topic.'
    }
    const { store, channel, launcher, notifier } = this.deps
    const session = store.findSessionByThread(thread)
    if (session === undefined || session.endedAt !== null) {
      return 'This session has ended.'
    }
    if (!session.spawned || session.tmuxName === null) {
      return NOT_SPAWNED
    }
    if (this.ending.has(session.id)) {
      return '⏹ Already ending.'
    }
    this.ending.add(session.id)
    try {
      this.cancelTimer(session.id)
      if (!(await launcher.exists(session.tmuxName))) {
        await notifier.closeSession(session.id)
        return '⚪ The session was already gone.'
      }
      await channel.sendText(thread, '⏹ Ending the session…', null)
      await launcher.sendExit(session.tmuxName)
      await this.sleep(END_GRACE_MS)
      if (await launcher.exists(session.tmuxName)) {
        await launcher.kill(session.tmuxName)
      }
      // A graceful exit usually already closed it through the session_ended Report; closeSession is then a no-op.
      await notifier.closeSession(session.id)
      return null
    } finally {
      this.ending.delete(session.id)
    }
  }

  /** On Bridge startup: Spawned Sessions survive restarts, so close the dead ones and keep watching the ones still booting. */
  async reconcile(): Promise<void> {
    const { store, launcher, notifier, log } = this.deps
    for (const session of store.listActiveSessions()) {
      if (!session.spawned) {
        continue
      }
      try {
        if (session.tmuxName === null || !(await launcher.exists(session.tmuxName))) {
          await notifier.closeSession(session.id)
          continue
        }
        if (session.startedAt === null) {
          this.armTimer(session.id)
        }
      } catch (error) {
        log(`reconciling ${session.id} failed`, error)
      }
    }
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test && bun run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/bridge/spawner.ts test/bridge/spawner.test.ts
git commit -m "feat: end spawned sessions from telegram and reconcile them after a restart"
```

---

### Task 9: Wire `/new`, `/end`, launch buttons, `/status` and mod activity

**Files:**
- Modify: `src/bridge/inbound.ts`, `src/bridge/http.ts`
- Test: `test/bridge/inbound.test.ts`, `test/bridge/http.test.ts`

**Interfaces:**
- Consumes: `Spawner.newCommand`, `Spawner.end`, `Spawner.startFromPicker`, `Spawner.onSessionStarted` (Tasks 7–8).
- Produces:
  - `type SessionCommands = Pick<Spawner, 'newCommand' | 'end' | 'startFromPicker'>` (exported from `inbound.ts`)
  - `new Inbound(store, prompts, notifier, spawner?: SessionCommands)`
  - `type SessionActivity = { onSessionStarted(sessionId: string): Promise<void> }`; `HttpDeps.activity?: SessionActivity`

- [ ] **Step 1: Write the failing tests**

Append to `test/bridge/inbound.test.ts` (add `type SessionCommands` to the `inbound.ts` import):

```ts
function withSpawner(): string[] {
  const calls: string[] = []
  const spawner: SessionCommands = {
    newCommand: async (thread, args) => {
      calls.push(`new ${thread} ${args}`)
      return null
    },
    end: async thread => {
      calls.push(`end ${thread}`)
      return 'ending'
    },
    startFromPicker: async (pickerId, choice) => {
      calls.push(`launch ${pickerId} ${choice}`)
      return 'started'
    },
  }
  inbound = new Inbound(store, prompts, notifier, spawner)
  return calls
}

test('/new, /end and launch buttons go to the spawner', async () => {
  const calls = withSpawner()
  expect(await inbound.onCommand({ name: 'new', args: '~/Sites/api', thread: 't1' })).toBeNull()
  expect(await inbound.onCommand({ name: 'end', args: '', thread: 't1' })).toBe('ending')
  expect(await inbound.onButton({ kind: 'launch', pickerId: 'abcd1234', choice: 2 })).toBe('started')
  expect(calls).toEqual(['new t1 ~/Sites/api', 'end t1', 'launch abcd1234 2'])
})

test('without a spawner /new and launch buttons explain it is not set up', async () => {
  expect(await inbound.onCommand({ name: 'new', args: '', thread: null })).toBe('Starting sessions is not set up.')
  expect(await inbound.onButton({ kind: 'launch', pickerId: 'x', choice: 0 })).toBe('Starting sessions is not set up.')
})

test('/status shows how to attach to spawned sessions', async () => {
  store.createSpawnedSession({ id: 'abcdef12-0000', cwd: '/home/u/api', tmuxName: 'ra-abcdef12' })
  expect(await inbound.onCommand({ name: 'status', args: '', thread: null })).toBe(
    'Away mode: on\nActive sessions: 1\n• api · abcdef12 (tmux attach -t ra-abcdef12)\nPending prompts: 0',
  )
})
```

Update the existing unknown-command expectation:

```ts
  expect(await inbound.onCommand({ name: 'nope', args: '', thread: null })).toBe('Unknown command. Try /new, /end, /away, /back or /status.')
```

Append to `test/bridge/http.test.ts`:

```ts
test('every mod request reports session activity', async () => {
  const seen: string[] = []
  const store2 = new Store(':memory:')
  const notifier2 = new Notifier(store2, new FakeChannel(), new AwayMode(false))
  const prompts2 = new PromptService(store2, notifier2, { reminderAfterMs: 60_000 })
  const handler = createHandler({ prompts: prompts2, notifier: notifier2, store: store2, log: () => {}, activity: { onSessionStarted: async id => { seen.push(id) } } })
  const send = (method: string, path: string, body?: unknown): Promise<Response> =>
    handler(new Request(`http://bridge${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) }))
  await send('POST', '/reports', { session, report: { kind: 'session_started' } })
  await send('GET', '/sessions/s1/instructions')
  await send('POST', '/titles', { session, title: 'hi' })
  await send('POST', '/sessions/s1/settled', { scope: { kind: 'all' } })
  await send('POST', '/prompts', permissionRequest)
  await flush()
  expect(seen).toEqual(['s1', 's1', 's1', 's1', 's1'])
})

test('a failing activity hook never fails the request', async () => {
  const handler = createHandler({ prompts: new PromptService(store, new Notifier(store, channel, new AwayMode(false)), { reminderAfterMs: 60_000 }), notifier: new Notifier(store, channel, new AwayMode(false)), store, log: message => logged.push(message), activity: { onSessionStarted: async () => { throw new Error('boom') } } })
  const response = await handler(new Request('http://bridge/sessions/s1/instructions'))
  expect(response.status).toBe(200)
  await flush()
  expect(logged).toContain('session activity for s1 failed')
})
```

(Add `AwayMode`, `Notifier`, `PromptService`, `Store`, `FakeChannel` imports to `http.test.ts` only if not already present — they are.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/bridge/inbound.test.ts test/bridge/http.test.ts`
Expected: FAIL — `SessionCommands` not exported, `/new` returns `Unknown command…`, `activity` never called.

- [ ] **Step 3: Implement**

`src/bridge/inbound.ts`:

```ts
import type { Spawner } from './spawner.ts'

export type SessionCommands = Pick<Spawner, 'newCommand' | 'end' | 'startFromPicker'>

const NOT_SET_UP = 'Starting sessions is not set up.'
```

Constructor:

```ts
  constructor(
    private readonly store: Store,
    private readonly prompts: PromptService,
    private readonly notifier: Notifier,
    private readonly spawner?: SessionCommands,
  ) {}
```

Replace the Task 2 placeholder branch at the top of `onButton`:

```ts
    if (press.kind === 'launch') {
      if (this.spawner === undefined) {
        return NOT_SET_UP
      }
      return this.spawner.startFromPicker(press.pickerId, press.choice)
    }
```

In `onCommand`, before the `away` branch:

```ts
    if (command.name === 'new') {
      if (this.spawner === undefined) {
        return NOT_SET_UP
      }
      return this.spawner.newCommand(command.thread, command.args)
    }
    if (command.name === 'end') {
      if (this.spawner === undefined) {
        return NOT_SET_UP
      }
      return this.spawner.end(command.thread)
    }
```

In the `status` branch replace the session line:

```ts
        ...sessions.map(session => `• ${sessionLabel(session)}${session.tmuxName === null ? '' : ` (tmux attach -t ${session.tmuxName})`}`),
```

And the fallback:

```ts
    return 'Unknown command. Try /new, /end, /away, /back or /status.'
```

`src/bridge/http.ts`:

```ts
/** Told about every mod request that names a Session; a Spawned Session counts as started on the first one. */
export type SessionActivity = { onSessionStarted(sessionId: string): Promise<void> }

export type HttpDeps = { prompts: PromptService; notifier: Notifier; store: Store; log: Log; activity?: SessionActivity }

function sessionSeen(deps: HttpDeps, sessionId: string): void {
  if (deps.activity === undefined) {
    return
  }
  void deps.activity.onSessionStarted(sessionId).catch(error => {
    deps.log(`session activity for ${sessionId} failed`, error)
  })
}
```

Call `sessionSeen` in `route` (after the body is parsed and the existing work is done, so the Session row is up to date):

- `POST /prompts`: `const result = deps.prompts.create(body)`, then `sessionSeen(deps, body.session.sessionId)`, then `return json(result)`.
- `POST /sessions/:id/settled`: compute the result, `sessionSeen(deps, param(settled))`, return.
- `POST /reports`: right after parsing, `sessionSeen(deps, body.session.sessionId)`.
- `POST /titles`: after `await deps.notifier.updateTitle(body)`, `sessionSeen(deps, body.session.sessionId)`.
- `GET /sessions/:id/instructions`: `sessionSeen(deps, param(instructions))` before returning.

- [ ] **Step 4: Run to verify pass**

Run: `bun test && bun run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/bridge/inbound.ts src/bridge/http.ts test/bridge/inbound.test.ts test/bridge/http.test.ts
git commit -m "feat: route /new, /end and project buttons to the spawner and report mod activity"
```

---

### Task 10: Bridge startup, deploy, docs and end-to-end check

**Files:**
- Modify: `src/bridge/main.ts`, `deploy/remote-agent.service`, `.env.example`, `README.md`
- Create: `references/spawn-session-e2e.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Wire `main.ts`**

Imports:

```ts
import { Launcher } from './launcher.ts'
import { Spawner } from './spawner.ts'
import { TrustedFolders, TrustedFoldersUnavailable } from './trusted.ts'
```

Replace the `inbound` line and the `fetch` line:

```ts
const trusted = new TrustedFolders({ configPath: config.claudeConfigPath, home: config.home, projects: config.projects })
const spawner = new Spawner({ store, channel, notifier, launcher: new Launcher(), trusted, log })
const inbound = new Inbound(store, prompts, notifier, spawner)
```

```ts
  fetch: createHandler({ prompts, notifier, store, log, activity: spawner }),
```

After `await channel.start(inbound)`:

```ts
await spawner.reconcile().catch(error => {
  log('reconciling spawned sessions failed', error)
})
try {
  for (const entry of await trusted.untrustedProjects()) {
    log(`REMOTE_AGENT_PROJECTS entry is not a trusted folder and is left out of /new: ${entry}`)
  }
} catch (error) {
  if (!(error instanceof TrustedFoldersUnavailable)) {
    throw error
  }
  log('cannot read Claude Code trusted folders; /new will refuse every folder', error)
}
```

- [ ] **Step 2: Deploy and env**

`deploy/remote-agent.service`, after `EnvironmentFile=…`:

```ini
# claude (~/.local/bin), bun for the mod's hooks (~/.bun/bin), tmux and systemd-run (/usr/bin).
Environment=PATH=%h/.local/bin:%h/.bun/bin:/usr/local/bin:/usr/bin:/bin
```

Append to `.env.example`:

```bash
# Projects offered as buttons by /new (comma-separated, ~ allowed). Each must be a folder you
# trusted in Claude Code; others are ignored. /new <path> also accepts any trusted folder.
REMOTE_AGENT_PROJECTS=
# Where Claude Code keeps its trusted folders (default ~/.claude.json).
# CLAUDE_CONFIG_PATH=
```

- [ ] **Step 3: README**

Under "## 3. Run the Bridge", before the code block, add:

```markdown
Starting Sessions from Telegram (`/new`) needs tmux: `sudo apt install tmux`. Set `REMOTE_AGENT_PROJECTS` in the env file to get one button per project.
```

Since the unit file changed, the copy step there already reinstalls it; add a note after the block:

```markdown
After changing `deploy/remote-agent.service`, copy it again and run `systemctl --user daemon-reload && systemctl --user restart remote-agent`.
```

In "## 5. Using it", add:

```markdown
- `/new` shows one button per project in `REMOTE_AGENT_PROJECTS`; `/new <path>` starts in any folder you trusted in Claude Code (exact folder, not a subfolder). The Bridge creates the Session's Thread, starts `claude` in a detached tmux session, and posts `✅ Ready` when it is up. Send your task in that Thread.
- Attach in a terminal with the command shown in the Thread and in `/status` (`tmux attach -t ra-xxxxxxxx`); detach with `Ctrl-b d`. Telegram keeps working while you are attached.
- `/end` in the Thread of a Session started from Telegram sends `/exit` and kills it after 5 seconds if it is still running.
```

Update the commands line to `Commands: `/new`, `/end`, `/away` …`.

In "## 7. Known limitations", add:

```markdown
- Sessions started with `/new` run with your default permission mode and only in folders you trusted in Claude Code. If a Session is not up within 30 seconds (for example a login prompt), its last screen is posted and it is stopped.
- Sessions started with `/new` survive a Bridge restart, but not a logout or reboot unless lingering is enabled (`loginctl enable-linger`).
- `/end` works only for Sessions started from Telegram.
```

- [ ] **Step 4: Full verification**

Run: `bun test && bun run typecheck`
Expected: all pass (≈ 142 + new tests), typecheck clean.

- [ ] **Step 5: Manual end-to-end** (needs `tmux` installed and the service updated). Create `references/spawn-session-e2e.md` from this template and fill in each result:

```markdown
# Spawned Sessions — end-to-end check

Date: <date> · Claude Code <version> · tmux <version>

| # | Step | Expected | Result |
|---|---|---|---|
| 1 | `/new` in General, tap a project | Thread `<project> · xxxxxxxx`, `⏳ Starting…`, then `✅ Ready` within 30 s | |
| 2 | Send an Instruction in the Thread | Delivered and Claude works on it | |
| 3 | `tmux attach -t ra-xxxxxxxx`, type a prompt locally | Works; Telegram still gets Prompts/Reports | |
| 4 | `systemctl --user restart remote-agent` | Session keeps running; Instructions still delivered after restart | |
| 5 | `/new <untrusted path>` and `/new <trusted>/subfolder` | Refused with the trust message | |
| 6 | `/end` in the Thread | `⏹ Ending…`, Session exits, Thread closed, `tmux ls` no longer lists it | |
| 7 | `/end` in a terminal-started Session's Thread | `Only sessions started from Telegram can be ended remotely.` | |
| 8 | Stop tmux from reaching claude (e.g. temporarily rename `~/.local/bin/claude`), `/new` | After 30 s the screen is posted and the Thread closes | |
```

Run the steps against the systemd service (not `bun run bridge` in a terminal): only the service shows whether `systemd-run --user` and the `PATH` work from the unit. Note in the file anything that differed (for example whether `/exit` via `send-keys` closes Claude Code on the first try).

- [ ] **Step 6: Commit**

```bash
git add src/bridge/main.ts deploy/remote-agent.service .env.example README.md references/spawn-session-e2e.md
git commit -m "feat: start spawned sessions from the bridge service and document /new and /end"
```
