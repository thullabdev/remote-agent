# Claude Code hooks: reference for a remote human-in-the-loop bridge

Researched 2026-10-06 against Claude Code docs (installed CLI: v2.1.290, Linux).
Primary source throughout: **Hooks reference** <https://code.claude.com/docs/en/hooks> (cited below as `[hooks]` with the section anchor) and **Hooks guide** <https://code.claude.com/docs/en/hooks-guide>.
Anything marked **UNVERIFIED** isn't stated in the docs and wasn't tested.

---

## 1. Where hooks are configured

| Location | Scope |
| :- | :- |
| `~/.claude/settings.json` | All your projects |
| `.claude/settings.json` | One project (can be committed) |
| `.claude/settings.local.json` | One project (not committed) |
| Managed policy settings | Organization-wide |
| Plugin `hooks/hooks.json` | While the plugin is enabled |
| Skill / subagent frontmatter | While that skill/subagent is active |

Source: [hooks#hook-locations](https://code.claude.com/docs/en/hooks#hook-locations).

**Hooks are hot-reloaded into running sessions.** "Claude Code watches your settings files and reloads them when they change, so it applies most edits to the running session without a restart, including edits to `permissions`, `hooks`…" ([settings](https://code.claude.com/docs/en/settings)). The hooks guide adds that if the watcher misses an edit, you restart the session to force a reload ([hooks-guide#hooks-shows-no-hooks-configured](https://code.claude.com/docs/en/hooks-guide)). **This matters a lot: adding bridge hooks to `~/.claude/settings.json` reaches sessions that are already running.**

Workspace trust: in an interactive session, hooks from any settings file (including `~/.claude/settings.json`) are held back until the folder's workspace-trust dialog is accepted ([hooks#workspace-trust](https://code.claude.com/docs/en/hooks#workspace-trust)).

Config shape (three levels: event → matcher group → handlers) ([hooks#configuration](https://code.claude.com/docs/en/hooks#configuration)):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [
          { "type": "command", "command": "/abs/path/bridge-hook", "args": ["pretooluse"], "timeout": 3600, "statusMessage": "Waiting for remote answer…" }
        ]
      }
    ]
  }
}
```

---

## 2. Handler types

Five handler `type`s ([hooks#hook-handler-fields](https://code.claude.com/docs/en/hooks#hook-handler-fields)):

* `command`: runs a process. JSON input goes to **stdin**. The result comes back as the exit code plus stdout/stderr.
* `http`: **POSTs the same JSON** to a `url` (`Content-Type: application/json`). The response body uses the same JSON output schema. Fields are `url`, `headers` (supports `$VAR` interpolation only for names listed in `allowedEnvVars`), and `allowedEnvVars` ([hooks#http-hook-fields](https://code.claude.com/docs/en/hooks#http-hook-fields)).
* `mcp_tool`: calls a tool on a configured MCP server.
* `prompt`: a single-turn LLM evaluation.
* `agent`: a subagent verifier (experimental).

Common fields: `type`, `if` (permission-rule filter, tool events only), `timeout` (seconds), `statusMessage` (spinner text), `once` ([hooks#common-fields](https://code.claude.com/docs/en/hooks#common-fields)).
Command-only fields: `command`, `args` (exec form with no shell), `async`, `asyncRewake`, `shell` ([hooks#command-hook-fields](https://code.claude.com/docs/en/hooks#command-hook-fields)).

All matching hooks **run in parallel**. Identical handlers defined in several settings files run once ([hooks#hook-handler-fields](https://code.claude.com/docs/en/hooks#hook-handler-fields)).

Command hooks run **without a controlling terminal**, so they can't open `/dev/tty`. Use `systemMessage` or `terminalSequence` to reach the user ([hooks#hook-input-and-output](https://code.claude.com/docs/en/hooks#hook-input-and-output)).

HTTP hook response handling ([hooks#http-response-handling](https://code.claude.com/docs/en/hooks#http-response-handling)):
* 2xx with an empty body means success with no decision.
* 2xx with a JSON body is parsed as decision output.
* A non-2xx status, a connection failure, or a plain-text body is a **non-blocking error**, and execution continues.
* "HTTP hooks can't signal a blocking error through status codes alone". To block, return 2xx with decision JSON.
* Allowlists `allowedHttpHookUrls` and `httpHookAllowedEnvVars` exist in settings ([hooks#hook-locations](https://code.claude.com/docs/en/hooks#hook-locations)).

**Implication:** if the local bridge daemon is down, an HTTP hook fails *open* (the action proceeds through the normal flow). This is usually the desired fallback-to-terminal behaviour.

---

## 3. Timeouts (critical for waiting on a human)

From [hooks#common-fields](https://code.claude.com/docs/en/hooks#common-fields):

> `timeout`: Seconds before canceling. … Defaults: **600 for `command`, `http`, and `mcp_tool`**; 30 for `prompt`; 60 for `agent`. Claude Code lowers the `command`, `http`, and `mcp_tool` default to **30 on `UserPromptSubmit`, `PreModelSwitch`, and `PostModelSwitch`**, and to **10 on `MessageDisplay`**. **`SessionEnd`** hooks share a 1.5-second budget; … up to 60 seconds.

* **Maximum `timeout` value: UNVERIFIED.** The docs give defaults and say you can set `timeout` higher ("If your hook needs more time, set the `timeout` field", [hooks#userpromptsubmit](https://code.claude.com/docs/en/hooks#userpromptsubmit)), but they **document no upper bound**. GitHub issues turned up no stated cap either. Before relying on, say, `timeout: 86400`, test it empirically with a hook that sleeps longer than 600 s and logs when it's killed.
* What happens on timeout ([hooks#timeouts](https://code.claude.com/docs/en/hooks#timeouts)): Claude Code **cancels the hook and discards its output**, so on most events "a timed-out hook renders no decision".
  * On `PreToolUse`, "A timed-out `command`, `http`, or `mcp_tool` hook **doesn't block** the tool call. The call continues through the normal permission flow". So a timed-out remote wait falls back to the local terminal dialog, which is a good failure mode.
  * An **Agent SDK callback** hook that times out on `PreToolUse` *blocks* the tool call instead ([hooks#timeouts](https://code.claude.com/docs/en/hooks#timeouts), [agent-sdk/hooks#hook-timeout](https://code.claude.com/docs/en/agent-sdk/hooks)).
  * A `UserPromptSubmit` hook that times out has its output (including `additionalContext`) discarded, and the prompt still reaches Claude ([hooks#userpromptsubmit](https://code.claude.com/docs/en/hooks#userpromptsubmit)).
* `async: true` hooks: Claude Code does **not** enforce `timeout`. `asyncRewake` hooks: Claude Code **does** enforce `timeout` ([hooks#run-hooks-in-the-background](https://code.claude.com/docs/en/hooks#run-hooks-in-the-background)).
* Related setting: `askUserQuestionTimeout` (`60s`, `5m`, `10m`) auto-closes an unanswered AskUserQuestion. The timer never starts while the session is connected to Remote Control or in a background session ([tools-reference#askuserquestion-tool-behavior](https://code.claude.com/docs/en/tools-reference)).

---

## 4. Common stdin input fields

From [hooks#common-input-fields](https://code.claude.com/docs/en/hooks#common-input-fields):

| Field | Notes |
| :- | :- |
| `session_id` | Current session ID. Use it as the correlation key for the session. |
| `prompt_id` | UUID of the user prompt currently being processed. Absent until the first input. |
| `transcript_path` | JSONL transcript. **Written asynchronously and may lag.** Use `last_assistant_message` on Stop/SubagentStop instead of reading it. |
| `cwd` | Working directory. |
| `scratchpad_dir` | v2.1.257+. |
| `permission_mode` | `default`, `plan`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions` (not on every event). |
| `effort` | `{ "level": … }` on tool-context events. |
| `hook_event_name` | Event name. |
| `agent_id`, `agent_type` | Present inside subagents or with `--agent`. |

Example (PreToolUse/Bash), quoted from the docs:

```json
{
  "session_id": "abc123",
  "prompt_id": "550e8400-e29b-41d4-a716-446655440000",
  "transcript_path": "/home/user/.claude/projects/.../transcript.jsonl",
  "cwd": "/home/user/my-project",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "npm test", "description": "Run test suite", "timeout": 120000, "run_in_background": false },
  "tool_use_id": "toolu_01ABC123..."
}
```

Useful environment variables in hook processes:
* `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA` ([hooks#exec-form-and-shell-form](https://code.claude.com/docs/en/hooks#exec-form-and-shell-form)).
* `CLAUDE_CODE_REMOTE` (`"true"` in cloud sessions). `CLAUDE_CODE_BRIDGE_SESSION_ID` is set while Remote Control is connected (v2.1.199+) ([hooks#hook-handler-fields](https://code.claude.com/docs/en/hooks#hook-handler-fields)).
* **`CLAUDE_CODE_MESSAGING_SOCKET` / `CLAUDE_CODE_MESSAGING_TOKEN`** hold the session's cross-session inbox socket path and token ([env-vars](https://code.claude.com/docs/en/env-vars), [cross-session-messaging#the-sessions-inbox-socket](https://code.claude.com/docs/en/cross-session-messaging)). See `claude-code-channels-and-remote.md` §4.

---

## 5. Exit codes and JSON output

From [hooks#exit-code-output](https://code.claude.com/docs/en/hooks#exit-code-output):

* **Exit 0** means success. stdout is parsed as JSON if it starts with `{` and ends with `}`. For `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`, and `PostModelSwitch`, plain-text stdout is added as context for Claude.
* **Exit 2** means a blocking error on events that can block. stderr becomes the reason unless the JSON gives one. "even a JSON `permissionDecision` of `"allow"` can't override it."
* **Any other code** is non-blocking (the action proceeds), unless valid JSON on stdout decides. "exit code 1 [is] a non-blocking error".

Exit-2 effect per event ([hooks#exit-code-2-behavior-per-event](https://code.claude.com/docs/en/hooks#exit-code-2-behavior-per-event)), relevant rows:

| Event | Can block? | Exit 2 effect |
| :- | :- | :- |
| `PreToolUse` | Yes | Blocks the tool call |
| `PermissionRequest` | **No** | Ignored. Use the `decision` object. |
| `UserPromptSubmit` | Yes | Blocks the prompt |
| `Stop` / `SubagentStop` | Yes | Prevents stopping; the conversation continues |
| `Notification` | No | Ignored |
| `Elicitation` | Yes | Denies the elicitation |
| `SessionStart` / `SessionEnd` | No | stderr is shown to the user |

**Universal JSON fields** ([hooks#json-output](https://code.claude.com/docs/en/hooks#json-output)):

| Field | Default | Meaning |
| :- | :- | :- |
| `continue` | `true` | `false` stops Claude entirely. Takes precedence over decisions. |
| `stopReason` | – | Shown to the user when `continue: false`. |
| `suppressOutput` | `false` | No effect. |
| `systemMessage` | – | Warning shown to the user. |
| `terminalSequence` | – | An allowlisted OSC/BEL escape for desktop notifications. Interactive only. |

`additionalContext`, `systemMessage`, `initialUserMessage`, and plain stdout are each **capped at 10,000 characters**. Over the cap, the text is saved to a file and replaced with the path plus a 2,000-character preview ([hooks#json-output](https://code.claude.com/docs/en/hooks#json-output)).

**`additionalContext`** is wrapped in a system reminder. The docs warn: "Text framed as out-of-band system commands can trigger Claude's prompt-injection defenses". Write it as factual statements ([hooks#add-context-for-claude](https://code.claude.com/docs/en/hooks#add-context-for-claude)).

**Decision-pattern table**, quoted from [hooks#decision-control](https://code.claude.com/docs/en/hooks#decision-control):

| Events | Pattern | Key fields |
| :- | :- | :- |
| UserPromptSubmit, PostToolUse, PostToolUseFailure, PostToolBatch, **Stop, SubagentStop**, ConfigChange, PreCompact | top-level `decision` | `decision: "block"`, `reason`. Stop/SubagentStop also accept `hookSpecificOutput.additionalContext`. |
| **PreToolUse** | `hookSpecificOutput` | `permissionDecision` (`allow`/`deny`/`ask`/`defer`), `permissionDecisionReason`, `updatedInput`, `additionalContext` |
| **PermissionRequest** | `hookSpecificOutput` | `decision.behavior` (`allow`/`deny`), `decision.updatedInput`, `decision.updatedPermissions`, `decision.message`, `decision.interrupt` |
| **Elicitation** | `hookSpecificOutput` | `action` (`accept`/`decline`/`cancel`), `content` |
| ElicitationResult | `hookSpecificOutput` | `action`, `content` (override) |
| SessionStart, SubagentStart, PostModelSwitch | context only | `additionalContext`. SessionStart also takes `initialUserMessage`, `watchPaths`, `sessionTitle`, `reloadSkills`. |
| Setup, **Notification**, SessionEnd, PostCompact, InstructionsLoaded, StopFailure, … | none | side effects only |

---

## 6. Events relevant to a remote bridge

The full list of 30+ events is at [hooks](https://code.claude.com/docs/en/hooks) (table at the top). These are the relevant ones.

### 6.1 `Notification` (observe only)
Matcher values: `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`, `elicitation_url_dialog`, `elicitation_complete`, `elicitation_response`, `agent_needs_input`, `agent_completed`, `quota_auto_resume_*` ([hooks#notification](https://code.claude.com/docs/en/hooks#notification)).
* Timing: `permission_prompt` fires "once you haven't typed for **about six seconds**". `idle_prompt` fires about **60 s** after Claude finishes. Use `PermissionRequest` for an immediate signal.
* Input: `message`, optional `title`, `notification_type`.
  ```json
  { "session_id": "abc123", "transcript_path": "…", "cwd": "…", "hook_event_name": "Notification",
    "message": "Claude needs your permission", "title": "Permission needed", "notification_type": "permission_prompt" }
  ```
* "Notification hooks can't block or modify notifications". `systemMessage` and `continue` are discarded.

### 6.2 `PermissionRequest` (can answer approvals)
* Fires "when Claude Code is about to ask you for permission". Matches on tool name ([hooks#permissionrequest](https://code.claude.com/docs/en/hooks#permissionrequest)).
* Input: `tool_name`, `tool_input` (**no `tool_use_id`**), optional `permission_suggestions[]`, and `mcp_server` for MCP tools.
* Output:
  ```json
  { "hookSpecificOutput": { "hookEventName": "PermissionRequest",
      "decision": { "behavior": "allow", "updatedInput": { "command": "npm run lint" } } } }
  ```
  `behavior` is `allow`/`deny`. For allow you can also send `updatedInput` and `updatedPermissions[]` (`addRules`/`replaceRules`/`removeRules`/`setMode`/`addDirectories`/`removeDirectories`, with destinations `session`/`localSettings`/`projectSettings`/`userSettings`). For deny you can send `message` and `interrupt`. Deny/ask rules are still evaluated.
* Exit 2 is **not honored** for this event.
* With an SDK `canUseTool` host or `--permission-prompt-tool`, "the hooks run alongside your host, and whichever decides first applies".
* **UNVERIFIED:** in a plain interactive terminal, whether the terminal dialog is visible and answerable *while* a slow PermissionRequest hook is still running (a race) or only after the hook returns. The guide's wording "The transcript shows 'Allowed by PermissionRequest hook' where the dialog would have appeared" ([hooks-guide](https://code.claude.com/docs/en/hooks-guide)) suggests the dialog waits for the hook. Test this before designing a first-answer-wins race on this event.

### 6.3 `PreToolUse` (can answer AskUserQuestion)
* Matches any tool except `EndConversation`, including `AskUserQuestion` and `ExitPlanMode` ([hooks#pretooluse](https://code.claude.com/docs/en/hooks#pretooluse)).
* Input: `tool_name`, `tool_input`, `tool_use_id` (plus `mcp_server` for MCP tools).
* `AskUserQuestion` `tool_input` ([hooks#askuserquestion](https://code.claude.com/docs/en/hooks#askuserquestion)): `questions[]` with `question`, `header`, `options[{label, description}]`, `multiSelect`. There's also an optional `answers` object: "Maps question text to the selected option label. Multi-select answers join labels with commas. **Claude doesn't set this field; supply it via `updatedInput` to answer programmatically**". Limits: 1–4 questions, 2–4 options each; `header` is at most 12 characters ([agent-sdk/user-input](https://code.claude.com/docs/en/agent-sdk/user-input)).
* Output fields ([hooks#pretooluse-decision-control](https://code.claude.com/docs/en/hooks#pretooluse-decision-control)): `permissionDecision`, `permissionDecisionReason`, `updatedInput` (**replaces the whole input**), `additionalContext`. When several hooks disagree, precedence is `deny` > `defer` > `ask` > `allow`.

#### ✅ Answering AskUserQuestion from a hook (documented)
Quoted from [hooks#allow-with-updatedinput](https://code.claude.com/docs/en/hooks#allow-with-updatedinput):
> A `PreToolUse` hook satisfies that requirement when it … 1. Reads the tool's input from stdin 2. Collects the answer through your own UI 3. Returns `permissionDecision: "allow"` together with `updatedInput` that holds the answer, so the tool runs without prompting. **Returning `"allow"` alone is not sufficient for these tools.**

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "updatedInput": {
      "questions": [
        { "question": "Which framework?", "header": "Framework",
          "options": [{"label": "React", "description": "Component library"}, {"label": "Vue", "description": "Progressive framework"}],
          "multiSelect": false }
      ],
      "answers": { "Which framework?": "React" }
    }
  }
}
```
* Echo back the original `questions` array and add `answers`. Free-text answers go in `answers[question]` (the SDK docs describe the same response shape, including an optional `response` freeform field, [agent-sdk/user-input#response-format](https://code.claude.com/docs/en/agent-sdk/user-input)). **UNVERIFIED:** that `response` is honored when it comes from a CLI hook's `updatedInput`.
* `ExitPlanMode` works the same way (it needs `updatedInput`). Its input carries `plan` and `planFilePath` injected by Claude Code. The PermissionRequest route also works for `ExitPlanMode` ([hooks-guide#auto-approve-specific-permission-prompts](https://code.claude.com/docs/en/hooks-guide)).
* MCP tools marked `_meta["anthropic/requiresUserInteraction"]` can't be auto-allowed by a hook.
* **Important consequence:** the hook runs *before* the question dialog is drawn, and synchronous hooks "block Claude's execution until they complete" ([hooks#run-hooks-in-the-background](https://code.claude.com/docs/en/hooks#run-hooks-in-the-background)). So **while a PreToolUse hook waits for Telegram, the local terminal can't answer the question.** The user sees `statusMessage` and a spinner. The fallback comes on timeout or a "give up" decision from the daemon: the hook exits 0 with no output, and the normal local dialog appears. (This is inferred from documented ordering; the exact on-screen behaviour is not documented.)
* **`defer`** (`permissionDecision: "defer"`) works only in `-p` mode. In interactive sessions "it logs a warning and ignores the hook result" ([hooks#defer-a-tool-call-for-later](https://code.claude.com/docs/en/hooks#defer-a-tool-call-for-later)).

### 6.4 `PostToolUse`
Input adds `tool_response` and `duration_ms`. Output: `decision: "block"` + `reason`, `additionalContext`, `updatedToolOutput` (must match the tool's output shape), `updatedMCPToolOutput` ([hooks#posttooluse](https://code.claude.com/docs/en/hooks#posttooluse)). Use it for progress mirroring to Telegram (ideally as an async hook).

### 6.5 `Stop` / `SubagentStop` (make the agent continue with a new instruction)
* `Stop` fires when the main agent finishes responding. It doesn't fire on a user interrupt, and API errors fire `StopFailure` instead ([hooks#stop](https://code.claude.com/docs/en/hooks#stop)).
* Input: `stop_hook_active`, **`last_assistant_message`**, `background_tasks[]`, `session_crons[]`.
  ```json
  { "session_id": "abc123", "hook_event_name": "Stop", "stop_hook_active": true,
    "last_assistant_message": "I've completed the refactoring. Here's a summary...",
    "background_tasks": [], "session_crons": [] }
  ```
* Output ([hooks#stop-decision-control](https://code.claude.com/docs/en/hooks#stop-decision-control)):
  ```json
  { "decision": "block", "reason": "<the user's Telegram reply goes here>" }
  ```
  "`decision`: `"block"` prevents Claude from stopping … `reason`: Required when `decision` is `"block"`. Tells Claude why it should continue". The alternative `hookSpecificOutput.additionalContext` also continues the turn and is labelled "Stop hook feedback" rather than an error. For SubagentStop: "Returning `decision: "block"` with a `reason` keeps the subagent running and delivers `reason` to the subagent **as its next instruction**" ([hooks#subagentstop](https://code.claude.com/docs/en/hooks#subagentstop)).
* Loop guard: an "**8-consecutive-continuation cap**" (configurable via `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`). The count resets each time Claude calls a tool.
* **Pattern A (synchronous):** the Stop hook posts `last_assistant_message` to Telegram, waits up to `timeout` for a reply, then returns block+reason, or exits 0 to let the session go idle. Drawback: the turn stays "open" while waiting. **UNVERIFIED** how the terminal behaves if the local user types during that wait.
* **Pattern B (asyncRewake, recommended to test):** `"async"`-style background hook with **`"asyncRewake": true`**. "runs in the background and **wakes Claude on exit code 2**. The hook's stderr … is shown to Claude as a system reminder" ([hooks#command-hook-fields](https://code.claude.com/docs/en/hooks#command-hook-fields)). And: "an `asyncRewake` hook that exits with code 2 **wakes Claude immediately even when the session is idle**" ([hooks#limitations](https://code.claude.com/docs/en/hooks#limitations)). The session goes idle normally, so the local user can type, while the background hook long-polls the daemon. When a Telegram reply arrives it prints the text to stderr and exits 2. `timeout` *is* enforced for asyncRewake. **UNVERIFIED:** how Claude weighs text delivered as a system reminder versus a real user turn (prompt-injection defenses may make it surface the text rather than act on it).

### 6.6 `UserPromptSubmit`
Input: `prompt` (plus `session_title`). It also fires for scheduled tasks, background subagent reports, and cross-session messages ([hooks#userpromptsubmit](https://code.claude.com/docs/en/hooks#userpromptsubmit)). Output: `decision: "block"`, `reason`, `additionalContext`, `sessionTitle`, `suppressOriginalPrompt`. It **can't replace** the prompt text ([hooks#decision-control](https://code.claude.com/docs/en/hooks#decision-control)). Default timeout is 30 s. Bridge use: tell the daemon "local user answered or typed", which cancels any pending remote waits (first-answer-wins).

### 6.7 `SessionStart` / `SessionEnd`
* SessionStart matchers: `startup`, `resume`, `clear`, `compact`, `fork`. Input: `source`, optional `model`, `agent_type`, `session_title`. Output: `additionalContext`, `initialUserMessage` (**`-p` mode only**), `sessionTitle`, `watchPaths`, `reloadSkills`. `CLAUDE_ENV_FILE` is available. Only `command` and `mcp_tool` types are supported, and `mcp_tool` is skipped at launch ([hooks#sessionstart](https://code.claude.com/docs/en/hooks#sessionstart)).
* SessionEnd reasons: `clear`, `resume`, `logout`, `prompt_input_exit`, `other`. There's a 1.5 s budget, raisable to 60 s or via `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS`. No decision control ([hooks#sessionend](https://code.claude.com/docs/en/hooks#sessionend)).
* Bridge use: register and unregister sessions with the daemon (`session_id`, `cwd`, `transcript_path`, `$CLAUDE_CODE_MESSAGING_SOCKET`, `$PPID`).

### 6.8 `Elicitation` / `ElicitationResult` (MCP server input requests)
* `Elicitation` fires "when an MCP server requests user input mid-task". Hooks "can intercept this request and respond programmatically, skipping the dialog entirely". Matcher is the MCP server name ([hooks#elicitation](https://code.claude.com/docs/en/hooks#elicitation)).
* Input: `mcp_server_name`, `message`, optional `mode` (`form`/`url`), `url`, `elicitation_id`, `requested_schema`.
* Output:
  ```json
  { "hookSpecificOutput": { "hookEventName": "Elicitation", "action": "accept", "content": { "username": "alice" } } }
  ```
  Exit 2 denies. `systemMessage`/`continue` are discarded.

### 6.9 Others worth knowing
`PermissionDenied` (auto-mode denials, `retry: true`), `StopFailure` (API errors, output ignored), `PostToolBatch`, `TaskCreated`/`TaskCompleted`, `PreCompact`/`PostCompact` ([hooks](https://code.claude.com/docs/en/hooks)).

---

## 7. Async hooks

* `async: true` means a background, non-blocking hook. Its `additionalContext`/`systemMessage` is delivered on the **next** turn. "If the session is idle, the response waits until the next user interaction." There's no dedup across firings, and `timeout` isn't enforced ([hooks#run-hooks-in-the-background](https://code.claude.com/docs/en/hooks#run-hooks-in-the-background)).
* `asyncRewake: true` is the exception: exit 2 wakes an idle session immediately, and `timeout` is enforced.
* Use async `PostToolUse`/`Notification` hooks for fire-and-forget mirroring to the daemon.

---

## 8. Summary answers

| Question | Answer |
| :- | :- |
| Default hook timeout | 600 s (command/http/mcp_tool); 30 s on UserPromptSubmit; 1.5 s SessionEnd budget ([hooks#common-fields](https://code.claude.com/docs/en/hooks#common-fields)) |
| Maximum hook timeout | **UNVERIFIED. No documented cap.** Test empirically. |
| Can a hook answer AskUserQuestion? | **Yes**: PreToolUse + `permissionDecision: "allow"` + `updatedInput` with `questions` + `answers` ([hooks#allow-with-updatedinput](https://code.claude.com/docs/en/hooks#allow-with-updatedinput)). Whether PermissionRequest also fires for AskUserQuestion: **UNVERIFIED**. |
| Can a hook approve/deny tool permission? | Yes: PermissionRequest `decision.behavior`, or PreToolUse `permissionDecision`. |
| Can a Stop hook inject a new instruction? | Yes: `{"decision":"block","reason":"…"}` continues the turn with `reason` as guidance (8-continuation cap). `asyncRewake` + exit 2 can wake an idle session. |
| HTTP hooks? | Yes, `type: "http"` (POST JSON, same output schema; failures are non-blocking). |
| Do settings edits reach running sessions? | Yes, settings files are watched and reloaded ([settings](https://code.claude.com/docs/en/settings)). |
