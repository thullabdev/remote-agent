# Web Channel — Design Spec

Date: 2026-11-04 · Status: APPROVED 2026-11-04 (defaults in "Decisions for the user" accepted; single-user machine assumed) · Glossary: [`CONTEXT.md`](../../../CONTEXT.md) · Builds on: [Remote Agent design](2026-10-06-remote-agent-design.md), [Spawn from Channel](2026-10-07-spawn-session-from-channel-design.md) · UI contract: [Web Channel UI handoff](2026-11-04-web-channel-ui-handoff.md)

## Intent

Telegram is being switched off. Replace it with a **Web Channel**: a server that holds a WebSocket and serves a Telegram-like chat UI, reachable from the user's own devices over Tailscale. The UI is built separately later (a prototype exists at `references/UI-prototype.html`); this spec covers the **backend only** and ends in a handoff document so the UI can be built against a stable contract.

Why it matters beyond swapping Telegram out: the browser has no server-side chat history the way Telegram does, and it can show far more than Telegram can. So the Web Channel owns a full message log, shows the **complete, untruncated** conversation of every Session (agent text, tool activity, Prompts, Reports, Instructions), and pushes notifications to the user's devices.

## Goals

1. A chat list of **General plus every Session** on the machine (not only spawned ones), with unread counts, last-message preview, and a busy ("typing") indicator.
2. Per Session, a full chat: the agent's text and tool activity as complete messages, Prompts answerable by option or free text, Instructions sent by the user.
3. **No truncation of conversation content in the Web Channel.** Telegram's 4096-character cut (`renderHtml`) and the clipping in `views.ts` do not apply: agent text, Instructions, Prompts and tool inputs are stored and sent whole. **Exception (user decision 2026-11-04): tool results are capped** at 20 000 characters; a longer result is stored as its first 20 000 characters plus a marker `… [+N chars]` and the message carries `resultTruncated: true`. Notification previews are short, by nature.
4. A **General** chat that runs the existing commands (`/new`, `/end`, `/away`, `/back`, `/status`) and starts Sessions.
5. Several devices connected at once, all showing the same live state; first Answer wins, as today.
6. **Web Push** notifications, same rules as Telegram: Prompts always, Reports only in Away mode, skipped while any device has the UI open and visible.
7. Reachable only over Tailscale; only the user's identity is accepted.
8. Telegram off by configuration; its code stays.

## Non-goals

- Building the UI (a handoff document replaces it).
- Attachments, images, voice, message editing/deleting, multiple users, public-internet exposure.
- An LLM behind General. General is a command surface, not an agent (see "Decisions for the user").
- Replacing the mod: Sessions still reach the Bridge through it ([ADR-0001](../../adr/0001-mod-as-session-client.md)).

## Anti-goals

- A web layer bug that stops sessions from being answerable (Bridge crash). The web boundary must contain its own failures.
- Showing a secret because truncation used to hide it: redaction stays (see below).
- Two Channels both acting on one Prompt message and desyncing.

## Constraints

- Stack: **Bun + TypeScript**, `Bun.serve` (HTTP + built-in WebSocket), `bun:sqlite` in the existing Store, zod for every wire schema. One new dependency at most (`web-push`, or a small VAPID implementation if it misbehaves under Bun; verify in a spike).
- **One service**: the web server runs inside the Bridge process (`remote-agent.service`) as a second listener, behind a clear module boundary (`src/web/`) so it can be split out later. The Unix socket for the mod is unchanged.
- Coding rule: no short-if early returns in TypeScript (use braces).

## Architecture

```
Claude Code sessions ──mod──► Unix socket ─┐
                                           ▼
                    ┌──────────────── Bridge process ────────────────┐
                    │ PromptService · Notifier · Spawner · Inbound   │
                    │            │ Channel interface                 │
                    │            ▼                                   │
                    │  WebChannel ──► ChatLog (SQLite: messages,     │
                    │       ▲            events, read cursors, push) │
                    │       │                                        │
                    │  TranscriptReader (per Session) ──► ChatLog    │
                    └───────┬────────────────────────────────────────┘
                            │ 127.0.0.1:PORT  (HTTP + WebSocket + static UI)
                     tailscale serve (HTTPS, identity header)
                            │
                      phone / laptop / tablet browsers
```

### WebChannel (implements `Channel`)

Reuses the existing `Channel` seam for everything Telegram-shaped (text, buttons, prompts, threads), so Spawner, Inbound and PromptService keep working. It is **not** enough on its own, so these changes are in scope (my call):

- **Structured side-API.** `Channel` stays as is (Telegram untouched). WebChannel additionally implements an optional `ChatSink` interface that `Notifier`/`Spawner`/`Inbound` call when present: `systemMessage(kind, text)`, `commandReply(text)`, `promptCreated(prompt: PromptRow, session)` (the structured `PromptBody`, not pre-rendered text), `instructionDelivered(instructionId)` (flips `user_text` `queued`→`delivered`), `chatEnded`, `busyChanged`. Text with emoji built for Telegram (`📨 Delivered`, `⏰ Still waiting`) is not shown in the web UI; the sink gets the facts and the UI words them.
- **Ended chats keep their link.** `Notifier.endSession` nulls `sessions.thread_id` after closing the Thread. The web chat id is therefore stored in a separate `sessions.chat_id` column that is never nulled, so ended Sessions stay listed with readable history. `thread_id` keeps its Telegram meaning.
- **Eager chat creation.** The web chat is created when the Bridge first learns of a Session (`upsertSession`: session_started Report, or any mod request), not lazily on the first Prompt. A Session the Bridge has never heard from (mod not loaded or never called) cannot be listed. Sessions already running when the Bridge starts appear on their next mod call (the mod polls every 3 s, so within seconds).

- `createThread(title)` creates a chat and returns its id (a generated id; stored as `sessions.thread_id` exactly as Telegram's topic id is). `closeThread` marks the chat ended. `renameThread` updates its title.
- `sendText`, `sendButtons`, `sendPrompt` append messages to the ChatLog and return their ids as `MessageRef`s. `markResolved` updates the Prompt messages and appends the resolution note.
- A `null` thread means **General**.
- Inbound: the HTTP/WS layer calls the existing `ChannelHandlers` (`onText`, `onButton`, `onCommand`). A reply to a Prompt message, a button tap and plain text keep their current meaning.
- Channel selection: `REMOTE_AGENT_CHANNELS` (comma list, default `web`). Telegram's env vars become required only when `telegram` is listed. `main.ts` builds the selected channel(s); a composite fan-out is out of scope until two are wanted at once.

### ChatLog (new, in the Store)

Source of truth for everything the UI shows.

- `messages`: complete, untruncated content. Fields: id, chat id (null = General), kind, role, JSON body, created_at, plus `seq` (a global monotonic number).
- `events`: append-only change feed, each with a monotonic `seq`: `message.created`, `message.updated`, `chat.updated` (title, ended, busy, unread), so clients resume with "everything after N". If N is older than what is retained the server answers `resync` and the client reloads state. Retention: none at first; single-user volumes are small. Builder may add pruning.
- `read_cursors`: one **global** read position per chat (not per device); marking read on any device clears the unread count on all.
- `push_subscriptions`: endpoint, keys, created_at, last_seen.
- Redaction (`redactSecrets`) is applied once, on write into the log. The UI never receives unredacted secrets. (A setting to turn this off is possible later; default stays on.)
- Message kinds: `user_text` (Instruction; status `queued`→`delivered`), `agent_text` (Markdown, complete), `tool_run` (tool name, full input, full result, duration, status), `prompt` (structured Question/Permission with options; status `pending`→`answered` with resolution and source), `system` (started, ready, ended, errors, reminders), `command_reply`, `picker` (buttons, e.g. `/new` projects).

### TranscriptReader (new)

Today the Bridge sees only Prompts, turn-complete Reports (which do carry the **full** final answer text), titles and Instructions. It does not see tool activity or in-turn text. To show a full conversation:

- **My call (needs a spike):** the Bridge tails each active Session's Claude Code transcript file (`~/.claude/projects/<project>/<sessionId>.jsonl`) and converts entries into `agent_text` and `tool_run` messages. Reasons: it works for every Session including ones started before the Bridge, it needs no new mod hooks, and it contains complete tool inputs/results. Risk: the file format is not a stable public contract. Fallback: have the mod forward `tool.call` events (it already hooks that event) and text.
- The reader also feeds the **busy** flag (a turn is in progress until the last entry is final / `turn_complete` arrives).
- De-duplication: when the reader is active for a Session, `turn_complete` Report text is **not** appended again as a message; Reports in the Web Channel only add `system` messages (started/ended). `AskUserQuestion` tool entries in the transcript are skipped because the Prompt message already represents them.
- Instructions flow unchanged (queue → mod polls every 3 s → delivered); the UI shows `queued` then `delivered` from the existing delivery confirmation.

### Web server (`src/web/`)

- `Bun.serve` on `127.0.0.1:REMOTE_AGENT_WEB_PORT` (default 8787). Never binds a public interface.
- Routes: JSON API + one WebSocket + static files from `REMOTE_AGENT_WEB_STATIC` (the future UI build) with SPA fallback. Exact contract: see the handoff document.
- **Auth (all HTTP and the WebSocket upgrade):**
  1. `Tailscale-User-Login` (added by `tailscale serve`) must equal `REMOTE_AGENT_WEB_ALLOWED_LOGIN`.
  2. **`Origin` must match the allowed host list** (`REMOTE_AGENT_WEB_ORIGINS`) on every request and upgrade. This is mandatory: a hostile page open in the user's own browser on the tailnet would otherwise reach the server with the identity header attached (cross-site WebSocket / request forgery).
  3. State-changing requests require `Content-Type: application/json`.
  4. Optional fallback `REMOTE_AGENT_WEB_TOKEN` (bearer) for access not going through `tailscale serve`.
  Anything else gets 401/403 and is logged without echoing the credentials.
- **Presence:** each WebSocket client reports `{visible, focused, chatId}`. The server keeps this in memory per connection (dropped on close/timeout) and exposes "any client visible and focused" to the push decision.
- **Push:** Web Push with VAPID keys generated once and stored in the data dir. Triggers mirror Telegram: Prompt created → always; Report (turn finished, session ended) → only when Away mode is on; both skipped when any client is visible and focused. Payload: chat id, title, and a short preview (notification bodies are inherently short; the UI fetches the full message). Click opens the chat. Subscriptions answering 404/410 are pruned. On iOS, Web Push works only for a page added to the Home Screen; document in the handoff.
- **Failure containment:** every handler is wrapped; an exception returns 500 and logs, never reaches the Bridge's mod listener. The WebSocket send path drops slow clients instead of buffering without bound.

## Data and flows

- **New Session from UI:** same as today: `/new` in General produces a `picker` message with one button per trusted project (and `--model` support from the latest commit); a tap calls `onButton({kind:'launch'})`; Spawner creates the chat via `ensureThread` **before** launching, so no duplicate chat is created.
- **Prompt:** mod posts a Prompt → PromptService → Notifier → WebChannel appends a `prompt` message (events fan out over WS; push if the rules say so). Answering by option/free text/permission allow-deny calls the existing Inbound path; the first Answer wins and the message is updated to `answered` (source local/remote).
- **Reminder:** the existing 30-minute reminder becomes a `system` message (and a push).
- **Reconnect:** client connects `/ws?after=N`; server replays events > N or sends `resync`.
- **Ended Sessions:** stay listed (marked ended, history readable); a setting/endpoint to hide old ones is left to the builder.

## Config (new)

`REMOTE_AGENT_CHANNELS`, `REMOTE_AGENT_WEB_PORT`, `REMOTE_AGENT_WEB_ALLOWED_LOGIN`, `REMOTE_AGENT_WEB_ORIGINS`, `REMOTE_AGENT_WEB_TOKEN` (optional), `REMOTE_AGENT_WEB_STATIC`, `REMOTE_AGENT_VAPID_SUBJECT`. Validated with zod like the existing config; startup fails loudly on a missing required value for an enabled channel.

## Testing

Follow the existing style: `bun test`, fakes in `test/support/`. Cover: ChatLog (seq/events/resume/resync), WebChannel against the `Channel` contract using the same cases as `FakeChannel`, auth (allowed login, wrong login, missing/forged Origin, WS upgrade), presence-based push suppression, push pruning, TranscriptReader on recorded transcript fixtures (including `AskUserQuestion` skip and de-duplication), unread/read cursor, and a reconnect-with-replay integration test over a real `Bun.serve` on an ephemeral port.

## Calls made while preparing this spec (mine, not the user's)

1. **Transcript spike is a gate, and changing the mod is in scope.** First implementation task: verify that (a) the Bridge's `sessionId` equals the Claude session id (Spawner launches with `claude --session-id <id>`, and the mod reports `$.session.id()`), (b) the transcript path can be derived from cwd + session id, (c) the JSONL has complete text, tool inputs and results. If any fails, fall back to the mod forwarding `tool.call` events and assistant text (new Report kinds in `protocol.ts`; the mod is versioned with the repo). `busy` is **best-effort** (transcript activity + `turn_complete`), not exact.
2. **Backfill and duplicates.** On first attach the reader ingests the **whole existing transcript** in the background, in batches, through the same redaction, so history from before the Bridge saw the Session is visible. "Reader active" means a tail handle exists for the Session's file; if the file is missing or unreadable, turn-complete Report text **is** appended as `agent_text` so nothing is lost. When the reader later becomes active, it does not re-append turns already stored (matched by transcript entry id).
3. **Auth.** The identity header is trusted because the server binds loopback and the machine is assumed to be **single-user** (the Bridge's Unix socket is already `0600` for the same reason). Another local process of the same user could forge the header, which is accepted. Tagged nodes and Funnel (no login header) are out of scope. `REMOTE_AGENT_WEB_ORIGINS` holds the MagicDNS host(s) only. The bearer token is optional.
4. **Ordering.** A message's `seq` is assigned at creation and never changes; it is what `before=` pagination, `lastMessage.seq` and the read cursor compare against. Each feed event has its own `eventSeq` (the `seq` field on WebSocket events) used only for resume. Clients apply `message.updated` by replacing the message with the same `id`, so replays are idempotent. Unread = messages after the cursor whose kind is `agent_text`, `prompt`, or `system`; `tool_run`, `user_text` and `command_reply` do not count.
5. **Away mode** stays in memory and defaults to on at Bridge start, as today. The `/away`//`back` commands and `PUT /api/away` both emit `away.updated`. `/end` works in a Session chat as today; `POST /api/chats/:id/end` is the same action. A model is chosen in the UI only by typing `/new --model <model>` in General for now.
6. **Chat ids** are `c_` + UUID; `general` is reserved. A Session keeps one chat for its life, including across restart or resume of the same Session id.
7. **Push** needs outbound internet from the Bridge host to the browsers' push services; the host already needs it for Telegram today. If `web-push` fails the Bun spike, a small VAPID/Web Push implementation is in scope.

## Decisions for the user (still open)

These come from comparing the prototype with the Bridge. They are listed with my proposed default so the builder is not blocked, and are **not yet agreed**.

1. **Per-Session settings (model / effort / cwd) and `/model`, `/effort`, `/cwd`.** The Bridge can set the model only when it spawns a Session; it cannot change cwd or model of a running one. Default: show them **read-only** in the info panel; remove those slash configs. Alternative: forward `/model x` as an Instruction if the mod's `prompt.submit` runs slash commands (spike).
2. **`/clear`.** Default: hide history **in the UI only** (per chat, stored server-side so all devices agree); it does not clear Claude's context.
3. **Skills menu** (`/carousel` …). Default: server lists skills discoverable on disk; selecting one sends it as an Instruction. Depends on slash commands working through `prompt.submit` (spike); otherwise dropped for now.
4. **Fork.** Default: fork the **whole** Session (resume with fork) into a new Spawned Session. "Fork from this message" is not offered because I don't believe the CLI supports it.
5. **New Session creation.** The prototype invents a folder from the title. The Bridge only starts Sessions in trusted folders. Default: pick from trusted projects (plus an optional title); no folder creation.
6. **General.** Default: command surface only, no LLM.
7. **Search.** Default: client-side filter over chat titles; full-text search later.

## Left to the builder

Exact table/column names and migrations; WebSocket message framing details beyond the handoff contract; event retention/pruning; transcript-file watching mechanics and the fallback decision after the spike; port, VAPID storage location; how chat ids are generated; pagination sizes; static file caching.
