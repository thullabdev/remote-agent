# Terminal pilot: persistent sessions, project folders, chat link — design

Date: 2026-11-15
Status: approved 2026-11-15; ready to implement after the branch split
Branch (proposed): `feat/terminal-pilot`, branched from `feat/extension-system` once that lands
Depends on: [Extension platform storage](2026-11-15-extension-storage-design.md)
Builds on: [Extension system + terminal plugin](2026-11-15-extensions-terminal-plugin-design.md), [Web terminal spec](/tmp/opencode/uploads/efebc2e7-131a-4988-9c29-de4e88c8d0b3/Web terminal spec.md) (not committed)

## Intent

Make terminals survive what a user actually does: reload the page, close the tab, restart the bridge, and come back the next day to the same project. Terminals belong to a **project folder**, not to a chat. A chat is just a convenient way to get to a project's shell.

## Problems this fixes (from the current build)

1. **Tabs disappear on reload.** The terminal list lives in React state. `?terminal=<sid>` reattaches only if the list happens to have it.
2. **Shells die with the bridge.** Shells currently run as children of the bridge process (`Bun.Terminal` in-process). A bridge restart kills every shell, including ones the user left running overnight.
3. **Folder drifts.** The chat's `cwd` follows `cd` (the hook keeps updating `sessions.cwd`). A terminal opened from a chat starts wherever Claude happens to be, not in the project it was started in.
4. **Clicking an existing terminal makes a new one.** Fixed in the UI already; this spec keeps the rule explicit.

## Goals

- A terminal session outlives page reloads, socket drops, and bridge restarts, until the user closes it or it has been detached for 12 h.
- The list of a user's open sessions is persisted on the server and loaded on start.
- Every session records its **launch folder**, which never changes after creation, and is the folder the shell started in.
- Terminals are grouped by launch folder. The chat header opens a shell for that chat's launch folder, reusing an open one if it exists.
- The extension's code uses the platform storage API from the storage spec. No direct SQL.

## Non-goals (v1)

- Tracking the shell's live directory (OSC 7 or `/proc`). The footer shows the launch folder. A live-cwd readout can come later as its own feature.
- Multiple users, sharing a session, recording, or audit replay (from the terminal spec).
- Choosing a shell per session. `$SHELL` for everything.

## Decisions

**1. Shells run inside tmux, on a dedicated tmux server.**
- Each session is a tmux session on a **dedicated socket**: `tmux -L remote-agent-terminal`. It is separate from the default tmux server, where Claude sessions live, so the two cannot collide, and the bridge's Claude reconcile logic never sees terminal sessions.
- The dedicated server is started with an allowlisted environment (`env -i` with `HOME`, `PATH`, `USER`, `LANG`, `TERM`, `SHELL`), because a tmux server passes its own environment to every shell it starts. This keeps bridge secrets out of the shell.
- Creating: `tmux -L remote-agent-terminal new-session -d -s <name> -c <launchCwd> -x <cols> -y <rows> <shell> -l`.
- Attaching (one per open WebSocket): `Bun.spawn(['tmux', '-L', 'remote-agent-terminal', 'attach-session', '-t', <name>], { terminal })`. The `Bun.Terminal` I/O goes to the attach client; tmux redraws the screen on attach, so the server does not keep its own output buffer.
- Detaching (WebSocket closed): kill the **attach client only**. The tmux session keeps running.
- Explicit close: `kill-session`. Idle reaping (detached for 12 h, configurable): `kill-session`.

Why tmux instead of a supervisor process: the bridge already depends on tmux for Claude sessions, so this adds no new dependency; tmux already solves screen redraw, scrollback, and survival across client detach. The cost is that the tmux server is one more process to know about, which is why it gets its own socket and name prefix.

Name: `ra-term-<sid>`, where `sid` is a server-generated id (Decision 3).

**2. Shell history is tmux's, not ours; it is replayed automatically on reattach.** The 1 MB replay buffer from the earlier design is removed. On every attach, the server sends the visible screen (tmux redraws it) and then the last 2 000 lines of scrollback from `capture-pane -p -e -S -2000`, capped at 1 MB, before live output starts. The scrollback is captured on demand per attach, so it survives bridge restarts without a server buffer.

**3. The server creates sessions.** Today the browser invents `term-<uuid>`. Under this spec:
- `POST /api/extensions/remote-agent.terminal/sessions` with `{ cwd?, chatId? }` creates the tmux session and the storage row, and returns `{ sid, cwd, createdAt }`.
- The browser then opens the WebSocket with that `sid`.
- `GET /api/extensions/remote-agent.terminal/sessions` returns the caller's **open** sessions (not closed), newest first.
- `DELETE /api/extensions/remote-agent.terminal/sessions/:sid` kills the tmux session and marks the row closed.

The WebSocket keeps its frames (`open`, `input`, `resize`, `close`, `ready`, `output`, `exit`, `error`), with one change: `open` no longer carries `cwd`. The folder is fixed when the session is created.

**4. Storage.** Collection `sessions` (declared in the manifest per the storage spec):

| Field | Type | Indexed | Notes |
|---|---|---|---|
| `id` | text (`sid`) | pk | server-generated |
| `owner` | text | yes | login from `REMOTE_AGENT_WEB_ALLOWED_LOGIN` |
| `launchCwd` | text | yes | **never updated after create** |
| `project` | text | yes | basename of `launchCwd`, for grouping |
| `chatId` | text | yes, nullable | soft reference to the chat that opened it; no foreign key |
| `tmuxName` | text | no | `ra-term-<sid>` |
| `createdAt` | integer | no | |
| `closedAt` | integer | yes, nullable | null while open |
| `closeReason` | text | no | `user`, `idle`, `exited`, `missing` |

**5. Startup reconcile.** On activate, for every row with `closedAt` null:
- `tmux -L remote-agent-terminal has-session -t <name>` succeeds → keep it.
- Fails → set `closedAt`, `closeReason = 'missing'`.

Idle timers for detached sessions are re-armed from `lastAttachedAt` (a field added to the doc), so a restart does not extend or drop the 12 h clock. This field is a plain doc field, not indexed.

**6. Folder and chat link.**
- A session's folder is `launchCwd`. The chat's **launch** folder comes from `sessions.launch_cwd` (exposed to the browser as `Chat.launchCwd`), never from `Chat.cwd`, which follows `cd`.
- The chat header button opens the shell for the chat's launch folder. If an open session for this owner has the same `launchCwd`, it opens that one. Otherwise it creates one with `chatId` set.
- The sidebar groups open sessions by `project`. Each group has a "+" that creates another shell in that folder, with no chat link.

Reuse is per folder, not per chat: two chats in the same project share one shell by default. The "+" gives a second one when wanted. (Open question 2 below.)

**7. Security (unchanged from the terminal spec, restated for the new routes).**
- Every HTTP and WebSocket route is behind the host's `authorize`, which checks login and origin before the extension sees the request.
- `owner` is set from the authorized login. A session is readable and writable only by its owner. Sessions of another login are reported as not found, not forbidden, so ids do not leak.
- `sid` is validated (`^[A-Za-z0-9_-]{1,80}$`) before it is used in a tmux argument. No shell string is built; every tmux call is an argv array.
- Sessions per owner are capped (8 open).
- Logs record open, close, and refused attempts with login and time. No keystrokes or screen content.

**8. Frontend behavior.**
- On load, fetch `GET .../sessions` and fill the list.
- `?terminal=<sid>` not in the list: fetch once. Still not found: show "This shell has ended" with a **Start a new shell here** button, which uses the old folder if the row still exists. Never silently create a shell for a sid that is not there.
- Closing a tab calls `DELETE`. Leaving a tab (back, chat click) only detaches the socket.

**9. Limits and failure modes.**
- tmux missing: the POST returns a clear error ("tmux is not installed"); nothing is written.
- Session limit reached: POST returns 409 with the open count.
- Launch folder missing on disk: POST returns 400 and names the path. No silent fallback to home.

## UI

- **Sidebar Terminals section**: open sessions grouped by project folder, the project name as heading, the chat's title as a subtitle when the session has a `chatId`. Each row shows connection state. "+" per group.
- **Chat header**: the terminal button uses the chat's launch folder (reuse-or-create, Decision 6).
- **Dashboard Terminals card**: unchanged, reads the same list.
- **Terminal view**: the footer shows the launch folder, labelled "Started in". It is not updated on `cd`.

Open UI question: the list switcher (Chats | Terminals, see earlier suggestion) is not decided here. This spec works with either the switcher or the grouped sidebar.

## Decisions recorded from review

All five questions from the first draft were answered: dedicated tmux socket (agreed), collections over raw SQL (isolation, agreed), reuse per folder (agreed), scrollback automatic on reattach (Decision 2), idle reaping 12 h (Decision 5). The list below is kept for history.

1. **tmux on the dedicated socket** vs. keeping the default socket, which would share the server with Claude sessions. Recommendation: dedicated socket, as above.
2. **Reuse vs. new per chat.** Default is reuse per folder. Do you want reuse per chat instead, which means more shells?
3. **Idle reaping default.** 12 h detached, configurable. Is 12 h right for a tool you use from your phone?
4. **Scrollback on reattach.** On-demand "load history" (Decision 2) or automatic? Automatic costs a screen-sized payload on every reattach.
