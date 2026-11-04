# Web Channel — UI Handoff

Date: 2026-11-04 · Status: DRAFT, pairs with [Web Channel design](2026-11-04-web-channel-design.md) · Prototype: [`references/UI-prototype.html`](../../../references/UI-prototype.html)

This document is the contract between the Web Channel server and the chat UI. The UI is **not** built as part of the server work. Everything here is what a UI developer needs to build against, with no further questions. Shapes are TypeScript-style; the server validates with zod, and a shared `types.ts` should be published from `src/web/protocol.ts`.

## 1. Access

- The server listens on `127.0.0.1:8787` (configurable). Devices reach it through `tailscale serve` (HTTPS). The UI is served from the same origin, so there is no CORS: use relative URLs (`/api/...`, `/ws`).
- WebSocket upgrades and all non-GET requests must carry an allowed Origin (browsers do this automatically); GET/HEAD must carry an allowed Origin or `Sec-Fetch-Site: same-origin`. The server also rejects any request not from the allowed Tailscale login. The UI needs no login screen. A 401/403 means "not allowed": show a plain "access denied" state.
- Send `Content-Type: application/json` on every POST/PUT/DELETE.

## 2. Concepts

- **Chat**: General (`id: "general"`) or one per Session. A chat id is an opaque string.
- **Message**: one item in a chat, `kind`-tagged (see 4). Content is complete, never truncated. Markdown in `agent_text`.
- **seq**: a global, increasing integer. Every change to anything the UI shows has a `seq`; the UI keeps the highest it has seen.
- **Prompt**: something a Session is blocked on (a Question with options/free text, or a Permission Request allow/deny). It is a message of kind `prompt`.
- **Away mode**: server-side flag; decides whether Reports are pushed. Toggle in settings.

## 3. HTTP API

All responses are JSON. Errors: `{ "error": string }` with 4xx/5xx.

| Method & path | Purpose |
|---|---|
| `GET /api/state` | Initial load: `{ seq, away, chats: Chat[] }`. |
| `GET /api/chats/:id/messages?before=<seq>&limit=<n>` | History page, newest last. Omit `before` for the latest page. Returns `{ messages: Message[], hasMore }`. |
| `POST /api/chats/:id/messages` `{ clientId, text }` | Send text. In a Session chat it becomes an Instruction (queued; delivered when the Session is idle). In General it is a command (`/new`, `/end`, `/status`, `/away`, `/back`). Returns `{ message }` (the user message, status `queued`); replies arrive as normal events. `clientId` makes retries idempotent. |
| `POST /api/chats/:id/actions` `{ promptId, questionIndex, optionIndex }` | Tap an option on a Question, or Allow/Deny (option 0 = allow, 1 = deny) on a Permission Request. Returns `{ toast: string }` (short text to show). |
| `POST /api/chats/:id/actions` `{ pickerId, choice }` | Tap a project button on a `picker` message (starts a Session). Returns `{ toast }`. |
| `POST /api/prompts/:promptId/reply` `{ questionIndex, text }` | Free-text answer to a Question, or deny-with-feedback / "allow"/"deny" words for a Permission Request. Returns `{ toast }`. |
| `POST /api/chats/:id/read` `{ seq }` | Mark everything up to `seq` read (global, all devices). |
| `PUT /api/away` `{ away: boolean }` | Away mode. |
| `POST /api/chats/:id/end` | End a Spawned Session (same as `/end`). 409 with an error if it is not a Spawned Session. |
| `POST /api/chats/:id/clear` | Hide the chat's history so far (global, all devices; later messages show). `{ ok: true }`. 404 for an unknown chat. |
| `POST /api/chats/:id/fork` | Start a new Spawned Session with its own chat that resumes this chat's session transcript (the original is left as it was; works for ended sessions too). Returns `{ toast }`. 409 if the session's folder is no longer trusted; 404 if the chat has no session. 501 if the installed Claude Code cannot fork (`FORK_SUPPORTED` in `src/bridge/spawner.ts`; currently supported, checked against Claude Code 2.1.318). |
| `GET /api/projects` | The trusted configured projects: `{ projects: { label, cwd }[] }`, for a project picker. 404 when no projects are configured. |
| `POST /api/projects/start` `{ cwd, model? }` | Same as `/new [--model <model>] <path>`: `cwd` is an absolute or `~` path that must be trusted. Returns `{ toast }`. 409 for an untrusted folder, 400 for an unknown model. |
| `GET /api/push/key` | VAPID public key for `pushManager.subscribe`. |
| `POST /api/push/subscriptions` `{ subscription }` | Register this device. `DELETE /api/push/subscriptions` `{ endpoint }` to unregister. |

Not in the first server version (see design, "Decisions for the user"): editing model/effort/cwd, skills list (Claude Code refuses slash text sent as a prompt, so skills stay off). When agreed they get entries here.

## 4. Shapes

```ts
type Chat = {
  id: string                  // "general" or opaque
  title: string               // session name, or project · shortid until it has one
  project: string | null      // folder name, for the subtitle; null for General
  cwd: string | null
  status: 'active' | 'ended'
  spawned: boolean            // true => can be ended from the UI
  busy: boolean               // agent is working: show "typing…"
  unread: number
  lastMessage: { seq: number; at: number; preview: string } | null  // preview is plain text, for the list only
  pinned: boolean             // true for General
  tmuxName: string | null     // for an "attach" hint, spawned only
}

type Message = {
  id: string; chatId: string; seq: number; at: number // ms epoch
} & (
  | { kind: 'user_text'; text: string; status: 'queued' | 'delivered' }
  | { kind: 'agent_text'; markdown: string }
  | { kind: 'tool_run'; tool: string; input: unknown; result: string | null; resultTruncated: boolean; status: 'running' | 'done' | 'error'; durationMs: number | null }  // result is capped at 20 000 chars with a "… [+N chars]" marker; everything else is whole
  | { kind: 'prompt'; promptId: string; title: string; body: PromptBody; status: 'pending' | 'answered'; resolution: { note: string; source: 'local' | 'remote' } | null }
  | { kind: 'system'; text: string }            // started, ready, ended, reminder, errors
  | { kind: 'command_reply'; text: string }     // General replies
  | { kind: 'picker'; pickerId: string; text: string; buttons: { label: string; choice: number }[] }
)

type PromptBody =
  | { kind: 'question'; questions: { question: string; header: string; multiSelect: boolean; options: { label: string; description: string }[]; answered: string | null }[] }
  | { kind: 'permission'; tool: string; summary: string; reason: string | null; agentId: string | null }
```

Rendering notes from the prototype mapping:
- Prototype "agent run / activity log" = consecutive `tool_run` messages of one turn; group them client-side (same turn, no `user_text` or `agent_text` between). The server does not group.
- Prototype inline `choices` = a `prompt` message of kind `question`; "or type your own answer" = `POST /api/prompts/:id/reply`.
- A `prompt` that is `answered` shows `resolution.note` ("answered locally", "Allowed", …) and its buttons disabled.
- `user_text.status` drives a sent/delivered tick. While `queued` the Session is busy; it will be delivered when idle.
- Chat list ordering and pin: server sends `pinned` (General); sort by `lastMessage.at` client-side.
- Per-chat "info" panel fields available now: `title`, `project`, `cwd`, `status`, `spawned`, `tmuxName`, message count (client), and nothing editable yet.

## 5. WebSocket `/ws?after=<seq>`

Connect after `GET /api/state` with `after` set to its `seq` so nothing is missed.

Server → client:
```ts
{ type: 'hello'; seq: number }
{ type: 'message.created'; seq: number; message: Message }
{ type: 'message.updated'; seq: number; message: Message }          // prompt answered, instruction delivered, tool_run finished
{ type: 'chat.updated'; seq: number; chat: Chat }                   // title, busy, unread, lastMessage, ended
{ type: 'chat.cleared'; seq: number; chatId: string; beforeSeq: number }  // drop messages of that chat with seq <= beforeSeq
{ type: 'away.updated'; seq: number; away: boolean }
{ type: 'resync' }                                                  // too far behind: refetch /api/state and reopen
```
Client → server:
```ts
{ type: 'presence'; visible: boolean; focused: boolean; chatId: string | null }  // send on connect, and on visibilitychange/focus/blur/open chat
{ type: 'ping' }                                                                  // answered with { type: 'pong' }
```
Rules:
- Reconnect with backoff (1 s → 30 s) and `after=<last seq seen>`. Apply events in `seq` order; ignore events already applied (idempotent by `message.id` + `seq`).
- **Presence drives push.** While any device reports `visible && focused`, the server sends no Web Push (unread counts still update). Send `presence` accurately, including `visible:false` on `pagehide`.
- Server pings idle connections; a client that misses pings is dropped. Slow clients are dropped rather than buffered.

## 6. Push notifications

- Register a service worker; `GET /api/push/key`; `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`; `POST` the subscription. Do this from a user gesture (a Settings toggle).
- Payload: `{ chatId, title, preview, kind: 'prompt' | 'report' }`. The service worker shows it and, on click, focuses/opens `/?chat=<chatId>`. The UI reads `chat` on load and opens that chat.
- Requires HTTPS (Tailscale serve provides it). **iOS**: only works for a page added to the Home Screen; the UI should explain that when the browser is Safari and not installed.
- Prompts always push; Reports push only in Away mode; nothing pushes while the UI is visible and focused on any device.

## 7. Prototype gap list

What `references/UI-prototype.html` shows that the server **does not provide yet** (each needs a decision, see design "Decisions for the user"):

| Prototype feature | Server today |
|---|---|
| Info panel editing model / effort / cwd; `/model`, `/effort`, `/cwd` | Read-only; model only at spawn. |
| `/clear` | Provided: `POST /api/chats/:id/clear` (hides history for all devices). |
| Skills menu per session | Not provided: a skill is sent as `/<skill>` text through `prompt.submit`, which Claude Code refuses (spike), so the skills endpoint is not built. |
| Fork from a message | Provided as a whole-session fork: `POST /api/chats/:id/fork`. Message-level fork is not provided. |
| `/new <title>` creating its own folder | Only trusted projects: `GET /api/projects` lists them and `POST /api/projects/start` starts one. |
| "General" as a chatty router agent | Command surface only. |
| Message search | Client-side over titles only. |
| Settings (theme, accent, glow, density, font) | Not server-side; keep in `localStorage`. |

What the server provides that the prototype **does not yet show**: ended-session state, `queued`/`delivered` ticks, permission requests (allow/deny), prompt resolution notes ("answered locally"), Away mode toggle, push opt-in and iOS Home Screen hint, an "attach with tmux" hint for spawned sessions, `connection lost / resyncing` state, an access-denied state, and the reminder `system` message.
