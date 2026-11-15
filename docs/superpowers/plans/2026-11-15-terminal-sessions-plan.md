# Terminal pilot: persistent sessions — implementation plan

> **For agentic workers:** Implement task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Start only after `feat/extension-system` (storage) is merged.

**Goal:** Terminal sessions run in tmux on a dedicated socket, survive reloads and bridge restarts, are stored through the extension storage API, are grouped by launch folder, and open from a chat at that chat's launch folder.

**Spec:** `docs/superpowers/specs/2026-11-15-terminal-sessions-design.md` (read it first).

**Branch:** `feat/terminal-pilot`, from `feat/extension-system`.

## Global constraints

- tmux calls are argv arrays only. No shell strings. `sid` validated before any tmux argument.
- The dedicated tmux server (`-L remote-agent-terminal`) starts with an allowlisted environment. Never `process.env` wholesale.
- Folder is `launchCwd`, set once at create. Never read `Chat.cwd` or `sessions.cwd` for terminals.
- Coding rule: no short-if early returns in TypeScript (use braces).
- The browser never invents a `sid`.

## File structure

New:
- `extensions/terminal/backend/tmux.ts`: the tmux runtime (`createSession`, `hasSession`, `killSession`, `attachArgv`, `listSessions`), dedicated socket, env allowlist.
- `extensions/terminal/backend/sessions.ts`: the sessions repository over the storage collection, plus reconcile and idle logic.
- `extensions/terminal/backend/routes.ts`: HTTP handlers for `GET/POST/DELETE .../sessions`.
- `extensions/terminal/frontend/sessions-client.ts`: fetch wrapper for the list, create, and delete.
- Tests: `extensions/terminal/backend/tmux.test.ts`, `sessions.test.ts`, `routes.test.ts`, `extensions/terminal/frontend/grouping.test.ts`.

Modified:
- `extensions/terminal/backend/pty.ts`: becomes the attach-client runner. Replay buffer removed.
- `extensions/terminal/backend/index.ts`: migrations and collection declaration, reconcile on activate, WebSocket protocol change (`open` has no cwd).
- `extensions/terminal/plugin.json`: `storage` permission and the `sessions` collection.
- `extensions/terminal/frontend/TerminalPanel.tsx`: hydration, not-found state, footer label "Started in".
- `src/ui/app.tsx`: sidebar grouping, chat-header reuse-or-create, remove client-side sid generation.

## Tasks

### Task 1: tmux runtime on a dedicated socket

**Files:** Create `extensions/terminal/backend/tmux.ts`, `tmux.test.ts`.

- [ ] **Step 1: Failing tests (real tmux, dedicated socket, cleaned up in `afterEach`).**
  - `createSession('ra-term-test', { cwd: '/tmp', cols: 80, rows: 24 })` then `hasSession` is true.
  - `killSession` then `hasSession` is false.
  - `hasSession` of an unknown name is false (no throw).
  - The shell's environment does not contain a variable set on the bridge (`process.env.RA_TEST_SECRET`): run `printenv RA_TEST_SECRET` in the session, capture, expect empty.
  - A `sid` with `;` or spaces is rejected before any process runs.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Every call is `Bun.spawn(['tmux', '-L', SOCKET, ...])` with the allowlisted env. `createSession` uses `new-session -d -s name -c cwd -x cols -y rows <shell> -l`. Set `window-size latest` once created so the attached client drives size.
- [ ] **Step 4: Run tests, commit:** `feat(terminal): tmux runtime on a dedicated socket`.

### Task 2: Attach clients replace the in-memory PTY sessions

**Files:** Modify `extensions/terminal/backend/pty.ts` (rename the module's role to attach runner), `pty.test.ts`.

- [ ] **Step 1: Failing tests.**
  - `attach(name, { cols, rows, onOutput, onExit })` returns a handle; writing `echo hi` and getting `hi` back through `onOutput`.
  - `detach(handle)` kills the attach client but leaves `hasSession(name)` true.
  - Reattaching after detach shows the existing screen (the marker printed before detach appears in the new output).
  - Two attach clients on one tmux session is allowed (tmux supports it); the WebSocket layer, not this module, enforces one client per tab.
- [ ] **Step 2: Implement.** `Bun.spawn(attachArgv, { terminal: { cols, rows, data, exit } })`. `detach` calls `proc.kill()` on the attach client only.
- [ ] **Step 3: Delete** the replay buffer, `REPLAY_LIMIT_BYTES`, and their tests.
- [ ] **Step 4: Run tests, commit:** `refactor(terminal): attach to tmux sessions instead of owning shells`.

### Task 2b: Automatic scrollback on attach

**Files:** Modify `extensions/terminal/backend/pty.ts`, `pty.test.ts`.

- [ ] **Step 1: Failing tests (real tmux).** Print 3 000 numbered lines, detach, reattach: the first frame after `ready` contains line 1000 (inside the 2 000-line window) and does not contain line 1 (outside it). The payload is at most 1 MB.
- [ ] **Step 2: Implement.** On attach, before live output, run `capture-pane -p -e -S -2000` and send it as one `replay` frame. Cap at 1 MB by dropping the oldest lines.
- [ ] **Step 3: Run tests, commit:** `feat(terminal): replay scrollback on every attach`.

### Task 3: Sessions collection and repository

**Files:** Create `extensions/terminal/backend/sessions.ts`, `sessions.test.ts`. Modify `plugin.json`.

- [ ] **Step 1: Declare** the `storage` permission and the `sessions` collection with indexes `owner`, `launchCwd`, `project`, `chatId`, `closedAt` (see spec Decision 4).
- [ ] **Step 2: Failing tests** against the storage API from the platform branch.
  - `create({ owner, launchCwd, chatId })` returns a row with a server-generated `sid`, `project` = basename, `closedAt` null.
  - `listOpen(owner)` returns open rows only, newest first, scoped to the owner.
  - `close(sid, reason)` sets `closedAt`; closing twice is a no-op.
  - `launchCwd` cannot be changed by `update` (the repository has no update method for it).
  - `findOpenByFolder(owner, launchCwd)` returns the newest open row for that folder.
  - `countOpen(owner)` for the cap.
- [ ] **Step 3: Implement** on top of `api.storage.collection('sessions')`.
- [ ] **Step 4: Run tests, commit:** `feat(terminal): persist sessions in the extension's storage`.

### Task 4: Server-created sessions over HTTP

**Files:** Create `extensions/terminal/backend/routes.ts`, `routes.test.ts`. Modify `index.ts`.

- [ ] **Step 1: Failing tests** (using the host's `authorize` in front of the routes, as `extension-auth.test.ts` does).
  - `POST .../sessions` with a valid folder returns `{ sid, cwd, createdAt }`, creates a tmux session, and writes a row.
  - `POST` with a missing folder returns 400 naming the path; nothing is created.
  - `POST` past 8 open sessions returns 409 with the count.
  - `POST` when tmux is not installed returns 500 with "tmux is not installed"; nothing is written.
  - `GET` returns only the caller's open sessions.
  - `DELETE` of another owner's `sid` returns 404; of own `sid` kills tmux and sets `closedAt` with reason `user`.
  - A `sid` that fails validation returns 400 before any process runs.
- [ ] **Step 2: Implement** the three handlers. Owner is read from the authorized request's login, never from the body.
- [ ] **Step 3: Run tests, commit:** `feat(terminal): create, list, and close sessions over HTTP`.

### Task 5: WebSocket uses the stored session

**Files:** Modify `extensions/terminal/backend/index.ts`, `index.test.ts`.

- [ ] **Step 1: Failing tests.**
  - `open` with a `sid` that exists and is owned attaches to its tmux session and returns `ready` with the stored `launchCwd`.
  - `open` with a `sid` not in storage, or closed, returns an error with code `not_found`. No session is created.
  - `open` with a `cwd` field is ignored (the folder is not a client-controlled input any more).
  - WebSocket close detaches (attach client killed, tmux session alive, `lastAttachedAt` updated).
  - `close` frame kills tmux and sets `closedAt`.
- [ ] **Step 2: Implement.** The route looks up the row by `sid` and owner, then attaches. Remove `cwd` from the open schema.
- [ ] **Step 3: Run tests, commit:** `feat(terminal): attach only to sessions the server has stored`.

### Task 6: Startup reconcile and idle reaping

**Files:** Modify `sessions.ts`, `index.ts`. Test: `sessions.test.ts`.

- [ ] **Step 1: Failing tests.**
  - Activate with one open row whose tmux session exists and one whose does not: the first stays open; the second gets `closedAt` with reason `missing`.
  - A detached session with `lastAttachedAt` 11 h ago is not reaped; 13 h ago it is (use an injected clock).
  - A restart does not reset the idle clock: reconcile does not update `lastAttachedAt`.
- [ ] **Step 2: Implement** `reconcile()` run from `onActivate`, and a single interval timer (not one timer per session) that checks detached rows.
- [ ] **Step 3: Run tests, commit:** `feat(terminal): reconcile sessions on start and reap idle ones`.

### Task 7: Frontend: hydrate, not-found, grouping, chat link

**Files:** Create `extensions/terminal/frontend/sessions-client.ts`, `grouping.ts`, `grouping.test.ts`. Modify `TerminalPanel.tsx`, `src/ui/app.tsx`.

- [ ] **Step 1: Failing tests.**
  - `groupByFolder(sessions)` groups by `project`, groups sorted by newest session, rows inside each group newest first.
  - `?terminal=<sid>` not in the list: the panel fetches; if still absent it renders "This shell has ended" and a "Start a new shell here" button (no `POST`).
  - The footer label reads "Started in" and shows `launchCwd`, not `cwd`.
  - Chat header: with an open session for the chat's `launchCwd`, the action selects it; without one, it posts `{ cwd: launchCwd, chatId }`.
- [ ] **Step 2: Implement.** The client never generates a `sid`; it uses the one `POST` returns. `openNewTerminal` becomes `createSession({ cwd, chatId })`.
- [ ] **Step 3: Remove** the in-memory-only `terminals` state as the source of truth; it becomes a cache of `GET` results.
- [ ] **Step 4: Run tests, commit:** `feat(terminal): load sessions from the server, group by folder, reuse per folder`.

### Task 8: Verification

- [ ] **Step 1:** `bun run typecheck`, `bun test`, `bun run build` all clean.
- [ ] **Step 2: Manual check on a copy of the dev database:** create a terminal from a chat, reload the page (same tab still there), restart the bridge (shell still there after restart, with its screen), close the tab (tmux session gone).
- [ ] **Step 3:** Confirm `tmux -L remote-agent-terminal ls` shows only sessions the storage marks open.
- [ ] **Step 4: Commit:** `test(terminal): cover persistence, reconcile, and folder reuse`.

## Self-review

- Spec coverage: tmux runtime (Task 1), no replay buffer (Task 2), server-created sessions (Task 4), storage (Task 3), folder rule and chat link (Tasks 5, 7), reconcile and idle (Task 6), UI (Task 7). Scrollback replay on every attach (spec Decision 2) is Task 2b below. Idle reaping uses the 12 h clock agreed in review.
- Risk: Task 2 changes how shells are owned. It is the only task where existing behavior changes underneath, so it is tested against real tmux before the HTTP layer depends on it.
