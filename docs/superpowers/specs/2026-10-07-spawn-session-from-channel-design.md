# Spawn a Session from the Channel — Design Spec

Date: 2026-10-07 · Glossary: [`CONTEXT.md`](../../../CONTEXT.md) · Decision: [ADR-0003](../../adr/0003-spawned-sessions-in-tmux.md) · Builds on: [Remote Agent design](2026-10-06-remote-agent-design.md)

## Goal

Start a new Claude Code Session from Telegram while away from the desk, steer it from its Thread, and later attach to the same live Session in a real terminal.

## Requirements

1. **`/new`** (General topic or any Thread) replies with one button per configured project. **`/new <path>`** starts a Session in that path.
2. **Allowed directories**: a path is allowed only if it exactly matches a folder in `~/.claude.json` whose `hasTrustDialogAccepted` is `true` (after `~` expansion, `realpath`, trailing-slash strip). Subfolders of a trusted folder are not allowed. Configured projects (`REMOTE_AGENT_PROJECTS`) must pass the same check; those that don't are logged and left out.
3. **Start idle**: the Session starts with no initial prompt. The user sends the task as an Instruction in the new Thread (existing flow).
4. **Attachable**: the Session runs interactive `claude` inside a detached tmux session; `tmux attach -t ra-<first 8 chars of session id>` attaches to the same live process. Telegram and the terminal both keep working.
5. **Permission mode**: no `--permission-mode` flag; the user's default from settings applies.
6. **`/end`** in the Thread of a Spawned Session ends it gracefully (`/exit`), then forcibly after 5 s. In any other Thread it replies that only Sessions started from Telegram can be ended remotely.
7. **Spawned Sessions survive Bridge restarts.**
8. **`/status`** shows the attach command next to each Spawned Session.
9. Only the existing allowlisted chat and user can use `/new` and `/end`.

## User flow

1. `/new` → picker message: one button per configured project, labelled with the folder name.
   `/new ~/Sites/foo` → trust check; on failure reply `Not a trusted folder. Open it once in Claude Code locally and accept the trust dialog.`
2. On a button tap or a valid path the Bridge:
   1. generates `sessionId = crypto.randomUUID()`, `tmuxName = ra-<sessionId[0:8]>`;
   2. inserts the Session row (`cwd`, `project`, `spawned = 1`, `tmux_name`);
   3. creates the Thread `<project> · <sessionId[0:8]>` and stores its id (before launch, so the mod's lazy `ensureThread` never creates a second Thread);
   4. runs `systemd-run --user --scope --quiet tmux new-session -d -s <tmuxName> -c <cwd> claude --session-id <sessionId>`;
   5. posts `⏳ Starting… attach with tmux attach -t <tmuxName>` in the Thread;
   6. arms a 30 s startup timer.
3. When the mod's `session_started` Report for `sessionId` arrives, the timer is cleared and the Bridge posts `✅ Ready — send your task here.` (regardless of Away mode). From then on everything is the existing flow, including renaming the Thread to the session name.
4. **Startup timeout** (no `session_started` within 30 s): capture the last 15 pane lines (`tmux capture-pane -p -t <tmuxName>`), redact, post them in the Thread with `❌ Session did not start`, kill the tmux session, mark the Session ended and close the Thread.
5. **`/end`**: `tmux send-keys -t <tmuxName> /exit Enter`; after 5 s, if `tmux has-session` still succeeds, `tmux kill-session`. The `session_ended` Report (or, after a kill, the Bridge itself) marks the Session ended and closes the Thread.

## Components

No Telegram types leave `src/channel/telegram`. The mod does not change: a spawned `claude` loads it like any other Session.

### New: `src/bridge/launcher.ts` — `Launcher`

Owns every tmux and `systemd-run` call. Built on an injected `run(argv: string[]) => Promise<{ code: number; stdout: string; stderr: string }>` (default: `Bun.spawn`, argv array, never a shell).

- `launch({ sessionId, cwd }): Promise<{ tmuxName: string }>` — throws `LaunchError` with redacted stderr on a non-zero exit.
- `exists(tmuxName): Promise<boolean>` — `tmux has-session -t <name>`.
- `capture(tmuxName, lines): Promise<string>`.
- `sendExit(tmuxName): Promise<void>`.
- `kill(tmuxName): Promise<void>` — ignores "session not found".

### New: `src/bridge/trusted.ts` — `TrustedFolders`

- `isTrusted(path): Promise<string | null>` — returns the normalised path if trusted, else `null`. Reads the Claude config file fresh on every call. A missing or unreadable file counts as "nothing trusted" and is reported by `TrustedFoldersUnavailable`.
- `configuredProjects(): Promise<{ label: string; cwd: string }[]>` — `REMOTE_AGENT_PROJECTS` entries that pass `isTrusted`, in configured order; label is the folder basename.

### New: `src/bridge/spawner.ts` — `Spawner`

The use case. Depends on `Store`, `Channel`, `Launcher`, `TrustedFolders`, a clock/timer abstraction and `Log`.

- `picker(): Promise<{ text: string; buttons: LaunchButton[] }>` — builds the picker; records the project list snapshot it was built from (in memory, keyed by a short picker id) so a stale tap is detected.
- `startFromPicker(pickerId, choice): Promise<string>` — toast text.
- `startAt(path): Promise<string>` — reply text.
- `onSessionStarted(sessionId): Promise<void>`.
- `end(sessionId): Promise<string>`.
- `reconcile(): Promise<void>` — on Bridge startup: for every active spawned Session, if its tmux session is gone mark it ended (closing its Thread); if it is alive but not yet started, re-arm a fresh startup timer (the `session_started` Report may have been lost while the Bridge was down).

**Started** means the Bridge has received any request from the mod for that Session (`session_started` Report, Prompt, title, instruction poll), not only `session_started`. This keeps a healthy Session from being killed when its first Report was sent while the Bridge was down.

### Changes

- **`store.ts`**: `sessions` gains `spawned INTEGER NOT NULL DEFAULT 0`, `tmux_name TEXT`, `started_at INTEGER` (set when `session_started` arrives for a spawned Session). Added via guarded `ALTER TABLE` so existing DBs migrate. New `createSpawnedSession({ id, cwd, project, tmuxName })`, `markSpawnedStarted(id)`. `upsertSession` must not overwrite `thread_id`, `spawned`, `tmux_name` or `started_at`. `SessionRow` gains `spawned: boolean`, `tmuxName: string | null`, `startedAt: number | null`.
- **`channel/types.ts`**:
  - `ButtonData = { kind: 'answer'; promptId; questionIndex; optionIndex } | { kind: 'launch'; pickerId: string; choice: number }`.
  - `InboundCommand` gains `args: string` (text after the command, trimmed).
  - `Channel` gains `sendButtons(thread: ThreadRef | null, text: string, buttons: { label: string; data: ButtonData }[]): Promise<MessageRef>`.
- **`channel/telegram/*`**: encode/decode both button kinds within Telegram's 64-byte `callback_data` limit; pass command args; register `/new` and `/end` in `setMyCommands`; implement `sendButtons` (one button per row).
- **`inbound.ts`**: `/new` → `spawner.picker()` / `spawner.startAt(args)`; `/end` → `spawner.end(...)` for the Thread's Session; `onButton` routes `kind: 'launch'` to the Spawner; `/status` appends `tmux attach -t <name>` for spawned Sessions; help text lists the new commands.
- **`http.ts`**: on any request that carries a session id from the mod, call `spawner.onSessionStarted(sessionId)` (idempotent, no-op for non-spawned or already-started Sessions; errors logged, never fail the request).
- **`config.ts`**: `REMOTE_AGENT_PROJECTS` (optional, comma-separated, `~` expanded) and `CLAUDE_CONFIG_PATH` (default `$HOME/.claude.json`); constants `STARTUP_TIMEOUT_MS = 30_000`, `END_GRACE_MS = 5_000`.
- **`main.ts`**: construct `Launcher`, `TrustedFolders`, `Spawner`; call `spawner.reconcile()` after the store opens; log configured projects that are not trusted.
- **Deploy**: `deploy/remote-agent.service` and `.env.example` set `PATH` to include `%h/.local/bin` (claude), `%h/.bun/bin` (bun for hooks) and `/usr/bin` (tmux, systemd-run).
- **README**: setup (install tmux, `REMOTE_AGENT_PROJECTS`), usage of `/new`, `/end`, attaching, and the new limitations.

## Error handling

| Case | Behaviour |
|---|---|
| `/new` with no configured projects and no args | Usage reply: `/new <trusted path>` plus the config hint. |
| Configured project not trusted | Logged at startup; left out of the picker (re-checked on every `/new`). |
| Stale picker tap (list changed or picker id unknown, e.g. after a restart) | Toast `Project list changed — send /new again.` |
| Claude config missing or unreadable | Reply `Can't read Claude Code's trusted folders.` |
| tmux / `systemd-run` missing or failing | Reply with redacted, truncated stderr. Thread closed, Session row marked ended. |
| No `session_started` within 30 s | Pane capture posted, tmux killed, Session ended, Thread closed. |
| `/end` and tmux session already gone | Session marked ended, Thread closed. |
| `/end` in a non-spawned Session's Thread or outside a Thread | Explanatory reply; nothing happens. |
| Bridge restarts | Sessions keep running (separate systemd scope). `reconcile()` cleans up dead or never-started ones. |
| Two `/new` in quick succession | Two Sessions. No de-duplication. |

## Security

- Allowlisted chat and user only (existing adapter check).
- Directories are validated against Claude Code's trusted folders before any process starts; argv arrays only, no shell; the tmux name is derived from the uuid.
- No permission-mode flag, so `bypassPermissions` is not reachable from chat.
- Pane captures and launch errors go through the existing redaction and truncation.

## Testing

Unit (`bun test`):

- `TrustedFolders`: exact match, `~` expansion, trailing slash, symlink resolution, subfolder rejected, untrusted entry, missing/invalid config file, configured-project filtering and order.
- `Launcher`: exact argv for each method against a fake runner; non-zero exit becomes `LaunchError`; `kill` tolerates a missing session.
- `Spawner` with fake channel, launcher, trusted folders and timers: picker → launch → ready; `startAt` untrusted; stale picker tap; launch failure cleanup; startup timeout; `/end` graceful and forced; `/end` on a non-spawned Session; `reconcile` for gone and never-started Sessions.
- `Store`: migration of an existing DB; `upsertSession` keeps spawn fields and thread id.
- Telegram: encode/decode both button kinds (including the 64-byte limit); command args parsing.
- `Inbound`: `/new`, `/end`, launch button routing, `/status` attach line.

Manual end-to-end (recorded in `references/spawn-session-e2e.md`):

1. `/new` → tap project → `✅ Ready` → send an Instruction → it runs.
2. `tmux attach -t ra-…` → type locally; Telegram still receives Prompts and Reports.
3. `systemctl --user restart remote-agent` → the Session survives and keeps working with Telegram.
4. `/new <untrusted path>` is refused.
5. `/end` → Session exits, Thread closes, tmux session gone.

## Out of scope

- Initial task in the `/new` command.
- Choosing a permission mode per Session.
- Ending terminal-started Sessions remotely.
- Resuming an old Session from Telegram (`--resume`).
- Spawning on another machine.
