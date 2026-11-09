# Web channel developer guide

The web channel is the part of the Bridge that serves a chat backend to a browser: a JSON API, one WebSocket, optional static files for a UI build, and Web Push. This guide is for two kinds of developer:

- **Client developers** building a UI (or any other client) against the API: [Part 1](#part-1-building-a-client), [Part 2](#part-2-api-reference), [Part 3](#part-3-websocket) and [Part 4](#part-4-push-notifications).
- **Backend contributors** changing the web channel itself: [Part 5](#part-5-working-on-the-backend).

Related documents: the design (`docs/superpowers/specs/2026-11-04-web-channel-design.md`) says why it is built this way, the UI handoff (`docs/superpowers/specs/2026-11-04-web-channel-ui-handoff.md`) lists what the prototype UI still needs, and [ADR-0004](adr/0004-web-channel.md) records the decisions. For setup (Tailscale, environment variables) see the README, section "Web channel".

## Part 0: Concepts you need first

**Chat.** The place for one Session, or the General chat. General has the id `general` and is the command surface (`/new`, `/status`, `/away`, `/back`, `/end`); it is not an AI. Every other chat belongs to one Session for that Session's whole life, including after it ends (its history stays readable). Ids are opaque strings (`c_` plus a UUID); treat them as such.

**Message.** One item in a chat. Messages are tagged by `kind`: `user_text`, `agent_text`, `tool_run`, `prompt`, `system`, `command_reply`, `picker`. Content is complete and never truncated, with one exception: a `tool_run` result is capped at 20 000 characters (a marker `… [+N chars]` is appended and `resultTruncated` is `true`). Secrets are redacted on the server before anything is stored.

**Two counters, do not mix them up.**

| Counter | Where you see it | What it orders | Changes? |
|---|---|---|---|
| **message `seq`** | `message.seq`, `chat.lastMessage.seq`, `?before=`, `POST …/read {seq}` | messages, in creation order | never, once assigned |
| **event `seq`** | `GET /api/state` → `seq`, every WebSocket event's `seq`, `/ws?after=` | the change feed (a created message, an updated message, a chat change…) | one new number per event |

When a message is updated (a prompt gets answered, an instruction is delivered) its message `seq` stays the same and a new event with a new event `seq` is emitted. Use the event `seq` to resume the feed and the message `seq` to page through history and to mark chats read.

**Instruction.** Text you send to a Session. It is queued and handed to the Session when it is idle (the Session's mod polls every few seconds), then shown as delivered.

**Prompt.** Something a Session is blocked on: a Question (options and free text) or a Permission Request (allow or deny). The first answer from any device or from the terminal wins; later answers get `Already answered.`.

**Away mode.** A server-side flag. Prompts always push; reports (turn finished, session started or ended) push only while Away mode is on. It is on when the Bridge starts.

**Unread.** One global read position per chat, shared by all your devices. Messages of kind `agent_text`, `prompt` and `system` after the position count as unread; `tool_run`, `user_text`, `command_reply` and `picker` do not. History that was backfilled from an existing transcript never counts as unread, and neither do the "Session started" and "Session ended" messages (they stay in the log).

## Part 1: Building a client

### 1.1 Run a backend to develop against

You do not need Tailscale locally. Use throwaway data so you never touch your real Bridge state:

```bash
mkdir -p /tmp/ra-dev
REMOTE_AGENT_CHANNELS=web \
REMOTE_AGENT_WEB_ALLOWED_LOGIN=dev@example.com \
REMOTE_AGENT_WEB_ORIGINS=http://localhost:8787 \
REMOTE_AGENT_WEB_TOKEN=dev-token \
REMOTE_AGENT_DB=/tmp/ra-dev/bridge.db \
REMOTE_AGENT_SOCKET=/tmp/ra-dev/bridge.sock \
bun run bridge
```

Optional: `REMOTE_AGENT_WEB_STATIC=/path/to/your/ui/dist` serves your UI build from the same origin, and `REMOTE_AGENT_WEB_PORT` changes the port (default 8787). The server listens on `127.0.0.1` only.

Try it with `curl`. Over `tailscale serve` the login header is added for you; locally you add it yourself, plus an `Origin` (or `Sec-Fetch-Site: same-origin` for GETs):

```bash
H=(-H 'Origin: http://localhost:8787' -H 'Tailscale-User-Login: dev@example.com')

curl -s "${H[@]}" http://127.0.0.1:8787/api/state
curl -s "${H[@]}" -H 'Content-Type: application/json' \
  -d '{"clientId":"c1","text":"/status"}' http://127.0.0.1:8787/api/chats/general/messages
```

The bearer token works instead of the login header: `-H 'Authorization: Bearer dev-token'` (the `Origin` rule still applies).

**Serving the client from a different dev server** (Vite, webpack…) means cross-origin, and the server sends no CORS headers. Two ways to work: build your UI into `REMOTE_AGENT_WEB_STATIC` and rebuild, or run your dev server with a proxy to `127.0.0.1:8787` that injects the identity header (or the bearer token) and add the dev server's origin (for example `http://localhost:5173`) to `REMOTE_AGENT_WEB_ORIGINS`. Proxying is the usual approach but is not exercised by this repo's tests; the WebSocket path needs the proxy's WebSocket option enabled.

### 1.1.1 Run the React client in this repository

The client uses React, Vite, Tailwind CSS and local shadcn/ui-style primitives. For isolated local development, run a throwaway Bridge and the Vite server in separate terminals. The Bridge must allow the dev origin:

```bash
REMOTE_AGENT_CHANNELS=web \
REMOTE_AGENT_WEB_ALLOWED_LOGIN=dev@example.com \
REMOTE_AGENT_WEB_ORIGINS=http://127.0.0.1:5173 \
REMOTE_AGENT_WEB_PORT=8787 \
REMOTE_AGENT_DB=/tmp/ra-dev/bridge.db \
REMOTE_AGENT_SOCKET=/tmp/ra-dev/bridge.sock \
bun run bridge
```

In the other terminal, run Vite with the identity value the Bridge expects:

```bash
REMOTE_AGENT_WEB_DEV_LOGIN=dev@example.com \
VITE_WEB_CHANNEL_TARGET=http://127.0.0.1:8787 \
bun run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` and `/ws` to the Bridge and adds `Tailscale-User-Login` from `REMOTE_AGENT_WEB_DEV_LOGIN`. If the Bridge uses a local bearer token instead, set `REMOTE_AGENT_WEB_TOKEN` on the Bridge and `REMOTE_AGENT_WEB_DEV_TOKEN` on Vite, and omit the dev login. These variables are read only by Vite's Node process; never put credentials in a `VITE_*` variable or in client code. `VITE_WEB_CHANNEL_TARGET` changes the upstream Bridge address.

For production, build the static UI and point the Bridge at its output:

```bash
bun run build
REMOTE_AGENT_WEB_STATIC="$PWD/dist/web-channel" bun run bridge
```

The build is served from the Bridge's same origin, including the SPA fallback. The generated `dist/` directory is not committed. The UI registers `/sw.js` only when a user enables Push notifications.

### 1.2 Authentication in one paragraph

Every HTTP request and the WebSocket upgrade go through the same gate, in this order:

1. **Origin.** Required on the WebSocket upgrade and on every method other than GET/HEAD, and it must match one of `REMOTE_AGENT_WEB_ORIGINS` exactly (scheme, host, port). On GET/HEAD it may be absent only when the browser sends `Sec-Fetch-Site: same-origin` (or `none`). Browsers do all of this automatically for same-origin pages. Failure: `403 origin not allowed`.
2. **Identity.** `Tailscale-User-Login` must equal `REMOTE_AGENT_WEB_ALLOWED_LOGIN` (added by `tailscale serve`), or `Authorization: Bearer <token>` must match `REMOTE_AGENT_WEB_TOKEN` if one is set. Failure: `401 missing identity` or `403 login not allowed`.
3. **Content type.** POST, PUT, PATCH and DELETE must send `Content-Type: application/json`, **even the ones with no body** (`/end`, `/clear`, `/fork`). Failure: `403 content type must be application/json`.

A client has no login screen. Treat a 401 or 403 from steps 1 and 2 as "access denied". Do not show "access denied" for the content-type 403; that is a bug in your request.

### 1.3 The boot sequence

This is the order a client should do things in. Everything after step 2 is driven by events.

1. **`GET /api/state`** → `{ seq, away, chats }`. Keep `seq` (an *event* seq). `chats` is General first, then chats waiting on you, then chats with an unsent draft (newest edit first), then working chats, then the rest by latest message time. Render the chat list from it.
2. **Open the WebSocket** `/ws?after=<seq from step 1>`. The first frame is `hello`. Because you pass `after`, anything that happened between step 1 and the connection is replayed, and nothing is missed.
3. **Send your presence** as soon as the socket opens, and again whenever it changes (see 3.3). This is what stops pushes while you are looking at the page.
4. **When the user opens a chat:** `GET /api/chats/:id/messages` (latest 50). Render ascending. For older history call again with `before=<smallest message seq you have>` until `hasMore` is `false`.
5. **Mark it read** with `POST /api/chats/:id/read {seq}` using the *message* `seq` of the newest message the user has seen. Do this while the chat is open and the page visible.
6. **Apply events as they arrive** (3.2). Merge them with what you loaded by message `id`.

### 1.4 Sending and answering

**Sending text.** Generate a `clientId` (a UUID) per message and `POST /api/chats/:id/messages {clientId, text}`.

- In a **session chat** the text is queued as an Instruction. The response is the `user_text` message with `status: "queued"`; it flips to `"delivered"` through a `message.updated` event when the Session picks it up. While the Session is busy it simply waits.
- In **General** the text is a command line. The response is your own `user_text` (`delivered`); the command's answer arrives as a `command_reply` message through the normal events, not in the HTTP response.
- A retry with the same `clientId` is safe: you get the same message back, and nothing is queued or run twice. Show the message optimistically, replace it with the response (or the `message.created` event, whichever comes first: match on `id`), and retry the POST with the same `clientId` on a network error.

**Answering a Prompt.** The `prompt` message has `promptId`, `status` (`pending` or `answered`) and a `body`:

- *Question*, option tapped: `POST /api/chats/:id/actions {promptId, questionIndex, optionIndex}`.
- *Question*, free text, or a multi-select: `POST /api/prompts/:promptId/reply {questionIndex, text}`. For a multi-select send option numbers (`"1,3"`, 1-based); for anything else the text is the answer.
- *Permission Request*: `actions` with `questionIndex: 0` and `optionIndex: 0` to allow or `1` to deny. `reply` with `allow`, `yes`, `y`, `ok` or `approve` allows; any other text denies and is passed back to the agent as feedback.

Both return `{ toast }`, a short string to show for a moment (`Already answered.` when another device won). The message itself changes through a `message.updated` event: `status: "answered"` and a `resolution` (`{ note, source }`, `source` is `local` for the terminal, `remote` for you). Do not edit your copy from the toast; wait for the event. Show the pressed choice as sending until the request returns and as sent after it, so the card is never left looking untouched while the event is on its way. A multi-question Prompt has one message per question, and each one flips to `answered` as soon as that question is answered (`resolution.note` is `Answered: <its answer>` and the question's `answered` holds the answer), while the others stay `pending` until they are answered too. A Permission Request's note is `Allowed`, `Denied`, or `Denied: <feedback>`; `Answered in the terminal` when the terminal settled it.

> **Known gap: question index for multi-question prompts.** A Prompt with several questions is stored as several `prompt` messages that share one `promptId`, each holding exactly one question. The message does not say which question index it is, so a client must derive `questionIndex` as the message's position among the messages that share its `promptId`, ordered by `seq` (0 for the first). A Prompt with one question, which is by far the common case, and every Permission Request are always index 0. Making the index an explicit field is a small server change that has not been made yet.

**Starting a Session.** Either send `/new` in General and tap a button on the resulting `picker` message (`POST …/actions {pickerId, choice}`), or skip the picker: `GET /api/projects` for the listed project folders and `POST /api/projects/start {cwd, model?}`. The new chat appears through `chat.updated` and `message.created` events; it is not in the response.

**Ending, clearing, resuming, forking.** `POST /api/chats/:id/end` ends a Session the Bridge started (other Sessions cannot be ended remotely). `POST /api/chats/:id/clear` hides the chat's history on all your devices (the agent's context is not touched). `POST /api/chats/:id/resume` restarts an ended Session with `claude --resume <same-id>`; its chat, transcript and Claude session id are retained, though the ended process itself cannot be revived and Claude starts in a new process. `POST /api/chats/:id/fork` instead starts a new Session id from this conversation.

### 1.5 Rendering notes

- `agent_text.markdown` is Markdown. Everything else is plain text.
- Group consecutive `tool_run` messages between two other messages into one "agent run" in the UI. The server does not group them. A `tool_run` with `status: "running"` that never completes (the user interrupted) stays `running`; consider showing it as interrupted once a later message exists.
- `chat.busy` drives the "typing…" indicator. It is best-effort: derived from the Session transcript and cleared when a turn finishes, is interrupted, or the Session ends.
- `chat.lastMessage.preview` is plain text, at most 140 characters, for the chat list only. Never use it for anything else. Markdown is stripped; a prompt previews what it asks (`Bash: bun test`, or the first question), a tool run what it did (`Ran Bash: ls`, `Running Bash: ls`, `Bash failed: ls`), and a message you sent starts with `You: `.
- `chat.pendingPrompt` is set while the Session waits for an Answer: `{ promptId, kind, summary, at, count }` for the oldest pending Prompt (`count` counts a multi-question Prompt once). It is `null` when nothing waits and for ended chats. While it is set `chat.busy` is still `true` (the turn is open), so show "needs you" in preference to "working". A `chat.updated` event is sent when it changes.
- A chat with `status: "ended"` is read-only: sending text to it returns 409.
- `chat.spawned` is `true` for Sessions the Bridge started: only those can be ended from the UI, and `chat.tmuxName` lets you show a `tmux attach -t <name>` hint.

## Part 2: API reference

All paths are under `/api`. Request and response bodies are JSON. Errors are `{ "error": "<message>" }`. Unknown routes, and known routes with the wrong method, answer `404 {"error":"Not found."}`. An unexpected server failure answers `500 {"error":"Something went wrong."}`; details go to the Bridge log, never to the client.

**Status codes you will see:** `200` success; `400` invalid body or parameter (the message lists the problems); `401`/`403` the auth gate (1.2); `404` unknown chat, prompt, question or session; `409` the request conflicts with state (session ended, not spawned, folder not trusted in Claude Code); `503` the Bridge is not running.

| Method and path | Purpose |
|---|---|
| `GET /state` | Initial load. |
| `GET /chats/:id/messages` | A page of history. |
| `POST /chats/:id/messages` | Send text (Instruction or command). |
| `POST /chats/:id/actions` | Tap a Prompt option or a picker button. |
| `POST /prompts/:promptId/reply` | Free-text answer to a Prompt. |
| `POST /chats/:id/read` | Move the read position. |
| `POST /chats/:id/end` | End a Session the Bridge started. |
| `POST /chats/:id/clear` | Hide a chat's history on all devices. |
| `POST /chats/:id/fork` | Resume a Session into a new one. |
| `GET /projects` | Folders a Session may start in. |
| `POST /projects/start` | Start a Session in a project. |
| `PUT /away` | Set Away mode. |
| `GET /push/key` | VAPID public key. |
| `POST /push/subscriptions` | Register a device for push. |
| `DELETE /push/subscriptions` | Unregister a device. |

### GET /state

`200 { seq: number, away: boolean, chats: Chat[] }`. `seq` is an event seq. `chats` has General first, then chats with a `pendingPrompt` (waiting longest first), then chats with a `draft` (`draft.at` descending; ended chats do not count), then `busy` chats, then the rest, each group by `lastMessage.at` descending (chats without messages last). Ended chats count as the rest. `src/channel/web/order.ts` is the ordering the server uses; reuse it in a client so a `chat.updated` lands in the same place.

### GET /chats/:id/messages

Query: `before` (message seq, optional, exclusive) and `limit` (default 50, clamped to 1–200; a non-numeric value means the default).
`200 { messages: Message[], hasMore: boolean }`, in ascending `seq`. Cleared history is omitted.
`400` if `before` is not a non-negative integer; `404 Unknown chat.`

### POST /chats/:id/messages

Body `{ clientId: string, text: string }` (`text` must not be blank; there is no maximum length other than the 64 MiB request cap). `200 { message: Message }`.

- Session chat: queues an Instruction; `message` is a `user_text` with `status: "queued"`. `404 No session in this chat.` if the chat has no Session; `409 This session has ended.`
- General: `message` is a `user_text` with `status: "delivered"`. The text is run as a command if it starts with `/`; otherwise a hint reply (`Send a command like /new, /status, /away, /back.`) is posted. Commands: `/new [--model <model>] [path]`, `/new --resume [path]` to list transcript histories and fork one into a new Session, `/end` (only meaningful in a session chat), `/status`, `/away`, `/back`; anything else answers `Unknown command…`. `503` if the Bridge is not running.
- A `clientId` already used in this chat returns the existing message and does nothing else.

### POST /chats/:id/actions

Body is one of:

```json
{ "promptId": "…", "questionIndex": 0, "optionIndex": 1 }
{ "pickerId": "…", "choice": 0 }
```

`200 { toast: string }`. `404 Unknown chat.`, `503`. The toast is what the server would tell a button press: `Allowed`, `Denied`, `Answered: …`, `Recorded. Answer the remaining questions to continue.`, `Already answered.`, `This prompt no longer exists.`, or, for a picker, the "starting" text or `Project list changed. Send /new again.`

### POST /prompts/:promptId/reply

Body `{ questionIndex: number, text: string }` → `200 { toast: string }`. `404 Unknown prompt.`, `404 Unknown question.`, `404 Unknown session.`, `503`. Semantics are in 1.4.

### POST /chats/:id/read

Body `{ seq: number }` (a message seq) → `200 { ok: true }`. The position only moves forward, is never past the newest message, and is shared by all devices. `404 Unknown chat.`

### POST /chats/:id/end

No body. `200 { toast }`. `404 No session in this chat.`; `409 Only sessions started by the Bridge can be ended remotely.`; `409 This session has ended.` Ending is graceful (`/exit`, then a forced stop after a few seconds); the chat turns `ended` through events.

### POST /chats/:id/clear

No body. `200 { ok: true }`. Emits `chat.cleared` and `chat.updated`. It hides history in the UI for every device; it does not clear the agent's context.

### POST /chats/:id/fork

No body. `200 { toast }`. The new Session gets its own chat. `404 No session in this chat.`; `409` if the source Session's folder is no longer allowed (not in `REMOTE_AGENT_PROJECTS` or Claude Code's project keys). Forking a Session that has no transcript starts a Session that then fails to come up within 30 seconds and is cleaned up.

### GET /projects and POST /projects/start

`GET` → `200 { projects: { label: string, cwd: string }[] }`: existing folders from `REMOTE_AGENT_PROJECTS` and from the `projects` keys in `~/.claude.json`, each listed once. `hasTrustDialogAccepted` is not checked. `CLAUDE_CONFIG_PATH` can override the config location.
`POST` body `{ cwd: string, model?: string }`: `cwd` must start with `/` or `~`; `model` is one word (`opus`, `sonnet`, `haiku`, `opusplan` or a full model id). `200 { toast }`. `400` for a bad model (`Unknown model…`) or a bad body; `409` with the `Not a trusted folder…` text. A folder is allowed exactly when it is listed in `REMOTE_AGENT_PROJECTS` or is a project key in `.claude.json` (`~` and symlinks are resolved first; subfolders are not allowed). There is no way to add or create one from the API.

### PUT /away

Body `{ away: boolean }` → `200 { away }`. Also broadcasts `away.updated` to every device.

### Push routes

`GET /push/key` → `200 { key }` (404 when push is not configured). `POST /push/subscriptions` body `{ subscription: { endpoint, keys: { p256dh, auth } } }`; `endpoint` must be an `https:` URL; extra fields such as `expirationTime` are ignored → `200 { ok: true }`. `DELETE /push/subscriptions` body `{ endpoint }` → `200 { ok: true }`.

### Data shapes

The authoritative definitions are in `src/channel/web/protocol.ts`; these are the same, annotated.

```ts
type Chat = {
  id: string                    // "general" or "c_<uuid>"
  title: string                 // the Session's name, or "<project> · <short id>" until it has one
  project: string | null        // folder name; null for General
  cwd: string | null
  status: 'active' | 'ended'
  spawned: boolean              // started by the Bridge: can be ended from the UI
  busy: boolean                 // the agent is working
  unread: number
  lastMessage: { seq: number; at: number; preview: string } | null   // at: ms since epoch
  pinned: boolean               // true for General
  tmuxName: string | null
  draft: { preview: string; at: number } | null   // the unsent message; at: last edit, ms since epoch
  pendingPrompt: { promptId: string; kind: 'permission' | 'question'; summary: string; at: number; count: number } | null
}

type Message = { id: string; chatId: string; seq: number; at: number } & (   // at: ms since epoch
  | { kind: 'user_text'; text: string; status: 'queued' | 'delivered'; instructionId: string | null }
  | { kind: 'agent_text'; markdown: string }
  | { kind: 'tool_run'; tool: string; input: unknown; result: string | null; resultTruncated: boolean;
      status: 'running' | 'done' | 'error'; durationMs: number | null }
  | { kind: 'prompt'; promptId: string; title: string; body: PromptBodyView;
      status: 'pending' | 'answered'; resolution: { note: string; source: 'local' | 'remote' } | null }
  | { kind: 'system'; text: string }                  // started, ended, reminders, errors
  | { kind: 'command_reply'; text: string }           // answers in General
  | { kind: 'picker'; pickerId: string; text: string; buttons: { label: string; choice: number }[] }
)

type PromptBodyView =
  | { kind: 'question'; questions: { question: string; header: string; multiSelect: boolean;
        options: { label: string; description: string }[]; answered: string | null }[] }   // one question per message
  | { kind: 'permission'; tool: string; summary: string; reason: string | null; agentId: string | null }
```

`at` for transcript-derived messages is the time recorded in the transcript, not the time the server ingested it, so history from before the Bridge saw a Session still has real timestamps.

## Part 3: WebSocket

`GET /ws?after=<event seq>` upgraded to a WebSocket. Same auth gate as HTTP; the `Origin` header is mandatory (browsers send it). A request that is not an upgrade gets `400`. Every frame is one JSON object in a text frame.

### 3.1 Connecting and resuming

On open the server sends, in this order and without anything in between: `{type:"hello", seq}` (the current event seq), then every event after `after` (one per frame, oldest first), then live events. If you omit `after` (or it is not a whole number) you start from "now" with no replay.

If you are too far behind, the server sends `{type:"resync"}` instead of a replay: when `after` is larger than the server's current seq (for example the database was replaced), or the backlog is more than 5 000 events or about 4 MiB. On `resync`: `GET /api/state`, reload the open chat's messages, and reconnect with the new `seq`.

Reconnect with exponential backoff (1 s up to 30 s) using the last event `seq` you applied. Replay is idempotent: ignore events whose `seq` you have already applied, and replace messages by `id`.

### 3.2 Server → client events

```ts
{ type: 'hello'; seq: number }
{ type: 'message.created'; seq: number; message: Message }
{ type: 'message.updated'; seq: number; message: Message }   // replace the message with this id
{ type: 'chat.updated'; seq: number; chat: Chat }            // replace the chat: title, busy, unread, lastMessage, status…
{ type: 'chat.cleared'; seq: number; chatId: string; beforeSeq: number }   // drop messages of that chat with message seq <= beforeSeq
{ type: 'away.updated'; seq: number; away: boolean }
{ type: 'resync' }
```

How to apply them: `message.created` adds the message if its chat's history is loaded (otherwise the following `chat.updated` is enough to refresh the list); `message.updated` replaces by `id`; `chat.updated` replaces the whole chat; apply in `seq` order.

### 3.3 Client → server

```ts
{ type: 'presence'; visible: boolean; focused: boolean; chatId: string | null }
{ type: 'ping' }            // answered with { type: 'pong' }
```

Send `presence` when the socket opens and whenever any of the three fields change: on `visibilitychange`, `focus`, `blur`, when the user switches chats, and `visible: false` on `pagehide`. The server uses it for one thing: **while any device reports `visible` and `focused`, it sends no push.** Invalid frames are ignored.

### 3.4 When the server drops you

- A client that sends no frame and answers no ping for about 90 seconds is dropped (browsers answer protocol pings on their own; send an occasional `ping` if you want to be sure).
- A client that cannot keep up (more than 8 MiB of unsent data) is closed with code `1013`; reconnect and resume.
- `1011` means the handshake failed on the server; `1001` means the server is stopping.
- The maximum size of a frame you send is 16 MiB.

### 3.5 Debugging a socket

```ts
// bun run this; Bun's WebSocket accepts headers
const ws = new WebSocket('ws://127.0.0.1:8787/ws', {
  headers: { Origin: 'http://localhost:8787', 'Tailscale-User-Login': 'dev@example.com' },
})
ws.onmessage = event => console.log(event.data)
```

## Part 4: Push notifications

1. Register a service worker. From a user gesture (a settings toggle), `GET /api/push/key`, call `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, and `POST` the resulting subscription to `/api/push/subscriptions`. `DELETE` it with its `endpoint` to turn push off.
2. The service worker receives `{ chatId, title, preview, kind, promptId? }` where `kind` is `prompt` or `report`; `promptId` is present on prompts only and names the Prompt that waits. `title` is at most 100 characters and `preview` at most 140; both are redacted. Show the notification and, on click, open `/?chat=<chatId>` (add `&prompt=<promptId>` when there is one); your app reads `chat` on load and opens that chat, and scrolls to the pending Prompt named by `prompt` if it is still pending.
3. Push requires HTTPS (which `tailscale serve` provides). On iPhone and iPad it works only for a page added to the Home Screen.

Rules, enforced by the server: Prompts always push (urgent, kept for an hour); reports push only in Away mode (normal urgency, kept for ten minutes); nothing pushes while any device is `visible` and `focused` (3.3). A subscription the push service reports as gone (404 or 410) is removed automatically. The full text is never in the notification; fetch it from the API.

## Part 5: Working on the backend

### 5.1 Map of the code

Everything is under `src/channel/web/`, next to `src/channel/telegram/`. The Bridge side stays under `src/bridge/`.

| File | Role |
|---|---|
| `protocol.ts` | All wire types and the request schemas (zod). Start here when you change anything a client sees. |
| `chat-log.ts` | The message log in SQLite: chats, messages, the event feed, read positions, push subscriptions. Redacts on write and applies the tool-result cap. The single source of truth for what clients see. |
| `web-channel.ts` | Implements the `Channel` interface and the `ChatSink` interface. Turns Bridge happenings (prompts, reports, instructions, session end) into messages. |
| `api.ts` | The HTTP routes (a table plus one handler function each). |
| `auth.ts` | The gate in 1.2. |
| `server.ts` | `Bun.serve`: auth, then `/ws`, then the API, then static files; WebSocket handlers; error containment. |
| `hub.ts` | Connected WebSocket clients: broadcast, replay, presence, reaping slow or stale clients. |
| `push.ts` | `PushService` (rules, sending, pruning) and the VAPID key file. |
| `away-events.ts` | Turns Away mode changes into `away.updated` events. |
| `transcript/` | `path.ts`, `parse.ts`, `reader.ts`: tail a Session's Claude Code transcript file into messages. |
| `../chat-sink.ts` | The `ChatSink` interface the Bridge calls. |
| `../../bridge/app.ts` | `createBridge`: wires all of it together and owns startup and shutdown. |

### 5.2 How data flows

```
mod ──Unix socket──► http.ts ─► PromptService / Notifier / Spawner
                                        │  (no sink: Telegram path, unchanged)
                                        ▼  ChatSink
                                   WebChannel ──► ChatLog ──events──► Hub ──► browsers
Claude Code transcript ──► TranscriptReader ─────► ChatLog              └──► PushService
browser ──HTTP──► server.ts ► auth ► api.ts ──► Inbound / Spawner / ChatLog
```

Two rules follow from this picture. **Everything a user can see goes through `ChatLog`**, so it is stored, replayed and redacted in one place. **Nothing in the web layer may break the mod's Unix socket or the Telegram-style flow**: every handler and every sink call is wrapped, failures are logged and contained, and push is fire-and-forget.

### 5.3 Invariants to keep

- Conversation content is never truncated, except `tool_run.result` (`TOOL_RESULT_MAX`, 20 000). Previews (`lastMessage.preview`, push) are the only other short text.
- Redaction (`redactSecrets`) happens once, when a message is written to the `ChatLog`, before the tool-result cap. Push text is redacted separately before its caps.
- A message's `seq` never changes; every change to anything visible is a new event with its own `seq`.
- A Session keeps one chat for its whole life (`sessions.chat_id` is never cleared). Do not create a second chat for a resumed Session.
- With no `ChatSink` (Telegram only) the Bridge behaves exactly as it did before the web channel existed.
- The server binds `127.0.0.1` only, and the `Origin` rule must never be relaxed for WebSocket upgrades or state-changing requests.

### 5.4 Recipes

**Add an HTTP route.** (1) Add a request schema to `protocol.ts` if it has a body. (2) Add a handler in `api.ts` and one line to the `ROUTES` table; throw `ApiError(status, message)` for expected failures, so a validation or state problem is a 4xx and only real bugs reach the 500 path. (3) Add tests to `test/channel/web/api.test.ts`: build the handler with `createApi(deps)` and call it with `new Request(...)`. (4) Document it in Part 2 of this guide and in the UI handoff.

**Add a message kind.** (1) Add the variant to `MessageBody` in `protocol.ts`. (2) If it should count as unread, add it to the unread kinds in `chat-log.ts`. (3) Produce it from `WebChannel` (a `ChatSink` method) or the transcript reader through `chatLog.appendMessage`. Redaction and persistence are automatic for every string in the body. (4) Test it in `chat-log.test.ts` and where it is produced. (5) Document the shape in Part 2.

**Add an event type.** Add it to `ServerEvent`, emit it from `ChatLog` inside the same transaction as the change, and think about replay: if an old event would resurrect hidden data (as cleared messages would), filter it in `eventsAfter`, as `chat.cleared` does. The hub broadcasts anything the log emits, so no hub change is needed.

**Add a `ChatSink` method.** Declare it in `src/channel/chat-sink.ts`, implement it in `WebChannel`, and call it from the `Notifier` through the existing `sinkStep` wrapper so a failure is contained and logged. Leave the no-sink path untouched.

**Add a configuration variable.** Add it to the web schema in `src/bridge/config.ts` with a clear error message that names the variable, then to the README table and `.env.example`. Validate values that would otherwise fail silently (the origins list is an example: a bare host would never match a browser, so it is rejected at startup).

### 5.5 Testing

```bash
bun test                      # everything
bun test test/channel/web     # the web channel only
bun run typecheck
```

Patterns used in `test/channel/web/`:

- **Log and channel tests:** `new Store(':memory:')` and `new ChatLog(store)`; no files, no network.
- **API tests:** construct `createApi({...})` with real `Store`, `ChatLog`, `PromptService` and `Inbound` where behaviour crosses modules, and call the handler directly with `Request` objects.
- **Server tests:** `startWebServer({ ..., port: 0 })` and a real `WebSocket` with `headers: { Origin, 'Tailscale-User-Login' }`. Wait for frames with a bounded helper, not fixed sleeps.
- **Transcript tests:** inject `readFrom`, `statSize` and the poller so nothing touches the real disk or timers; fixtures in `test/support/transcripts/` are synthetic.
- **Integration (`integration.test.ts`):** boots the real `createBridge` with a temp directory for the database, socket and a fake home, then drives it as a mod (over the Unix socket) and as a browser (HTTP and WebSocket) at the same time.

### 5.6 Troubleshooting

- **403 on every write from the browser:** `REMOTE_AGENT_WEB_ORIGINS` does not contain the exact origin the browser uses (scheme and host, no path). The Bridge refuses to start if an entry is not a bare origin, so check the value `tailscale serve status` shows.
- **403 `content type must be application/json`:** a POST, PUT or DELETE without the header, including the ones with no body.
- **Refused requests** are logged as `web request refused: <method> <path> <status> <reason>`; the log never contains header values or query strings.
- **A chat never gets history:** transcript tailing needs the Session's transcript file under `~/.claude/projects/` and the chat to exist; a Session the Bridge has never heard from cannot be listed. An already-running Session appears at its next report, prompt or title.
- **A chat stays "busy":** busy is cleared by the end of a turn, an interrupt marker, or the Session ending. A turn that ends in some other way can leave it set until the Session ends.
- **No push arrives:** is a client reporting `visible` and `focused`? Is Away mode off (for reports)? Does `REMOTE_AGENT_VAPID_SUBJECT` hold a `mailto:` address that your push service accepts (Apple's may reject the default)? On iOS, was the page added to the Home Screen?

## Known limits

- A Session already running when the Bridge starts is listed only after its next report, prompt or title.
- Sending to a chat that has ended returns 409.
- The event feed has no pruning yet; a client far behind gets `resync` instead of a replay.
- There is no skills menu or slash-command passthrough: Claude Code refuses slash text submitted as a prompt.
- The question index of a multi-question Prompt must be derived by the client (see 1.4).
