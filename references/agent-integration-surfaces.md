# Agent integration surfaces: Codex CLI, Gemini CLI, Pi vs the Claude Code mod

Researched 2026-11-04 with primary sources only (vendor docs plus project repos). Nothing was run or installed; the Pi repo was cloned and read, never executed. Versions read:

| Agent | Docs / source version |
| :- | :- |
| Codex CLI | Latest GitHub release `rust-v0.166.0` ([releases](https://github.com/openai/codex/releases)); docs at `learn.chatgpt.com/docs/*` (`developers.openai.com/codex/*` 308-redirects there), read 2026-11-04 |
| Gemini CLI | Latest release `v0.66.0` (2026-10-27); docs read from `main` @ `89e9d25d` ([repo](https://github.com/google-gemini/gemini-cli/tree/main/docs)) |
| Pi | `@earendil-works/pi-coding-agent` **1.5.0**, repo `badlogic/pi-mono` @ `676af1d` (2026-11-03), docs under `packages/coding-agent/docs/` |
| Claude Code | v2.1.290/291, see [claude-code-hooks.md](./claude-code-hooks.md) and the two ADRs |

Anything marked **UNVERIFIED** was not stated in a primary source and was not tested. The Codex and Gemini docs are summarised from the pages themselves; where a statement only appeared in a fetched-page summary rather than verbatim text, it is not used.

---

## 0. What "Pi" is

The user pointed at <https://pi.dev/>. That page says: "Pi is a minimal agent harness", lists extensions, skills, prompt templates, themes, and "interactive, print/JSON, RPC, and SDK modes". Its links:

* Docs: <https://pi.dev/docs/latest>
* Repo: <https://github.com/earendil-works/pi/tree/main/packages/coding-agent>
* npm: <https://www.npmjs.com/package/@earendil-works/pi-coding-agent>
* Install: `curl -fsSL https://pi.dev/install.sh | sh`

The clone of `github.com/badlogic/pi-mono` (the repo the research brief guessed) has `packages/coding-agent/package.json` named `@earendil-works/pi-coding-agent`, version 1.5.0, and the same README text ("Pi is a minimal, extensible agent harness"). Its changelog links point at `github.com/earendil-works/pi`. So the badlogic/pi-mono repo and earendil-works/pi are the same project, and the guess was right. Whether pi-mono is a rename or a redirect of earendil-works/pi was not checked (UNVERIFIED). Package paths below use `packages/coding-agent/docs/<file>.md` in that repo.

---

## 1. Codex CLI (OpenAI)

### 1.1 Hooks

Source: Hooks page, <https://learn.chatgpt.com/docs/hooks> (release behavior reference; the page says main-branch schemas may be newer).

* **Events:** `SessionStart` (matcher on source: `startup`, `resume`, `clear`, `compact`, `fork`), `SessionEnd` (reason is always `other` today), `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `PreModelRequest`, `PostModelRequest`, `SubagentStart`, `SubagentStop`, `Stop`, `Interrupt`.
* **Config:** `hooks.json` or inline `[hooks]` in `config.toml`, in any active config layer. Practical locations: `~/.codex/hooks.json`, `~/.codex/config.toml`, `<repo>/.codex/hooks.json`, `<repo>/.codex/config.toml`. Plugins can bundle `hooks/hooks.json`. All matching hooks from all layers run, concurrently. Project-local hooks load only when the project `.codex/` layer is trusted; user and system hooks load regardless.
* **Trust review:** non-managed hooks must be reviewed and trusted in `/hooks` before they run; trust is recorded against the hook hash, so a new or changed hook is skipped until trusted. `--dangerously-bypass-hook-trust` skips this for one invocation.
* **Handler types:** `command` and `mcp_tool` run; `prompt` and `agent` are parsed but skipped. `async: true` runs a command hook in the background (cannot block or approve). `timeout` is in seconds, default 600; `SessionEnd` and `Interrupt` default to 1 s, max 3 s.
* **Hot reload into running sessions:** the docs say nothing about it. Hooks are "listed before deciding which ones can run" and "Codex prints a warning at startup" for hooks needing review. **UNVERIFIED** whether editing `hooks.json` affects a session that is already running.
* **Common stdin fields:** `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`; turn-scoped events add `turn_id`; most events add `permission_mode` (`default`, `acceptEdits`, `plan`, `dontAsk`, `bypassPermissions`).
* **`Stop` (turn complete):** adds `turn_id`, `stop_hook_active`, `last_assistant_message` (string or null). **No duration field.** Output `{"decision":"block","reason":...}` does not reject the turn: it "automatically creates a new continuation prompt that acts as a new user prompt" using the reason.
* **`PreToolUse`:** `tool_name`, `tool_use_id`, `tool_input`. Can deny (`permissionDecision: "deny"`, or exit 2) or rewrite with `permissionDecision: "allow"` + `updatedInput`. `ask` is parsed but unsupported.
* **`PostToolUse`:** adds `tool_response`.
* **`PermissionRequest`:** `turn_id`, `tool_name`, `tool_input`, `tool_input.description` (human-readable reason, not guaranteed). It "runs when Codex is about to ask for approval... It can allow the request, deny the request, or decline to decide and let the normal approval prompt continue." Output `hookSpecificOutput.decision.behavior` = `allow` or `deny` (+`message`). "If multiple matching hooks return decisions, any deny wins. Otherwise, an allow lets the request proceed without surfacing the approval prompt. If no matching hook decides, Codex uses the normal approval flow." `updatedInput`, `updatedPermissions`, `interrupt` fail closed.
* **Tool coverage caveat:** hooks cover Bash, `apply_patch`, MCP and most local function tools; hosted tools (for example WebSearch) are not covered, and "some specialized tool paths can opt out".

### 1.2 Remote answer vs local dialog

* The docs describe `PermissionRequest` as running before the prompt is shown, and an `allow` "lets the request proceed without surfacing the approval prompt". They do not say the TUI dialog stays visible and answerable while the hook is running. **UNVERIFIED**; the wording points to hook-first, then dialog, which would mean a hook that waits for Telegram blocks the local dialog (no first-answer-wins) for as long as it waits. Needs a spike or a read of `codex-rs` source.
* The app-server route is different: it is a protocol where the client answers approvals (see 1.7). Whether a second attached client and the TUI both receive the same approval request and race is not documented. **UNVERIFIED**.

### 1.3 Injecting a user turn into a running session

* **`codex queue --thread <SESSION_ID|name> --message "..."`** ([CLI reference](https://learn.chatgpt.com/docs/cli/reference)): "Queue a text message for an existing session by UUID or exact name." Text only; uses the session's model. `--resume` also resumes the session if it isn't loaded, which needs "a running local daemon or a server selected with `--remote`". Whether a message queued this way reaches a TUI session someone started by hand, and whether it lands as a real user turn, is not documented. **UNVERIFIED**.
* **App-server methods** ([App Server](https://learn.chatgpt.com/docs/app-server)): `turn/start` (new turn on a thread), `turn/steer` ("append user input to the active in-flight turn"), `turn/interrupt`, `thread/resume`, `thread/inject_items` ("append raw Responses API items to a loaded thread's model-visible history without starting a user turn"). These need a client connected to the app-server that owns the thread.
* **`Stop`-hook continuation** (1.1) turns a hook reason into a new user-style prompt, but only at the moment a turn ends.
* No documented stdin or MCP-inbound path into a plain interactive TUI. tmux `send-keys` remains the generic fallback (not a Codex feature).

### 1.4 Asking the user a question

* App-server has an experimental server request `tool/requestUserInput` ("prompt the user with 1-3 short questions for a tool call"; `isOther` for free-form; params include `autoResolutionMs`). A client answers it; the server then emits `serverRequest/resolved`, and also emits it if the request is cleared by turn start, completion or interruption. This is the answerable-remotely path, but only for a client connected over app-server.
* Whether hooks see this tool: `PreToolUse` matches "other local function tools" by name, but `request_user_input` is not named in the hooks page. **UNVERIFIED** whether a hook can intercept or answer it in the TUI.

### 1.5 Session id

* Hooks read `session_id` (Codex session id; subagents use the parent's). In the docs' `SessionEnd` example it is `thr_123`; the app-server calls the same thing `threadId`.
* No documented launch flag to choose the id; the CLI reference only has ids for `resume`, `fork`, `queue`, `exec resume` (`uuid | session name`). **UNVERIFIED** that none exists.
* Resume keeps the same thread; `fork` creates a new id (`thread/fork`: "new thread id"). Hook `SessionStart` has `source: resume` vs `fork`.

### 1.6 Launch flags, exit

* Model: `--model, -m`. Approvals: `--ask-for-approval, -a`. Config override: `-c key=value`. Profile: `--profile`. No-daemon: `--no-daemon`.
* Exit: `/quit` or `/exit` ([slash commands](https://learn.chatgpt.com/docs/cli/slash-commands)). Signal behaviour is not documented here (UNVERIFIED); the `SessionEnd` hook runs "when Codex closes normally".
* `notify = ["prog", ...]` in `config.toml` runs a program on `agent-turn-complete` (the only supported event) ([advanced config](https://learn.chatgpt.com/docs/config-file/config-advanced)). Payload fields were not read in full (UNVERIFIED).

### 1.7 Remote-control surfaces

* **`codex exec`** (non-interactive), `codex exec resume [SESSION_ID]`, `codex exec fork`.
* **`codex app-server`**: JSON-RPC 2.0. Transports: stdio JSONL (default), WebSocket `--listen ws://IP:PORT` ("experimental and unsupported"), Unix socket `--listen unix://[PATH]`. `codex generate-ts` / `generate-json-schema` give per-version schemas. Methods include `thread/start|resume|fork|read|list`, `turn/start|steer|interrupt`, `thread/inject_items`, `thread/unsubscribe`. Server-initiated requests: `item/commandExecution/requestApproval` (decisions `accept`, `acceptForSession`, `decline`, `cancel`, exec-policy amendment), `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `tool/requestUserInput`; each followed by `serverRequest/resolved`. Notifications: `turn/started`, `turn/completed` (`{turn}` with `status` `completed|interrupted|failed`), `item/*`, `hook/started|completed`. `turn/completed` carries a status and error info, not a documented duration or final text field; the final assistant text arrives as an `agentMessage` item (UNVERIFIED field names).
* **TUI over app-server:** `codex --remote ws://host:port | wss:// | unix://[PATH]` connects the TUI itself to a running app-server ([App Server](https://learn.chatgpt.com/docs/app-server), "Connect the CLI terminal UI"). So a session can be both a TUI and reachable by another client, but only if it was started that way.
* **Shared background server:** the CLI reference has `--no-daemon` ("Run the interactive CLI without the shared background server") and `codex remote-control [start|stop|pair]` ("start remote control through the managed background server"). Whether a plain `codex` run uses the shared daemon by default is not stated. **UNVERIFIED**; if it does, hand-started sessions would be reachable through it.
* **`codex mcp-server`:** exists; the CLI reference notes the command and binary "have" (text cut off in what was read; UNVERIFIED what it offers).
* The app-server docs say it "is primarily for development and debugging and may change without notice" (CLI reference).

---

## 2. Gemini CLI (Google)

### 2.1 Hooks

Sources: [hooks/index.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/index.md), [hooks/reference.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md) (main @ `89e9d25d`, release v0.66.0).

* **Events:** `SessionStart` (source `startup|resume|clear`), `SessionEnd` (reason `exit|clear|logout|prompt_input_exit|other`; "the CLI will not wait for this hook"), `BeforeAgent`, `AfterAgent`, `BeforeModel`, `AfterModel`, `BeforeToolSelection`, `BeforeTool`, `AfterTool`, `PreCompress`, `Notification`.
* **Config:** `hooks` in `settings.json`; precedence project `.gemini/settings.json` > user `~/.gemini/settings.json` > system `/etc/gemini-cli/settings.json` > extensions. Only `type: "command"`. Default timeout 60000 ms. Project hooks are fingerprinted; a changed hook is "treated as a new, untrusted hook" with a warning. `/hooks` has `list|panel|enable|disable|enable-all|disable-all`.
* **Hot reload:** not stated. **UNVERIFIED**. (`/commands reload` and `/agents reload` exist for other things, not hooks.)
* **Env for hooks:** `GEMINI_SESSION_ID`, `GEMINI_CWD`, `GEMINI_PROJECT_DIR` (alias `CLAUDE_PROJECT_DIR`).
* **Stdin base fields:** `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `timestamp`.
* **`AfterAgent` (turn complete):** `prompt`, `prompt_response` (final agent text), `stop_hook_active`. No duration. `decision: "deny"` forces a retry with `reason` sent "to the agent as a new prompt".
* **`BeforeTool`:** `tool_name`, `tool_input`, `mcp_context`. Can `deny`/exit 2 (reason goes to the model), or merge `hookSpecificOutput.tool_input`. No documented `allow`/`ask` that answers the confirmation.
* **`AfterTool`:** adds `tool_response` (`llmContent`, `returnDisplay`, `error`).
* **`Notification`:** `notification_type` (only `ToolPermission`), `message`, `details`. "Observability Only: This hook cannot block alerts or grant permissions automatically."
* **Permissions are policy, not hooks:** the policy engine decides `allow`, `deny` or `ask_user` per tool ([policy-engine.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/policy-engine.md)).

### 2.2 Remote answer vs local dialog

* No hook can answer the tool-confirmation dialog. `Notification` (ToolPermission) fires and can only observe, so the mod could learn a Permission Request appeared and forward it, but not settle it. Whether a remote decision could be applied to the live dialog is not possible per the docs.
* A `BeforeTool` hook that waits for a remote answer could return `deny` or let the call through, but whether the confirmation dialog is shown before or after `BeforeTool`, and whether it stays answerable during the hook, is not documented. **UNVERIFIED**.
* In ACP mode the client answers `session/request_permission` (see 2.7); there is no local dialog because the client is the UI.

### 2.3 Injecting a user turn into a running session

* Hooks: `AfterAgent` `deny`+`reason` injects a new prompt, but only at turn end. `BeforeAgent`/`SessionStart` `additionalContext` appends context, not a user turn.
* ACP: `prompt` method sends a prompt (client owns the session; see 2.7).
* No documented stdin, socket or extension API into an already-running plain interactive session. **UNVERIFIED** (the docs read do not cover it; the `/ide` integration is a separate IDE companion channel whose message surface was not read).

### 2.4 Asking the user a question

* Built-in `ask_user` tool ([tools/ask-user.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/ask-user.md)): 1-4 questions, each `question`, `header` (max 16 chars), `type` `choice|text|yesno`, `options[] {label, description}`, `multiSelect`, `placeholder`. It "pauses execution until the user provides answers or dismisses the dialog"; result `{"answers":{"0": "Option A", ...}}` keyed by question index.
* It is a tool, so `BeforeTool` matches `ask_user`; whether a hook may supply the answer (a hook can only deny or rewrite input) is not documented. **UNVERIFIED**; denying only produces a tool error for the model.

### 2.5 Session id

* Hooks get `session_id` in stdin and `GEMINI_SESSION_ID` in env.
* Resume: `--resume` / `-r` with `latest`, an index, or the full session UUID ([session-management.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/session-management.md)). `stream-json` headless output has an `init` event with session ID and model.
* No documented flag to choose the session id at launch. **UNVERIFIED** that none exists. Whether the id is unchanged across resume is not stated (UNVERIFIED).

### 2.6 Launch flags, exit

* [cli-reference.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md): `--model, -m` (default `auto`), `--prompt, -p` (non-interactive), `--prompt-interactive, -i` (run prompt then stay interactive), `--approval-mode` (`default|auto_edit|yolo|plan`), `--resume, -r`, `--list-sessions`, `--output-format, -o` (`text|json|stream-json`), `--acp`.
* Exit: `/quit` or `/exit` ([commands.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/commands.md)). Signals: not documented (UNVERIFIED).
* `general.enableNotifications` (experimental, off by default) emits OSC 9 or BEL when the model needs approval or a session completes ([notifications.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/notifications.md)). Terminal escapes only, no payload.

### 2.7 Remote-control surfaces

* **Headless** (`-p`, or a non-TTY): JSON (`response`, `stats`, `error`) or `stream-json` events `init`, `message`, `tool_use`, `tool_result`, `error`, `result`. Exit codes 0, 1, 42, 53. One run per process ([headless.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md)).
* **ACP** (`gemini --acp`): JSON-RPC 2.0 over stdio, for IDEs ([acp-mode.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md); code in `packages/cli/src/acp/acpClient.ts`). Methods: `initialize`, `authenticate`, `newSession`, `loadSession`, `prompt`, `cancel`, `setSessionMode`, `unstable_setSessionModel`; permission asks arrive as client-side `session/request_permission` (MCP tool calls carry `toolCall._meta['gemini-cli'].mcp {server_name, tool_name}`). ACP spec: <https://agentclientprotocol.com>.
* ACP is a child-process protocol: the client starts and owns the agent. A TUI session started by hand cannot be reached through it. No TUI-attach mode is documented.

---

## 3. Pi (pi.dev, `@earendil-works/pi-coding-agent` 1.5.0)

Sources: `packages/coding-agent/docs/{extensions,rpc,rpc-commands,rpc-extension-ui,cli,cli-integration,sessions,sdk,security,tui}.md` in the repo at `676af1d`; published docs at <https://pi.dev/docs/latest> (not re-read; the repo copy is the version cited).

### 3.1 Extension events

* **Model:** a TypeScript/JS extension (a factory taking the `ExtensionAPI`) running **inside the Pi process** with full user permissions. Locations: `~/.pi/agent/extensions/*.ts|js` or `*/index.ts` (global), `.pi/extensions/` (project, loaded only after project trust), plus `settings.json` `extensions` / `packages` entries and `pi -e <path>` per launch (`--no-extensions` / `-ne` to disable discovery).
* **Hot reload:** "Extensions in auto-discovered locations can be hot-reloaded with `/reload`." That is a command the user (or an extension, `ctx.reload()`) runs inside the session; nothing in the docs says Pi watches files or accepts an external reload signal. A running session therefore needs one `/reload` (same as the Claude Code mod's `/reload-plugins`).
* **Lifecycle:** `session_start` (`reason`: `startup|reload|new|resume|fork`), `session_shutdown` (`reason`: `quit|reload|new|resume|fork`; "Exit covers Ctrl+C, Ctrl+D, SIGHUP, and SIGTERM"), `input`, `before_agent_start`, `agent_start`, `agent_end` (`event.messages`), `agent_before_settle`, `agent_settled` (`event.aborted`; "final and notification-only", meant for status integrations), `turn_start`/`turn_end` (`event.message`, `event.toolResults`, `outcome`), `message_*`, `tool_execution_start|update|end`, `tool_call`, `tool_result`, `ui_prompt_start|ui_prompt_end` (fire around `ctx.ui.select|confirm|input|editor|custom`, "so host/status integrations can report 'waiting for user'"), `model_select`, `session_info_changed`, compaction and tree events.
* **Turn complete:** `agent_settled` is the "will not continue" signal; `agent_end` can be followed by retry, compaction retry or queued work. Neither documents a duration field; the final assistant text comes from the messages (`agent_end.messages`, `turn_end.message`). Duration would have to be computed from timestamps (`turn_start` has `timestamp`). Exact payload types: UNVERIFIED beyond the fields quoted in the docs.
* **`tool_call` (permission hook point):** fires after `tool_execution_start`, before the tool runs. `event.toolName`, `event.toolCallId`, mutable `event.input`. Return `{ block: true, reason?, terminate? }` to block. It is async, so it can await anything (a remote answer). Pi itself has **no built-in approval prompt**: "it does not ask for approval before every tool call" ([security.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/security.md)); permission gating is done by extensions (example `examples/extensions/permission-gate.ts`, "Block dangerous commands"). The `tool_call` handler applies to MCP tools too.
* **`ctx` fields:** `ctx.cwd`, `ctx.mode` (`tui|rpc|json|print`), `ctx.hasUI`, `ctx.sessionManager.getSessionId()`, `getSessionFile()`, `getSessionName()`, `ctx.isIdle()`, `ctx.signal`, `ctx.shutdown()`, `ctx.reload()`.

### 3.2 Remote answer vs local dialog

* Because the approval dialog is itself extension code, an extension can race it. `ctx.ui.confirm(title, message, opts)` and `ctx.ui.select(...)` accept `{ timeout }` or `{ signal: AbortSignal }` (see `examples/extensions/timed-confirm.ts`, "timed-signal"). An extension can call `confirm` in `tool_call`, abort its signal when a remote answer arrives, and settle the remote side when the local dialog resolves. That gives first-answer-wins with the local dialog staying answerable. The docs and the example show the mechanism; the specific "local confirm aborted by remote answer" pattern is not documented as a recipe (the example aborts on a timer). **Partial: mechanism documented, pattern not tested.**
* In RPC mode dialogs become `extension_ui_request` records on stdout and the client answers with `extension_ui_response` ([rpc-extension-ui.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc-extension-ui.md)); the dialog's `timeout` auto-resolves on the agent side.

### 3.3 Injecting a user turn into a running session

* **`pi.sendUserMessage(content, { deliverAs?: "steer" | "followUp", expandPromptTemplates? })`**: "sends an actual user message that appears as if typed by the user. It starts or queues a turn". While streaming, `deliverAs` is required (`steer`: after the current tool calls; `followUp`: after all tools), otherwise the message is rejected. The `input` event sees it with `event.source === "extension"`.
* An extension can poll a socket or file (timers allowed after `session_start`; docs warn against starting background resources in the factory itself because it can run in invocations with no session). See also `examples/extensions/file-trigger.ts` ("File watcher triggers messages").
* **RPC `prompt` / `steer` / `follow_up`** commands do the same for an RPC-driven process ([rpc-commands.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc-commands.md)).
* `pi.sendMessage` sends a custom message, not a user message.

### 3.4 Asking the user a question

* There is no built-in AskUserQuestion tool. Extensions build it: `examples/extensions/question.ts`, `questionnaire.ts`, `qna.ts` use `ctx.ui.select/input/editor/custom`. The dialog methods (including `timeout` and `signal`) are the same race point as in 3.2. A Bridge-provided extension could register a tool and answer it either way.

### 3.5 Session id

* `pi --session-id <id>`: "Opens the current directory's existing session with the ID, or creates it otherwise. IDs accept letters, numbers, `.`, `_`, and `-`" (must start and end alphanumeric; not combinable with `--session`, `--continue`, `--resume`; combine with `--fork` to choose the new fork's id) ([cli.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/cli.md)). So the Bridge can choose it at launch.
* Extensions read it via `ctx.sessionManager.getSessionId()`. Stable across resume: `--session <path|id>` opens the existing session and each session "records the working directory it was created in and never changes it" ([sessions.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sessions.md)); that the id itself is unchanged on resume is implied, not stated verbatim (UNVERIFIED). `/fork` and `/clone` make new sessions; `/new` starts one (`session_shutdown` then `session_start` fire for these).

### 3.6 Launch flags, exit

* `--model <pattern>` (exact or fuzzy; accepts `provider/id` and `:<thinking>` suffix), `--provider`, `--thinking`, `--models`, `--session-id`, `--session`, `--continue`, `--resume`, `--fork`, `--no-session`, `--name`, `-p/--print`, `--mode text|json|rpc`, `-e/--extension`.
* Exit: `/quit` in the TUI ([slash-commands.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/slash-commands.md)); SIGTERM/SIGHUP/Ctrl+C/Ctrl+D run `session_shutdown` (extension docs); `ctx.shutdown()` requests a graceful exit (deferred until idle in the TUI).

### 3.7 Remote-control surfaces

* **Print** (`-p`): final assistant text on stdout, one run. **JSON** (`--mode json`): JSONL events, prompts all supplied at start, process exits. **RPC** (`--mode rpc`): long-lived, JSONL over stdin/stdout, commands `prompt`, `steer`, `follow_up`, `abort`, `new_session`, `get_state`, `get_messages`, `set_model`, ..., plus the `extension_ui_request/response` sub-protocol. **SDK**: in-process Node/Bun embedding ([sdk.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md); exported `RpcClient` for a subprocess).
* All are process-owning modes: the controller starts Pi. No documented way to attach RPC to a TUI session someone started by hand. That session is reachable only through an extension loaded in it (3.3). **No attach mode documented.**

---

## 4. What the Claude Code mod does today (for comparison)

From `mod/remote-agent/hooks/register.ts`, `hooks/protocol.ts`, `bin/permission-hook.ts`, [ADR-0001](../docs/adr/0001-mod-as-session-client.md) and [ADR-0002](../docs/adr/0002-permission-requests-via-command-hook.md):

* In-process mod hooks `session.start`, `session.end`, `turn.complete` report to the Bridge over a Unix socket (`SessionInfo {sessionId, cwd}`; `turn_complete {text, durationMs, isAborted}`).
* Questions: mod hook on `tool.call` for `AskUserQuestion` races `resolvePrompt` (Bridge) against `$.ui.ask` (local dialog); on a remote answer the hook answers the call itself.
* Permission Requests: a `PermissionRequest` **command hook** (separate `bun` process per request) posts to the Bridge and exits silently on any failure so the native dialog decides. It runs concurrently with the native dialog; a local answer does not cancel it, so the mod's `tool.call` hook tells the Bridge the call finished and the Bridge settles the Telegram Prompt.
* Instructions: `$.clock.every(3000)` polls the Bridge and calls `$.prompt.submit({ text, asUser: true })`.
* Reaches already-running sessions after one `/reload-plugins`.

---

## 5. Capability matrix

Rows are the mod's needs. Cells: Yes / Partial / No / UNVERIFIED with a short note.

| Need | Claude Code (mod + hook) | Codex CLI | Gemini CLI | Pi |
| :- | :- | :- | :- | :- |
| Reports session start / end | Yes: mod `session.start` / `session.end` | Yes: `SessionStart` / `SessionEnd` hooks (End: reason always `other`, 1 s default timeout, also fires after 30 min idle) | Yes: `SessionStart` / `SessionEnd` hooks (End is best effort, not awaited) | Yes: `session_start` / `session_shutdown` events (reasons incl. quit, reload, new, resume, fork) |
| Reports turn complete with final text | Yes: `turn.complete` `answer` | Yes: `Stop` hook `last_assistant_message` | Yes: `AfterAgent` hook `prompt_response` | Partial: `agent_settled`/`agent_end` give messages; text taken from messages (field shape not fully documented) |
| Turn duration in payload | Yes: `durationMs` | No: not in `Stop` payload; must time from `UserPromptSubmit` to `Stop` | No: not in `AfterAgent`; hook `timestamp` only | No: not documented; compute from `turn_start.timestamp` |
| Register Permission Request with Bridge | Yes: `PermissionRequest` command hook (no `tool_use_id`) | Yes: `PermissionRequest` hook (`tool_name`, `tool_input`, `description`) | Partial: `Notification` (`ToolPermission`) is observe-only; `BeforeTool` sees the call but not the dialog | Yes: `tool_call` event (no built-in dialog; extension owns it) |
| Remote answer races local dialog (first wins) | Yes: hook runs concurrently with native dialog | UNVERIFIED: docs say hook runs before prompt; allow skips the prompt; unclear if dialog stays up while the hook waits | No: no hook can answer the dialog; a blocking `BeforeTool` hook's effect on the dialog is UNVERIFIED | Partial: `ctx.ui.confirm` takes `signal`/`timeout`, so remote-wins aborts the local dialog; pattern not documented end to end |
| Settle remote prompt when answered locally | Yes: `tool.call` completion plus `turn.complete` | UNVERIFIED: `PostToolUse` fires after tool output; decline path has no hook | Partial: `AfterTool` fires on completion; denial path UNVERIFIED | Yes (if extension owns the dialog: its own `confirm` resolves; also `tool_execution_end` for every finalized call) |
| Question (AskUserQuestion) interception and remote answer | Yes: mod answers `AskUserQuestion` itself | Partial: app-server `tool/requestUserInput` is answerable by a client; TUI hook interception UNVERIFIED | UNVERIFIED: `ask_user` is a tool; hooks can deny/rewrite but not documented to supply answers | Partial: no built-in tool; extension-built questions use `ctx.ui` with the same `signal`/`timeout` race |
| Poll for Instructions and submit as a real user turn | Yes: `$.prompt.submit({asUser:true})` from the mod | Partial: `codex queue` and app-server `turn/start`/`turn/steer` exist; delivery into a hand-started TUI session is UNVERIFIED; `Stop`-hook block only continues at turn end | No: documented paths are ACP `prompt` (client-owned child) or `AfterAgent` retry at turn end | Yes: `pi.sendUserMessage(..., {deliverAs})` from an extension (needs a timer/socket in the extension) |
| Read session id and cwd | Yes: `$.session.id()`, `$.session.cwd()` | Yes: hook stdin `session_id`, `cwd` | Yes: stdin `session_id`, `cwd`; env `GEMINI_SESSION_ID` | Yes: `ctx.sessionManager.getSessionId()`, `ctx.cwd` |
| Choose session id at launch | UNVERIFIED: not covered in the existing notes (the mod only reads the id via `$.session.id()`) | UNVERIFIED: no flag found; resume/fork/queue take ids | UNVERIFIED: no flag found in the CLI reference | Yes: `--session-id <id>` |
| Hooks reach already-running sessions | Yes for settings hooks (hot reload); mod needs `/reload-plugins` | UNVERIFIED (trust review at startup; no hot-reload statement) | UNVERIFIED | Partial: needs `/reload` run inside the session |
| Model flag | `--model` | `--model, -m` | `--model, -m` | `--model <pattern>`, `--provider` |
| Clean exit | UNVERIFIED here (not covered in the existing notes) | `/quit` or `/exit` | `/quit` or `/exit` | `/quit`; SIGTERM/SIGHUP run `session_shutdown` |
| Official programmatic mode | Agent SDK, `-p`, Channels, Remote Control | `exec`, `app-server` (stdio/ws/unix), `mcp-server`, SDK | `-p` headless, `stream-json`, `--acp` | print, JSON, RPC, SDK |
| Can a hand-started TUI session also be reached by that mode | No (needs the mod/hooks) | Partial: `codex --remote` TUI on an app-server, and a possible shared daemon; plain `codex` default UNVERIFIED | No documented attach | No documented attach (only extensions loaded in it) |

---

## 6. Implications (facts only, not decisions)

**Full experience (answer Prompts remotely and send Instructions into already-running sessions):**

* **Pi:** viable through an extension. One in-process extension can hook `session_*`, `agent_settled`, `tool_call`, `ctx.ui`, and `pi.sendUserMessage`, which covers every need in the matrix. It reaches sessions that already run after one `/reload`, and it is the same shape as the Claude Code mod. Open points: pattern for aborting the local `confirm` on a remote answer, turn duration, exact `agent_settled`/`agent_end` payload.
* **Codex:** hooks cover reporting (start, end, turn complete with text, permission, tool completion), but remote Instruction injection into a hand-started TUI session has no documented path, and the permission-race behaviour is UNVERIFIED. The app-server (`codex --remote` or a shared daemon) gives approvals, `requestUserInput`, `turn/start`/`steer` to any connected client, but only for threads owned by that server. Items to spike: does the TUI dialog stay answerable during a `PermissionRequest` hook; does a plain `codex` use the shared daemon; does `codex queue` deliver into a running TUI.
* **Gemini CLI:** the hooks give reporting (start, end, `AfterAgent` text, tool before/after, `Notification`), but there is no hook that answers a permission dialog or injects a user turn into a running TUI. The full experience is not available with documented surfaces.

**Only for Bridge-spawned sessions:**

* **Codex:** `app-server` over stdio/unix socket, or `codex exec`; the Bridge acts as the client and answers approvals, questions and steers turns directly.
* **Gemini CLI:** `gemini --acp` (client answers `session/request_permission`, sends `prompt`, `cancel`, `loadSession`) or `-p --output-format stream-json` for one-shot runs.
* **Pi:** `pi --mode rpc` (JSONL commands, `extension_ui_request/response` for dialogs) or the SDK; the Bridge can also pass `--session-id` and `-e <extension>` at spawn.
* **Claude Code (for reference):** Agent SDK / Channels, per ADR-0001.

**Spikes still needed before any of this is relied on** (each is UNVERIFIED above): Codex `PermissionRequest` timing vs dialog; Codex hook hot reload; Codex `codex queue` into a running TUI; Gemini `BeforeTool` timing vs the confirmation dialog; Gemini hook hot reload; Gemini `--session-id` equivalent; Pi `confirm` abort-by-signal in the TUI; Pi session id stability across `--session` resume.
