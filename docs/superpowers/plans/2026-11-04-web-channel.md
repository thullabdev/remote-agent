# Web Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Telegram with a Web Channel: a Tailscale-only HTTP + WebSocket server inside the Bridge that stores and serves the complete chat of General and every Session, with answerable Prompts, Web Push and a documented UI contract.

**Architecture:** `WebChannel` implements the existing `Channel` interface and an extra optional `ChatSink` (structured messages) that Notifier/Spawner call. A `ChatLog` in the existing SQLite Store is the source of truth (messages, change events, read cursors, push subscriptions). A `TranscriptReader` tails Claude Code transcript files into the log. `src/web/` is a self-contained boundary; `main.ts` selects channels by config.

**Tech Stack:** Bun, TypeScript, `Bun.serve` (HTTP + WebSocket), `bun:sqlite`, zod, `web-push` (or an in-repo VAPID implementation if the spike rejects it). Tests: `bun test`.

**Spec:** `docs/superpowers/specs/2026-11-04-web-channel-design.md` (approved). UI contract: `docs/superpowers/specs/2026-11-04-web-channel-ui-handoff.md` (keep it in sync; tasks say when). Glossary: `CONTEXT.md`.

## Global Constraints

- Bun + TypeScript only; one process (`remote-agent.service`); web server is a second listener inside the Bridge behind `src/web/`.
- Web server binds `127.0.0.1` only; default port `8787` (`REMOTE_AGENT_WEB_PORT`).
- New env vars exactly: `REMOTE_AGENT_CHANNELS` (comma list, default `web`), `REMOTE_AGENT_WEB_PORT`, `REMOTE_AGENT_WEB_ALLOWED_LOGIN`, `REMOTE_AGENT_WEB_ORIGINS`, `REMOTE_AGENT_WEB_TOKEN` (optional), `REMOTE_AGENT_WEB_STATIC`, `REMOTE_AGENT_VAPID_SUBJECT`. Telegram vars are required only when `telegram` is in `REMOTE_AGENT_CHANNELS`.
- **No truncation** of conversation content stored in or sent by the Web Channel (agent text, Instructions, Prompts, tool inputs). **Exception: tool results are capped at 20 000 characters** — a longer result is stored as its first 20 000 characters + `… [+N chars]`, with `resultTruncated: true` on the `tool_run` message. Push notification previews are short. `redactSecrets` is applied once, on write into the ChatLog (before the cap).
- Auth on every HTTP request and the WebSocket upgrade: `Tailscale-User-Login` equals the allowed login; `Origin` must be on the allow list for WebSocket upgrades and all non-GET/HEAD requests (mandatory); GET/HEAD need a matching `Origin` or `Sec-Fetch-Site: same-origin|none` (amended 2026-11-04: browsers omit Origin on same-origin GETs); state-changing requests need `Content-Type: application/json`; optional bearer token fallback.
- `message.seq` is assigned at creation and immutable; each feed event carries its own `seq`; clients replace updated messages by `id`.
- Unread counts messages with seq > read cursor of kind `agent_text`, `prompt`, `system` only. One **global** read cursor per chat.
- Push rules: Prompts always; Reports only in Away mode; nothing while any client reports `visible && focused`.
- Chat ids: `c_` + UUID; `general` reserved. Web chat id lives in `sessions.chat_id` and is never nulled; `sessions.thread_id` keeps its Telegram meaning.
- Zod validates every wire input. Telegram code stays untouched and working when selected.
- TypeScript style (repo CLAUDE.md): never `if (x) return;` on one line; always braces. Commit messages are plain, with **no** `Co-Authored-By` line.
- Tests live in `test/` mirroring `src/`; fakes in `test/support/`. Run all: `bun test`; types: `bun run typecheck`.

## Review Focus

1. A very large agent message (≈200 KB) must reach the UI whole over HTTP history and over the WebSocket, while a ≈1 MB tool result is capped at 20 000 chars with the marker and `resultTruncated: true`. Pinned in Task 3 (round trip) and Task 8 (WS frame).
2. Two devices answering the same Prompt at once: first wins, the second gets "Already answered.", both clients see the same final `prompt` message. Pinned in Task 7.
3. WebSocket `after` older than retained, or **greater** than the server's current seq (database replaced/reset): server sends `resync`, never silence. Pinned in Task 8.
4. A transcript line half-written when read, and a Bridge restart mid-session: no partial JSON message, no duplicated messages after re-attach. Pinned in Task 11.
5. Requests without an `Origin` header (curl, a non-browser script) and with a mismatching one: WS upgrade and non-GET always 403; GET 403 unless `Sec-Fetch-Site` is same-origin/none. Pinned in Task 5.

---

### Task 1: Spike — verify the unknowns (throwaway code, durable notes)

Gate for Tasks 11 (and 11b), 12 and 15. Output is a notes file, not product code. Spike scripts go in the scratchpad, not the repo.

**Files:**
- Create: `references/web-channel-spike-results.md`

**Interfaces:**
- Produces: a notes file answering, with evidence, each of (a)–(e) below. Later tasks read it.

- [ ] **Step 1: (a) session id.** Start a Spawned Session path by hand (`claude --session-id <uuid>` in tmux with the mod loaded) and confirm the mod's `$.session.id()` equals `<uuid>` and a transcript file named `<uuid>.jsonl` exists under `~/.claude/projects/`. Record the exact directory-name encoding of `cwd` (e.g. `/` and `.` → `-`) with three real examples.
- [ ] **Step 2: (b) transcript format.** Read two real transcripts. Record, with one redacted sample line each: user text, assistant text, assistant `tool_use` (full input present?), user `tool_result` (full output present?), `AskUserQuestion` entries, the field that gives each entry a stable id, timestamps, and how a turn end is recognisable. State whether text and tool I/O are complete (not truncated).
- [ ] **Step 3: (c) busy signal.** Record which transcript pattern or mod event reliably means "turn in progress" vs "idle".
- [ ] **Step 4: (d) `web-push` under Bun.** In a scratch dir: `bun add web-push`, generate VAPID keys, build a `sendNotification` call against a local fake endpoint. Record pass/fail. If it fails, record the failure and that Task 12 implements Web Push itself (VAPID JWT ES256 + aes128gcm payload encryption via `crypto.subtle`).
- [ ] **Step 5: (e) slash commands via the mod.** In a mod scratch hook, call `$.prompt.submit({ text: '/model sonnet', asUser: true })` and `'/<some skill>'`; record whether Claude Code executes them as commands. Result gates Task 15 (skills) and the `/model` alternative.
- [ ] **Step 6: Record decisions.** End the notes file with a "Consequences" list: for each of (a)–(e), which later task variant applies (Task 11 transcript-tail vs Task 11b mod-forwarding; Task 12 `web-push` vs own; Task 15 on/off).
- [ ] **Step 7: Commit**

```bash
git add references/web-channel-spike-results.md
git commit -m "docs: web channel spike results"
```

---

### Task 2: Config — channel selection and web settings

**Files:**
- Modify: `src/bridge/config.ts`
- Modify: `.env.example`
- Test: `test/bridge/config.test.ts`

**Interfaces:**
- Produces: `Config` gains `channels: ('web' | 'telegram')[]`, `web: { port: number; allowedLogin: string; origins: string[]; token: string | null; staticDir: string | null; vapidSubject: string }`. `botToken`, `chatId`, `allowedUserId` become `string | undefined`-style absent unless `telegram` is selected; export `type TelegramConfig = { botToken: string; chatId: number; allowedUserId: number }` and `Config.telegram: TelegramConfig | null`. `Config.web` is `null` when `web` is not selected. `loadConfig(env)` signature unchanged.

- [ ] **Step 1: Write failing tests** in `test/bridge/config.test.ts`: `defaults to channels ['web'] and requires REMOTE_AGENT_WEB_ALLOWED_LOGIN and REMOTE_AGENT_WEB_ORIGINS`; `web only: no Telegram vars needed and telegram is null`; `telegram only: requires the three TELEGRAM_ vars, web is null`; `both selected: requires everything`; `port defaults to 8787 and rejects non-integers`; `origins splits on commas and trims`; `unknown channel name is rejected`; `error message names the missing variable`.
- [ ] **Step 2: Run** `bun test test/bridge/config.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the schema change in `loadConfig`; keep existing messages for Telegram vars. Existing tests that assumed Telegram-only defaults get `REMOTE_AGENT_CHANNELS=telegram`.
- [ ] **Step 4: Update `.env.example`** with every new variable and a one-line comment each.
- [ ] **Step 5: Run** `bun test test/bridge/config.test.ts && bun run typecheck` — expect PASS (typecheck errors in `main.ts` are fixed in Task 14; temporarily keep `main.ts` compiling by reading `config.telegram`, adjusting only that line).
- [ ] **Step 6: Commit** `git commit -m "feat: select channels by config and add web settings"`.

---

### Task 3: ChatLog — messages, events, read cursors

**Files:**
- Create: `src/web/protocol.ts` (wire types + zod; the shapes in the handoff doc §4–§5, exported as `Chat`, `Message`, `MessageBody`, `PromptBodyView`, `ServerEvent`, `ClientEvent`)
- Create: `src/web/chat-log.ts`
- Modify: `src/bridge/store.ts` (add `get database(): Database`; add migration for `sessions.chat_id TEXT`, `setSessionChat(id, chatId)`, `findSessionByChat(chatId)`)
- Test: `test/web/chat-log.test.ts`, `test/bridge/store.test.ts`

**Interfaces:**
- Produces (`ChatLog`, constructed with the Store's `Database` and `now: () => number`):
  - `createChat(input: { id: string; sessionId: string | null; title: string }): Chat`; ensures `general` exists at construction.
  - `appendMessage(chatId: string, body: MessageBody): Message` — redacts every string in `body` with `redactSecrets`, assigns `seq`, emits `message.created` and `chat.updated` events in one transaction.
  - `updateMessage(id: string, body: MessageBody): Message` — emits `message.updated`.
  - `updateChat(id: string, patch: Partial<Pick<Chat, 'title' | 'status' | 'busy'>>): Chat` — emits `chat.updated`.
  - `listChats(): Chat[]` (with `unread`, `lastMessage`), `getChat(id)`, `listMessages(chatId, { before?: number; limit: number }): { messages: Message[]; hasMore: boolean }`, `findMessage(id)`.
  - `markRead(chatId: string, seq: number): void` — cursor only moves forward; emits `chat.updated`.
  - `currentSeq(): number`, `eventsAfter(seq: number): ServerEvent[] | 'resync'` (`'resync'` when `seq` > current or unknown).
  - `clearChat(chatId: string): void` — sets `hidden_before_seq` to current seq (UI-only clear, Task 16 wires the endpoint); `listMessages` skips hidden.
  - `addPushSubscription / removePushSubscription / listPushSubscriptions` (used by Task 12).

- [ ] **Step 1: Write failing tests** (`test/web/chat-log.test.ts`, in-memory path `:memory:`): `appendMessage assigns increasing seq and keeps it after updateMessage`; `redacts secrets on write` (assert `sk-ant-…` becomes `[REDACTED]` in stored body); `stores a 200 KB agent_text without truncation` (assert `.length` equal on read-back — Review Focus 1); `caps a 1 MB tool_run result at 20 000 chars plus the "… [+N chars]" marker and sets resultTruncated`; `a result under the cap is stored whole with resultTruncated false`; `redaction runs before the cap`; `listMessages pages with before and hasMore`; `unread counts only agent_text, prompt and system after the cursor`; `markRead never moves the cursor backwards`; `eventsAfter returns events in seq order, and 'resync' when after is greater than currentSeq`; `clearChat hides earlier messages but keeps later ones`; `general chat exists from the start`.
- [ ] **Step 2: Run** `bun test test/web/chat-log.test.ts` — FAIL.
- [ ] **Step 3: Implement** `protocol.ts` types and zod schemas, then `ChatLog` with tables `chats`, `messages` (JSON body, indexed by `(chat_id, seq)`), `events` (`seq` autoincrement, JSON payload), `read_cursors`, `push_subscriptions`. Use one `db.transaction` per append so message and events share a commit.
- [ ] **Step 4: Store tests** in `test/bridge/store.test.ts`: `setSessionChat persists and survives endSession`; `findSessionByChat returns ended sessions`.
- [ ] **Step 5: Run** `bun test test/web test/bridge/store.test.ts && bun run typecheck` — PASS.
- [ ] **Step 6: Commit** `git commit -m "feat: add the chat log for the web channel"`.

---

### Task 4: WebChannel — the `Channel` contract

**Files:**
- Create: `src/web/web-channel.ts`
- Modify: `test/support/fake-channel.ts` only if a shared contract-test helper is extracted (`test/support/channel-contract.ts`)
- Test: `test/web/web-channel.test.ts`

**Interfaces:**
- Consumes: `ChatLog` (Task 3), `Channel`, `ChannelHandlers` (`src/channel/types.ts`).
- Produces: `class WebChannel implements Channel` with constructor `(chatLog: ChatLog, log: Log)`. `createThread(title)` → creates a chat, returns its `c_` id; `closeThread` → `updateChat(status:'ended')`; `renameThread` → `updateChat(title)`; `sendText(null, …)` → `command_reply` in General, `sendText(chatId, …)` → `system` message; `sendButtons` → `picker` message (`pickerId` taken from the `launch` buttons); `sendPrompt` → one `prompt` message per view item, returns their ids as refs; `markResolved` → `updateMessage` for each ref with `status:'answered'` and appends nothing extra. `handlers` captured in `start(handlers)` and exposed as `readonly handlers: ChannelHandlers | null` for the API layer.

- [ ] **Step 1: Write failing tests:** `createThread returns a c_ id and lists the chat`; `sendText to null lands in General`; `sendButtons creates a picker with choice indexes`; `sendPrompt returns one ref per item and the messages are pending prompts`; `markResolved flips the messages to answered with the note`; `closeThread marks ended and keeps history readable`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** The structured `prompt` content for web comes from Task 5's sink; here `sendPrompt` stores the pre-rendered view text as a fallback body so the Channel contract is complete on its own.
- [ ] **Step 4: Run** `bun test test/web/web-channel.test.ts` — PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: add WebChannel implementing the Channel interface"`.

---

### Task 5: ChatSink — structured messages from Notifier, Spawner, Inbound

**Files:**
- Create: `src/channel/chat-sink.ts`
- Modify: `src/bridge/notifier.ts`, `src/bridge/spawner.ts`, `src/bridge/http.ts`, `src/web/web-channel.ts`
- Test: `test/bridge/notifier.test.ts`, `test/web/web-channel.test.ts`

**Interfaces:**
- Produces: `interface ChatSink { sessionSeen(session: SessionRow): void; promptCreated(prompt: PromptRow, session: SessionRow): void; promptResolved(prompt: PromptRow): void; instructionQueued(instruction: Instruction, session: SessionRow): void; instructionDelivered(instructionId: string): void; report(session: SessionRow, report: Report): void; chatEnded(session: SessionRow): void; busyChanged(sessionId: string, busy: boolean): void; systemMessage(sessionId: string | null, text: string): void }`. `Notifier` gets an optional constructor arg `sink?: ChatSink` and calls it **in addition to** the Channel calls; with no sink behaviour is unchanged. `WebChannel` implements `ChatSink`.
- Behavior: `sessionSeen` creates the chat eagerly (Notifier calls it from `upsertSession` paths: `/prompts`, `/reports`, `/titles`, `/settled`, `/sessions/:id/instructions` in `http.ts`); `promptCreated` stores the structured `PromptBodyView` (tool, summary via `permissionSummary` **without** the 1500-char limit, reason, agentId, per-question `answered`); `report(turn_complete)` is a no-op for messages when the transcript reader is active for that Session (Task 11 provides `isTranscriptActive(sessionId)` via a setter `setTranscriptProbe`) and otherwise appends `agent_text`; `session_started/ended` append `system`; `chatEnded` sets `status:'ended'` **without** nulling `chat_id`.

- [ ] **Step 1: Write failing tests** in `test/bridge/notifier.test.ts` with a recording fake sink: `report session_ended calls chatEnded and keeps the chat id`; `promptCreated passes the structured body to the sink`; `instructionDelivered flips the message`. In `test/web/web-channel.test.ts`: `a permission prompt body is stored with the full untruncated summary` (input command of 50 000 chars round-trips); `turn_complete appends agent_text when no transcript probe says active, and nothing when it does`; `first mod request for an unseen session creates exactly one chat`; `chat survives endSession and history is still listed`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the interface, the optional wiring in Notifier/Spawner/http, and the WebChannel sink methods. Do not change Telegram code paths or messages.
- [ ] **Step 4: Run** `bun test && bun run typecheck` — all PASS (existing Telegram-path tests must stay green unchanged).
- [ ] **Step 5: Commit** `git commit -m "feat: structured chat sink for the web channel"`.

---

### Task 6: Auth

**Files:**
- Create: `src/web/auth.ts`
- Test: `test/web/auth.test.ts`

**Interfaces:**
- Produces: `type AuthConfig = { allowedLogin: string; origins: string[]; token: string | null }`; `authorize(request: Request, config: AuthConfig): { ok: true } | { ok: false; status: 401 | 403; reason: string }`. `reason` never echoes credentials.

- [ ] **Step 1: Write failing tests:** `allows the configured login with a matching Origin`; `rejects a different Tailscale-User-Login with 403`; `rejects a missing Tailscale-User-Login with 401`; `rejects a missing Origin with 403` and `rejects a mismatching Origin with 403` (both for GET and for a WebSocket upgrade request — Review Focus 5); `POST without application/json content type is 403`; `a valid bearer token substitutes for the login header but still needs a matching Origin`; `the reason string never contains the token or the login`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `authorize`; Origin compare is exact on scheme+host+port.
- [ ] **Step 4: Run** `bun test test/web/auth.test.ts` — PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: web channel auth (tailscale login, origin, token)"`.

---

### Task 7: HTTP API

**Files:**
- Create: `src/web/api.ts`
- Test: `test/web/api.test.ts`

**Interfaces:**
- Consumes: `ChatLog`, `WebChannel.handlers` (`ChannelHandlers`), `Store`, `Notifier.away`, `Spawner`.
- Produces: `createApi(deps: { chatLog; handlers: () => ChannelHandlers | null; store; away: AwayMode; spawner: SessionCommands; log: Log }): (request: Request) => Promise<Response | null>` (null = not an API route). Routes and shapes exactly as handoff §3: `GET /api/state`, `GET /api/chats/:id/messages`, `POST /api/chats/:id/messages`, `POST /api/chats/:id/actions` (both body shapes), `POST /api/prompts/:promptId/reply`, `POST /api/chats/:id/read`, `PUT /api/away`, `POST /api/chats/:id/end`.
- Behavior: sending text in General calls `handlers.onCommand` for text starting with `/` (name = first word, args = rest) and otherwise returns a `command_reply` hint; in a Session chat it calls `onText({ thread: chatId, replyTo: null, text })`, appends a `user_text` message (`queued`) before returning, de-duplicated by `clientId` (same `clientId` returns the same message). `…/actions` answer path returns `{ toast }` from `onButton`. Reply path resolves the prompt message ref via `chatLog.findMessage` then `onText({ thread, replyTo: <ref>, text })`.

- [ ] **Step 1: Write failing tests** (use a fake handlers object): `GET /api/state returns seq, away and General first`; `messages paginate with before/limit`; `POST messages in a session chat enqueues an instruction and returns a queued user_text`; `the same clientId twice returns one message`; `POST messages "/status" in General runs the command and a command_reply appears`; `actions with an option index answers the prompt via onButton`; **`two simultaneous actions on the same prompt: exactly one 'Answered' toast and one 'Already answered.', and the prompt message ends answered once`** (Review Focus 2); `reply with free text resolves a question`; `read moves the cursor and unread drops`; `PUT /api/away flips the flag`; `end on a non-spawned session returns 409`; `unknown chat id returns 404`; `invalid JSON returns 400`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** each handler with zod bodies from `protocol.ts`; wrap errors as `{ error }`.
- [ ] **Step 4: Run** `bun test test/web/api.test.ts` — PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: web channel HTTP API"`.

---

### Task 8: WebSocket hub, presence and server

**Files:**
- Create: `src/web/hub.ts`, `src/web/server.ts`
- Test: `test/web/hub.test.ts`, `test/web/server.test.ts`

**Interfaces:**
- Produces: `class Hub` — `add(socket): ClientId`, `remove(id)`, `setPresence(id, { visible: boolean; focused: boolean; chatId: string | null })`, `anyActive(): boolean` (any client `visible && focused`), `broadcast(event: ServerEvent)`, `replay(id, after: number)` (uses `chatLog.eventsAfter`; sends `resync` for `'resync'`). Slow-client policy: close a socket whose `getBufferedAmount()` exceeds 8 MB.
- Produces: `startWebServer(deps: { config: Config['web']; chatLog; api; hub; log }): { port: number; stop(): void }` using `Bun.serve({ hostname: '127.0.0.1', port })` with `fetch` → `authorize` → `api` → static (`REMOTE_AGENT_WEB_STATIC`, SPA fallback to `index.html`) → 404, and `websocket` handlers for `/ws?after=N`. The server subscribes the hub to `ChatLog` events so every append/update is broadcast.

- [ ] **Step 1: Write failing tests** (real `Bun.serve` on port 0 + `WebSocket` client): `unauthorized upgrade is refused with 403`; `connect with after=current gets hello and then live message.created`; `connect with after older replays missed events in order`; **`connect with after greater than the server seq receives resync`** (Review Focus 3); **`a 200 KB agent_text arrives whole in one WS event`** (Review Focus 1); `presence updates anyActive, and closing the socket clears it`; `a client that misses pings is dropped`; `ping gets pong`; `static file is served and unknown path falls back to index.html`; `binds to 127.0.0.1` (assert `server.hostname`).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** hub and server. Server ping every 30 s, drop after two missed.
- [ ] **Step 4: Run** `bun test test/web && bun run typecheck` — PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: web channel WebSocket hub and server"`.

---

### Task 9: Busy state and away events

**Files:**
- Modify: `src/web/web-channel.ts`, `src/bridge/inbound.ts` (emit `away.updated`), `src/web/hub.ts`
- Test: `test/web/web-channel.test.ts`, `test/bridge/inbound.test.ts`

**Interfaces:**
- Produces: `ServerEvent` `away.updated` broadcast whenever `AwayMode.set` is called (command or API); `ChatSink.busyChanged` flips `Chat.busy` via `updateChat`. Until Task 11 lands, `busy` becomes true when an instruction is delivered to the Session and false on `turn_complete`.

- [ ] **Step 1: Failing tests:** `/away and /back and PUT /api/away all broadcast away.updated once`; `busy is true after instructionDelivered and false after turn_complete`.
- [ ] **Step 2–4:** run, implement (AwayMode gets an optional `onChange` callback), run — PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: away and busy events for the web channel"`.

---

### Task 10: Instruction status ticks

**Files:**
- Modify: `src/bridge/http.ts` (delivered route already calls `notifier.instructionDelivered`), `src/web/api.ts`, `src/web/web-channel.ts`
- Test: `test/web/api.test.ts`, `test/bridge/http.test.ts`

**Interfaces:**
- Produces: `ChatLog` message for an Instruction stores `instructionId`; `ChatSink.instructionDelivered(instructionId)` finds it and emits `message.updated` with `status:'delivered'`. Instructions queued by the API return the store's `Instruction.id` so the mapping exists.

- [ ] **Step 1: Failing tests:** `sending in a session chat then POST /instructions/:id/delivered flips the user_text to delivered and broadcasts message.updated`; `delivering twice is idempotent`.
- [ ] **Step 2–4:** run, implement, run — PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: instruction delivery ticks in the web chat"`.

---

### Task 11: TranscriptReader (variant per spike)

Applies if the spike confirms the transcript file is complete (default path). If it does not, do **Task 11b** instead.

**Files:**
- Create: `src/web/transcript/path.ts`, `src/web/transcript/parse.ts`, `src/web/transcript/reader.ts`
- Create: `test/support/transcripts/*.jsonl` (redacted fixtures from the spike)
- Test: `test/web/transcript-path.test.ts`, `test/web/transcript-parse.test.ts`, `test/web/transcript-reader.test.ts`

**Interfaces:**
- Produces: `transcriptPath(home: string, cwd: string, sessionId: string): string` (encoding recorded in the spike notes); `parseTranscriptLine(line: string): TranscriptEntry | null` where `TranscriptEntry = { entryId: string; at: number; item: { kind: 'agent_text'; markdown: string } | { kind: 'tool_use'; toolUseId: string; tool: string; input: unknown } | { kind: 'tool_result'; toolUseId: string; text: string; isError: boolean } | { kind: 'user_text'; text: string } | { kind: 'turn_end' } }` (null for ignorable lines and `AskUserQuestion` entries); `class TranscriptReader { constructor(deps: { chatLog: ChatLog; store: Store; home: string; log: Log; poll?: (run: () => void, ms: number) => () => void }); attach(sessionId: string): Promise<void>; detach(sessionId: string): void; isActive(sessionId: string): boolean }`. The reader maps `tool_use` → `tool_run(status:'running')` and the matching `tool_result` → `updateMessage(status:'done'|'error', result, durationMs)`; whole existing file is ingested on first `attach` in batches of 200 lines; `user_text` entries that match a queued Instruction text are skipped (already shown); sets `busy` per the spike's rule; wired via `Notifier`'s transcript probe (Task 5) and `attach` is called from `sessionSeen`.

- [ ] **Step 1: Failing tests:** `transcriptPath encodes /home/u/Sites/app as the spike's directory name` (use the spike's three examples); `parse: assistant text, tool_use with full input, tool_result with full output`; `parse skips AskUserQuestion entries`; `parse returns null for a malformed line`; reader: `attach backfills the whole file once`; **`a line without a trailing newline is not ingested until completed`** (Review Focus 4); **`detach then attach again (Bridge restart) adds no duplicate messages`** (entry ids already stored are skipped); `tool_use then tool_result updates one tool_run message`; `a 1 MB tool_result is stored capped at 20 000 chars with resultTruncated`; `busy turns true on a user entry and false on turn_end`; `missing file: isActive false, and turn_complete Report text is used instead`; `secrets in transcript text are redacted in the log`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** path and parser from the spike notes; reader keeps a byte offset per session, polls `fs.stat` size every 500 ms (use `fs.watch` only if the spike showed it reliable), reads new bytes, splits on `\n`, keeps the tail fragment, and stores processed `entryId`s via the log (unique index `(chat_id, source_id)` on messages).
- [ ] **Step 4: Run** `bun test test/web && bun run typecheck` — PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: tail session transcripts into the chat log"`.

### Task 11b: Mod-forwarding fallback (only if the spike rejects the transcript file)

**Files:**
- Modify: `mod/remote-agent/hooks/protocol.ts`, `mod/remote-agent/hooks/register.ts`, `src/bridge/schemas.ts`, `src/bridge/http.ts`
- Test: `test/mod/protocol.test.ts`, `test/bridge/http.test.ts`

**Interfaces:**
- Produces: new `Report` kinds `{ kind: 'tool_run'; toolUseId: string; tool: string; input: unknown; result: string | null; isError: boolean; durationMs: number }` and `{ kind: 'agent_text'; text: string }`, emitted by the mod from the `tool.call` hook and the text event the spike identified; Bridge appends them via `ChatSink.report`. `busy` from `turn.start`/`turn.complete`.

- [ ] **Steps:** failing protocol/schema/http tests for each new kind → implement → run `bun test` → commit `git commit -m "feat: forward tool runs and agent text from the mod"`.

---

### Task 12: Web Push

**Files:**
- Create: `src/web/push.ts`
- Modify: `src/web/api.ts` (push routes), `src/web/web-channel.ts`
- Test: `test/web/push.test.ts`

**Interfaces:**
- Produces: `class PushService { constructor(deps: { chatLog: ChatLog; hub: Hub; away: AwayMode; vapid: { publicKey: string; privateKey: string; subject: string }; send: (subscription: PushSubscription, payload: string) => Promise<{ status: number }>; log: Log }); publicKey(): string; subscribe(sub: PushSubscription): void; unsubscribe(endpoint: string): void; notify(event: { kind: 'prompt' | 'report'; chatId: string; title: string; text: string }): Promise<void> }`. `send` defaults to `web-push` (or the in-repo implementation if the spike said so). `loadOrCreateVapid(dataDir: string): { publicKey; privateKey }` persists keys with mode 0600.
- Rules in `notify`: skip if `hub.anyActive()`; skip `report` when `!away.isAway()`; payload `{ chatId, title, preview, kind }` with `preview` = first 140 chars (the only truncation allowed); on `404`/`410` remove the subscription; a failing send never throws.
- Routes: `GET /api/push/key`, `POST /api/push/subscriptions`, `DELETE /api/push/subscriptions`.

- [ ] **Step 1: Failing tests (fake `send`):** `prompt pushes when nobody is active`; `prompt does not push while a client is visible and focused`; `report pushes only in Away mode`; `410 removes the subscription`; `a throwing send is swallowed and others still get the push`; `preview is at most 140 characters while the stored message stays whole`; `VAPID keys are created once and reused`.
- [ ] **Step 2–4:** run, implement, run `bun test test/web/push.test.ts` — PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: web push notifications"`.

---

### Task 13: Reminders and system messages in the web chat

**Files:**
- Modify: `src/bridge/notifier.ts`, `src/web/web-channel.ts`
- Test: `test/bridge/notifier.test.ts`

**Interfaces:**
- Produces: `promptReminder` also calls `sink.systemMessage(sessionId, 'reminder')`-style structured text (`system` message with the session label, no emoji) and triggers `PushService.notify({ kind: 'prompt' })`; prompt creation triggers the same push; `turn_complete`/`session_ended` Reports trigger `notify({ kind: 'report' })`.

- [ ] **Step 1: Failing tests:** `a stale prompt creates one system message and one push`; `a turn_complete in Away mode pushes, out of Away mode does not`.
- [ ] **Step 2–4:** run, implement (inject an optional `onPush` into the sink), run — PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: reminders and push triggers for the web channel"`.

---

### Task 14: Wire `main.ts`, deploy notes and docs

**Files:**
- Modify: `src/bridge/main.ts`, `deploy/remote-agent.service` (only if env or restart settings need it), `README.md`, `CONTEXT.md`, `docs/adr/0004-web-channel.md`
- Test: `test/web/integration.test.ts`

**Interfaces:**
- Consumes: all previous tasks. `main.ts` builds `WebChannel` + `ChatLog` + `Hub` + `PushService` + `TranscriptReader` when `web` is selected, `TelegramChannel` when `telegram` is selected (no composite: if both are selected, log an error and start with web only — documented), starts the web server on `127.0.0.1:port`, includes web shutdown in `shutdown`.

- [ ] **Step 1: Write failing integration test:** boot the real wiring with a temp DB, port 0 and a fake mod client over the Unix socket: `a Prompt posted by the mod appears over the WebSocket, an answer via POST /api/chats/:id/actions reaches the mod's long poll, and a reconnect with after=<seq> replays nothing twice`; `Telegram vars are not needed when only web is selected`; `a web handler exception returns 500 and the Unix socket still answers /health`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** the wiring.
- [ ] **Step 4: Docs.** README: Tailscale setup (document `tailscale serve --bg 8787`, and that `REMOTE_AGENT_WEB_ORIGINS` must hold the MagicDNS URL), env table, iOS Home Screen note. CONTEXT.md: Channel is "Web first; Telegram kept switchable", add **Chat** to the language (`Thread` becomes the Telegram form of a Chat), note Away mode applies to push. ADR-0004: why one service with a boundary, why the log lives in the Bridge, why transcript tailing (and the spike outcome).
- [ ] **Step 5: Run** `bun test && bun run typecheck` — PASS.
- [ ] **Step 6: Commit** `git commit -m "feat: run the web channel in the Bridge"`.

---

### Task 15: Defaults accepted in the spec — projects, clear, fork, skills

**Files:**
- Modify: `src/web/api.ts`, `src/bridge/spawner.ts`, `src/bridge/launcher.ts`, `docs/superpowers/specs/2026-11-04-web-channel-ui-handoff.md`
- Create: `src/web/skills.ts`
- Test: `test/web/api.test.ts`, `test/bridge/spawner.test.ts`, `test/bridge/launcher.test.ts`, `test/web/skills.test.ts`

**Interfaces:**
- `GET /api/projects` → `{ projects: { label: string; cwd: string }[] }` from `TrustedFolders.configuredProjects()` (lets the UI render a picker without `/new`). `POST /api/projects/start` `{ cwd, model? }` → same as `/new <path> --model` → `{ toast }`.
- `POST /api/chats/:id/clear` → `chatLog.clearChat`; emits `chat.updated`; all devices agree.
- `POST /api/chats/:id/fork` → `Spawner.fork(sessionId: string): Promise<string>`; `Launcher.launch` accepts `{ resumeFrom?: string }` and runs `claude --resume <resumeFrom> --fork-session --session-id <newId>` (verify exact flags against the installed CLI in the spike notes first; if unsupported, return 501 and drop the UI mention).
- `GET /api/skills?chatId=` → `{ skills: { name: string; description: string }[] }` from `listSkills(home: string, cwd: string): Promise<Skill[]>` scanning `~/.claude/skills`, `<cwd>/.claude/skills` and enabled plugin skills. **Only if spike (e) passed**; sending a skill is a normal `POST …/messages` with `/<skill> args`.

- [ ] **Step 1: Failing tests:** `projects lists only trusted configured folders`; `start rejects an untrusted cwd with the NOT_TRUSTED text`; `clear hides history and a later message shows`; `fork starts a spawned session with the resume flags (fake tmux argv assertion) and creates a new chat`; `fork of a non-existent session is 404`; `skills finds a SKILL.md with its description from frontmatter`.
- [ ] **Step 2–4:** run, implement, run `bun test` — PASS.
- [ ] **Step 5: Update the handoff doc:** add the four endpoints to §3 and move them out of the §7 gap table (skills only if enabled).
- [ ] **Step 6: Commit** `git commit -m "feat: projects, clear, fork and skills endpoints for the web UI"`.

---

### Task 16: Final verification and handoff sync

**Files:**
- Modify: `docs/superpowers/specs/2026-11-04-web-channel-ui-handoff.md`

- [ ] **Step 1:** Run `bun test && bun run typecheck`; expect all green.
- [ ] **Step 2:** Manual check with a real Bridge and `tailscale serve`: `curl` without `Origin` → 403; with the right `Origin` and login header (via `tailscale serve`) → `/api/state` JSON; open a WebSocket from a second device; trigger a real Prompt and answer it from the API.
- [ ] **Step 3:** Diff the handoff doc against `src/web/protocol.ts` and `src/web/api.ts`; fix any drift, then mark its status "matches implementation".
- [ ] **Step 4: Commit** `git commit -m "docs: sync the UI handoff with the implementation"`.
