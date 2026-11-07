# Usage in Bridge and Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each session's context usage and the account's 5-hour and 7-day limits with reset times in the Bridge and the web UI, fed by the remote-agent mod's `session.measure` hook.

**Architecture:** The mod reports `session.measure` to the Bridge over the existing Unix socket. The Bridge keeps the latest reading per session in SQLite, resolves each session to its chat, and broadcasts an ephemeral `usage.updated` event through the web Hub (not `ChatLog`, which persists with `seq`). `GET /api/state` returns the same view so page load is complete. The UI shows account limits in the chat list, context per chat in the header, and details in the info panel.

**Tech Stack:** Bun (runtime, `bun:sqlite`, `bun test`), TypeScript, zod, React 19, Tailwind, Vite.

**Spec:** `references/usage-in-bridge-and-web-spike-results.md` (evidence: the `session.measure` payload, its live probe, the hooks import restriction, and the unit mismatch with the status line).

## Global Constraints

- `resets_at` from the mod is an ISO 8601 string; the Bridge stores and exposes epoch milliseconds (`resetsAtMs: number`). `percentUsed` is 0-100 and is kept as given.
- Only `kind` values `five_hour` and `seven_day` are handled. Any other kind (including `spend_limit`) is ignored.
- Account limits come from the freshest reading that has a non-empty `rateLimits`. A window whose `resetsAtMs` is at or before `now` is dropped.
- Mod hooks may import only their own relative files and `claude-code`. Network I/O uses `$.http.fetch(..., { socketPath })`.
- Mod posts are fire-and-forget: a failure must never block the stock handler or throw out of `session.measure`. `next(e)` is always called.
- TypeScript: use braced `if` blocks, never `if (!x) return;` on one line (repo CLAUDE.md).
- Commit messages are the plain message only: no `Co-Authored-By` trailer, no "Generated with" line (matches `docs/superpowers/plans/2026-10-06-permission-request-hook.md`).
- Do not touch the user's `~/.claude/settings.json` or `~/.claude/statusline-command.sh`.
- The pre-existing uncommitted changes in `src/ui/components/message-feed.tsx` and the untracked `src/ui/agents.ts` are not part of this work. Do not stage them.

## Review Focus

1. **No subscription** (`rateLimits` is `[]`): the account strip is hidden, not shown as 0%. Pinned by Task 1 and Task 6.
2. **Expired window** (`resetsAt` already in the past): the window is dropped, not shown as "resets now". Pinned by Task 1.
3. **Bridge unreachable while a session is busy**: the mod hook swallows the error and still calls `next(e)`. Pinned by Task 3.
4. **Client loads or reconnects around an update**: `/api/state` carries `usage`; a `usage.updated` event without `seq` is accepted and does not break seq tracking. Pinned by Task 5 and Task 6.
5. **Unknown or oversized limit kinds** (`spend_limit` at 140%, or an unknown `kind`): ignored and never rendered as a window. Pinned by Task 1.

---

### Task 1: Pure usage model in the Bridge

**Files:**
- Create: `src/bridge/usage.ts`
- Create: `test/bridge/usage.test.ts`
- Modify: `src/channel/web/protocol.ts` (add the view types only; see Task 5 for the event)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type RateLimitInput = { kind: string; percentUsed: number; resetsAt?: string }`
  - `type ContextInput = { tokens?: number; window: number; percent?: number }`
  - `type UsageReport = { context: ContextInput; rateLimits: RateLimitInput[]; cost?: { usd: number } }`
  - `type LimitView = { usedPercent: number; resetsAtMs: number }`
  - `type SessionUsageView = { measuredAt: number; contextPercent: number | null; contextTokens: number | null; contextWindow: number; costUsd: number | null }`
  - `type AccountUsageView = { fiveHour: LimitView | null; sevenDay: LimitView | null; measuredAt: number } | null`
  - `function accountLimits(rateLimits: RateLimitInput[], now: number): Pick<NonNullable<AccountUsageView>, 'fiveHour' | 'sevenDay'> | null`. Returns `null` when neither window survives.
  - `function sessionUsage(report: UsageReport, now: number): SessionUsageView`
- In `src/channel/web/protocol.ts`: export `type UsageView = { account: AccountUsageView; chats: Record<string, SessionUsageView> }`. Task 5 adds it to the event union.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from 'bun:test'
import { accountLimits, sessionUsage } from '../../src/bridge/usage.ts'

const now = Date.parse('2026-11-07T10:00:00Z')

test('keeps five_hour and seven_day, converting ISO resets to epoch ms', () => {
  const limits = accountLimits(
    [
      { kind: 'five_hour', percentUsed: 2, resetsAt: '2026-11-07T14:00:00.000Z' },
      { kind: 'seven_day', percentUsed: 64, resetsAt: '2026-11-08T12:00:00.000Z' },
    ],
    now,
  )
  expect(limits).toEqual({
    fiveHour: { usedPercent: 2, resetsAtMs: Date.parse('2026-11-07T14:00:00.000Z') },
    sevenDay: { usedPercent: 64, resetsAtMs: Date.parse('2026-11-08T12:00:00.000Z') },
  })
})

test('empty rateLimits means no account view (no subscription)', () => {
  expect(accountLimits([], now)).toBeNull()
})

test('drops a window whose reset has passed, and ignores other kinds', () => {
  const limits = accountLimits(
    [
      { kind: 'five_hour', percentUsed: 80, resetsAt: '2026-11-07T09:00:00.000Z' },
      { kind: 'spend_limit', percentUsed: 140, resetsAt: '2026-11-08T00:00:00.000Z' },
    ],
    now,
  )
  expect(limits).toBeNull()
})

test('a window with no resetsAt is dropped', () => {
  expect(accountLimits([{ kind: 'seven_day', percentUsed: 10 }], now)).toBeNull()
})

test('sessionUsage maps the context fill and cost', () => {
  const view = sessionUsage({ context: { tokens: 25230, window: 1000000, percent: 3 }, rateLimits: [], cost: { usd: 0.00025 } }, now)
  expect(view).toEqual({ measuredAt: now, contextPercent: 3, contextTokens: 25230, contextWindow: 1000000, costUsd: 0.00025 })
})

test('sessionUsage uses null for context before the first response', () => {
  const view = sessionUsage({ context: { window: 200000 }, rateLimits: [] }, now)
  expect(view.contextPercent).toBeNull()
  expect(view.contextTokens).toBeNull()
  expect(view.costUsd).toBeNull()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/bridge/usage.test.ts`
Expected: FAIL with "Cannot find module '../../src/bridge/usage.ts'".

- [ ] **Step 3: Implement the two functions and the view types**

Put the input and view types from Interfaces in `src/bridge/usage.ts`. `accountLimits` keeps only `five_hour` and `seven_day` entries that have a finite `percentUsed` and a parseable `resetsAt` later than `now`. Return `null` when neither survives. `sessionUsage` maps `tokens`, `percent` and `cost.usd`, using `null` for each missing field. Add `UsageView` to `src/channel/web/protocol.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/bridge/usage.test.ts`
Expected: 6 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/bridge/usage.ts test/bridge/usage.test.ts src/channel/web/protocol.ts
git commit -m "Add the pure usage model for session and account limits"
```

---

### Task 2: Store the latest usage per session

**Files:**
- Modify: `src/bridge/store.ts` (table in `SCHEMA` or `migrate()`; two methods)
- Test: `test/bridge/store.test.ts` (add cases)

**Interfaces:**
- Consumes: `SessionUsageView`, `AccountUsageView`, `accountLimits`, `RateLimitInput` from Task 1.
- Produces, on `Store`:
  - `recordUsage(sessionId: string, report: UsageReport): SessionUsageView`. Writes the row, then returns the view.
  - `usageForChats(now: number): { account: AccountUsageView; chats: Record<string, SessionUsageView> }`. Joins `usage_snapshots` to `sessions.chat_id`; skips sessions with no chat.

- [ ] **Step 1: Write the failing tests**

Use the existing store test helper (a temp path per test). Assert:

```ts
test('records usage and maps it to the session chat', () => {
  const store = newStore()
  store.upsertSession({ id: 's1', cwd: '/p', chatId: 'chat-1' }) // use the existing session-upsert API; check its exact name in store.ts
  store.recordUsage('s1', { context: { tokens: 100, window: 1000, percent: 10 }, rateLimits: [] })
  expect(store.usageForChats(Date.now()).chats['chat-1']?.contextPercent).toBe(10)
})

test('account limits come from the freshest reading that has rateLimits', () => {
  // s1 reports windows at t0, s2 reports an empty rateLimits at t1 > t0: account still shows s1's windows.
})

test('a second report for the same session replaces the first', () => { /* one row per session */ })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/bridge/store.test.ts`
Expected: FAIL with "recordUsage is not a function".

- [ ] **Step 3: Implement the table and methods**

Create `usage_snapshots` with `session_id TEXT PRIMARY KEY REFERENCES sessions(id)`, `measured_at INTEGER NOT NULL`, `context_tokens INTEGER`, `context_window INTEGER NOT NULL`, `context_percent REAL`, `cost_usd REAL`, `rate_limits TEXT NOT NULL` (JSON of the `RateLimitInput[]`, so the account view can be rebuilt on read). Use `INSERT ... ON CONFLICT(session_id) DO UPDATE`. In `usageForChats`, read the newest row whose `rate_limits` is not `'[]'` for the account view, and every row's `chat_id` for `chats`. Store the `measuredAt` clock through the Store's `now` parameter.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/bridge/store.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/bridge/store.ts test/bridge/store.test.ts
git commit -m "Store the latest usage reading per session"
```

---

### Task 3: The mod reports `session.measure`

**Files:**
- Modify: `mod/remote-agent/hooks/protocol.ts` (add `UsageRequest`)
- Modify: `mod/remote-agent/hooks/bridge-client.ts` (add `usage(request)`)
- Modify: `mod/remote-agent/hooks/register.ts` (add the `session.measure` handler)
- Test: `test/mod/bridge-client.test.ts`, `test/mod/protocol.test.ts` (add cases)

**Interfaces:**
- Consumes: `UsageReport` shape (structurally the same as the event's `context`, `rateLimits`, `cost`).
- Produces:
  - `export type UsageRequest = { session: SessionInfo; usage: UsageReport }` in `protocol.ts`, with the `UsageReport` fields inline so the file stays dependency-free.
  - `BridgeClient.usage(request: UsageRequest): Promise<void>`, which posts to `/usage` with `send`.

- [ ] **Step 1: Write the failing tests**

```ts
test('usage posts the request to /usage', async () => {
  const calls: { path: string; method?: string; body?: string }[] = []
  const client = new BridgeClient(async (path, init) => {
    calls.push({ path, method: init?.method, body: init?.body })
    return { status: 202, text: '' }
  })
  await client.usage({ session: { sessionId: 's1', cwd: '/p' }, usage: { context: { window: 1000 }, rateLimits: [] } })
  expect(calls[0]?.path).toBe('/usage')
  expect(calls[0]?.method).toBe('POST')
})
```

For the hook, add a test that calls the handler from `register` with a fake `$` whose `http.fetch` rejects, and asserts the handler resolves and `next` was called once. Check the existing hook test helpers in `test/mod/flows.test.ts` for how a fake engine is built, and reuse them.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/mod`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement**

In `register.ts`, add `on('session.measure', async ($, e, next) => { ... })`. Build `{ session: await sessionInfo($), usage: { context: e.context, rateLimits: e.rateLimits, cost: e.cost } }` and post it with `void bridge.usage(...).catch(() => undefined)`, inside a `try` so `bridgeFor` failures are also swallowed. Then `return next(e)`. Do not call `$.session.usage()`: `e` already has the figures. Keep `SessionUsageArgs` out of this path.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/mod`
Expected: all pass.

- [ ] **Step 5: Verify against a real session** (manual, not a test)

Run `claude -p "Reply with the single word: ok" < /dev/null` from a scratch directory with the real `remote-agent` mod enabled, and with the Bridge running (`bun run src/bridge/main.ts`). Expected: the Bridge log shows a `POST /usage` 202, and `sqlite3 remote-agent-dev.db 'select * from usage_snapshots'` (or the store API) has a row for that session. Note: the real mod was not yet exercised with `session.measure`; this step does that.

- [ ] **Step 6: Commit**

```bash
git add mod/remote-agent/hooks/protocol.ts mod/remote-agent/hooks/bridge-client.ts mod/remote-agent/hooks/register.ts test/mod
git commit -m "Report session usage from the mod on session.measure"
```

---

### Task 4: Bridge route `POST /usage`

**Files:**
- Modify: `src/bridge/schemas.ts` (add `UsageRequestSchema`)
- Modify: `src/bridge/http.ts` (add the route; add an optional `onUsage` to `HttpDeps`)
- Test: `test/bridge/http.test.ts` (add cases)

**Interfaces:**
- Consumes: `Store.recordUsage`, `Store.usageForChats` from Task 2; `UsageRequest` from Task 3.
- Produces: `HttpDeps.onUsage?: (view: UsageView) => void`. Called after each recorded report with `deps.store.usageForChats(Date.now())`.

- [ ] **Step 1: Write the failing tests**

```ts
test('POST /usage records the reading, answers 202 and calls onUsage', async () => {
  let delivered: UsageView | undefined
  const handler = createHandler({ ...testDeps(), onUsage: view => { delivered = view } })
  const response = await handler(new Request('http://bridge/usage', { method: 'POST', body: JSON.stringify({ session: { sessionId: 's1', cwd: '/p' }, usage: { context: { window: 1000 }, rateLimits: [] } }) }))
  expect(response.status).toBe(202)
  expect(delivered).toBeDefined()
})

test('POST /usage with a bad body answers 400', async () => {
  const handler = createHandler(testDeps())
  const response = await handler(new Request('http://bridge/usage', { method: 'POST', body: '{}' }))
  expect(response.status).toBe(400)
})
```

Use the existing `testDeps()` helper in `test/bridge/http.test.ts`; check its name first.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/bridge/http.test.ts`
Expected: FAIL, route returns 404.

- [ ] **Step 3: Implement**

Add `UsageRequestSchema` with `session: SessionInfoSchema` and `usage` holding `context` (`window` a non-negative number, `tokens` and `percent` optional numbers), `rateLimits` (array of `{ kind: string, percentUsed: number, resetsAt: string optional }`), and optional `cost`. In `route()`, add `if (method === 'POST' && path === '/usage')`, parse, call `deps.store.recordUsage`, then `deps.onUsage?.(deps.store.usageForChats(Date.now()))`, then `return empty(202)`. Do not wrap `onUsage` in a try: the existing `createHandler` catch already logs and returns 500. Better: wrap it so a broadcast failure logs and still returns 202, matching `/reports`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/bridge/http.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/bridge/schemas.ts src/bridge/http.ts test/bridge/http.test.ts
git commit -m "Accept session usage reports on the Bridge"
```

---

### Task 5: Web Hub event and `/api/state`

**Files:**
- Modify: `src/channel/web/protocol.ts` (add `usage.updated` to `ServerEvent`, with no `seq`)
- Modify: `src/channel/web/api.ts` (`state()` adds `usage`)
- Modify: `src/channel/web/web-channel.ts` (add `usageChanged(view: UsageView)` that calls `hub.broadcast`)
- Modify: `src/bridge/main.ts` or the wiring that builds `HttpDeps` (pass `onUsage` to the web channel)
- Test: `test/channel/web` (add cases; check existing file names there), `test/bridge/http.test.ts` is already done in Task 4.

**Interfaces:**
- Consumes: `UsageView` from Task 1.
- Produces:
  - `ServerEvent` gains `{ type: 'usage.updated'; usage: UsageView }`. It has no `seq`. `chatLog.publish` is not involved.
  - `WebChannel.usageChanged(usage: UsageView): void`.
  - `GET /api/state` response gains `usage: UsageView`, from `usageForChats` via `ApiDeps`.

- [ ] **Step 1: Write the failing tests**

- In the web channel test: after `usageChanged(view)`, a client added to the Hub receives `{"type":"usage.updated", ...}` and the object has no `seq` key.
- In the api test: `GET /api/state` includes `usage` with the chats map.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/channel/web`
Expected: FAIL.

- [ ] **Step 3: Implement**

Keep the `ServerEvent` union's other members unchanged. `WebChannel.usageChanged` calls `this.hub.broadcast({ type: 'usage.updated', usage })`. Wire `onUsage` in the Bridge's composition root (`src/bridge/main.ts` or the file that calls `createHandler`) to the web channel. Pass a usage getter into `ApiDeps` so `state()` can call `store.usageForChats(Date.now())`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/channel/web test/bridge`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/channel/web src/bridge/main.ts
git commit -m "Broadcast usage to web clients and include it in state"
```

---

### Task 6: UI state, parsing and display

**Files:**
- Modify: `src/ui/use-web-channel.ts` (parse `usage.updated`, keep `usage` in state; initialise from `/api/state`)
- Modify: `src/ui/api.ts` (type of the state response includes `usage`)
- Create: `src/ui/usage-format.ts` (pure: percent rounding, "resets 14:00 (in 4h 0m)" text, bar width). Reuse the logic already in `spike/usage/usage.ts`, adjusted to take `resetsAtMs`.
- Modify: `src/ui/components/chat-list.tsx` (account strip: 5h and 7d bars and reset text; hidden when `usage.account` is null)
- Modify: `src/ui/components/chat-header.tsx` (context percent for this chat; hidden when `contextPercent` is null)
- Modify: `src/ui/components/chat-info.tsx` (context tokens and window, cost, and the same account windows)
- Test: `test/ui/usage-format.test.ts`, `test/ui/realtime.test.ts` (add the parse cases), and a component test for the strip if the existing `test/ui/chat-list.test.ts` pattern allows.

**Interfaces:**
- Consumes: `UsageView`, `SessionUsageView`, `LimitView` from Task 1 and the protocol file.
- Produces: `usage-format.ts` exports `formatLimitText(limit: LimitView, now: number): string` and `formatContextText(view: SessionUsageView): string | null`.

- [ ] **Step 1: Write the failing tests**

- `usage-format.test.ts`: `formatLimitText` returns `"2% · resets 14:00 (in 4h 0m)"` for a limit 4 h ahead of a fixed `now`, with the time zone pinned in the test (pass a `timeZone` argument, as the spike did, so the test is not host-dependent).
- `realtime.test.ts` (or the parser test in `use-web-channel`): a `usage.updated` line with no `seq` is accepted and updates usage; a `seq`-less `message.created` is still rejected.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/ui`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `parseServerEvent`, handle `usage.updated` before the `seq` check, with a guard that `usage` is an object with a `chats` record. Hide each surface when its value is null: the strip when `account` is null, the context pill when `contextPercent` is null. Use the Tailwind colour thresholds from the user's existing status line (green under 50, yellow under 80, red otherwise) so the two presentations agree.

- [ ] **Step 4: Run tests and typecheck**

Run: `bun test test/ui && bun run typecheck`
Expected: all pass, no type errors in the touched files.

- [ ] **Step 5: Commit**

```bash
git add src/ui test/ui
git commit -m "Show account limits and context usage in the web UI"
```

---

### Task 7: End-to-end check

**Files:** none changed unless a defect is found.

- [ ] **Step 1: Full suite**

Run: `bun test && bun run typecheck`
Expected: all pass.

- [ ] **Step 2: Bridge plus real session**

Start the Bridge, open the web UI (`bun run dev` or the built `dist/`), then run `claude -p "Reply with the single word: ok" < /dev/null` in a scratch directory with the mod enabled. Expected: the chat list strip shows 5h and 7d with reset times within a few seconds, and the chat's header shows its context percent. Reload the page: the same values appear from `/api/state`.

- [ ] **Step 3: Resilience check**

Stop the Bridge, run one `claude -p` call, and confirm the call still exits 0 and produces its normal output. Restart the Bridge and confirm the UI recovers at the next reading.

- [ ] **Step 4: Commit any fixes** (only if Step 1-3 found defects; otherwise nothing to commit).

---

## Open decisions to confirm before starting

- Whether the account strip belongs in the chat list (proposed), the chat header, or both.
- Whether to persist usage across Bridge restarts (proposed: yes, via the `usage_snapshots` table) or start empty.
- Whether `spend_limit` (gateway users) should be shown in a later pass (proposed: out of scope).
