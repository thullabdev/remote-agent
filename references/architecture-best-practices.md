# Architecture and best practices: Telegram ↔ live Claude Code sessions

Synthesis of [claude-code-hooks.md](./claude-code-hooks.md), [claude-code-channels-and-remote.md](./claude-code-channels-and-remote.md), and [telegram-bot-api.md](./telegram-bot-api.md). Researched 2026-10-06. Target: TypeScript on Bun 1.2.5 / Node 24, Claude Code v2.1.290 on Linux. Claims carry inline sources, and **UNVERIFIED** marks design assumptions that need a spike.

---

## 1. Goals and constraints

1. **Monitor** every active local `claude` session: what it's doing, when it's waiting, and its last answer.
2. **Answer** from Telegram so the *same* session continues: permission prompts, `AskUserQuestion`, plan approval, and new instructions after Claude stops.
3. Work with sessions the user starts normally (`claude` in any terminal), ideally including ones **already running** when the bridge is installed.
4. Never strand the local user. If Telegram is slow or down, the terminal still works.

Constraint 3 rules out the Agent SDK, tmux, and Channels as the *primary* path, because each needs a special launch ([claude-code-channels-and-remote.md §8](./claude-code-channels-and-remote.md)). It points to **settings hooks**, which hot-reload into running sessions ([settings](https://code.claude.com/docs/en/settings)), plus the **inbox socket** and/or a **mod** for injecting turns.

---

## 2. Recommended architecture

```
 ┌──────────────── each claude session (unchanged launch) ────────────────┐
 │ settings hooks in ~/.claude/settings.json (hot-reloaded)                 │
 │   SessionStart/End ─┐  Notification(async) ─┐  PostToolUse(async) ─┐    │
 │   PreToolUse[AskUserQuestion|ExitPlanMode] ─┤  PermissionRequest ──┤    │
 │   Stop (sync wait or asyncRewake) ──────────┤  UserPromptSubmit ───┤    │
 │   $CLAUDE_CODE_MESSAGING_SOCKET (inbox) ◄───┼──────────────────────┼─┐  │
 └─────────────────────────────────────────────┼──────────────────────┼─┼──┘
                     type:"http" → 127.0.0.1    │   or command client  │ │ inject turn
                                                ▼                      ▼ │ (UNVERIFIED wire fmt)
 ┌────────────────────── bridge daemon (Bun, single process) ─────────────┴──┐
 │ Hook API (Bun.serve on unix socket or 127.0.0.1 + bearer token)           │
 │ Request broker: pending requests, first-answer-wins, timeouts             │
 │ bun:sqlite (WAL): sessions, requests, answers, tg_messages, offsets       │
 │ Redactor (secrets) · Formatter (HTML-escape, 4096 chunking)               │
 │ Telegram adapter: grammY long polling, allowlist on from.id               │
 └───────────────────────────────────────────────────────────────────────────┘
                                   ▲  HTTPS long-poll (no inbound port)
                                   ▼
                          Telegram (1 forum topic per session)
```

### 2.1 Components
1. **Bridge daemon** (`bun run daemon.ts`, managed by systemd `--user`). It is the only owner of the bot token and the only `getUpdates` consumer (a second poller gets 409, see [telegram-bot-api.md §2.1](./telegram-bot-api.md)).
2. **Hook endpoints.** Prefer **`type: "http"` hooks** to `http://127.0.0.1:<port>/hook/<event>` with an `Authorization: Bearer $BRIDGE_TOKEN` header (`allowedEnvVars: ["BRIDGE_TOKEN"]`) ([hooks#http-hook-fields](https://code.claude.com/docs/en/hooks#http-hook-fields)). If the daemon is down, an HTTP hook gives a non-blocking error and the action proceeds, so Claude falls back to the local dialog ([hooks#http-response-handling](https://code.claude.com/docs/en/hooks#http-response-handling)). A small **command client** (`bridge-hook <event>`, compiled with `bun build --compile`) is the alternative when you need Unix-socket IPC, `$PPID`, or env such as `CLAUDE_CODE_MESSAGING_SOCKET`. Env vars like `CLAUDE_CODE_MESSAGING_SOCKET` are exported to hook *processes* ([env-vars](https://code.claude.com/docs/en/env-vars)), so capture them with a command hook (e.g. `SessionStart` and, for already-running sessions, the first `PreToolUse`/`Stop` seen).
3. **IPC transport.** A Unix domain socket under `$XDG_RUNTIME_DIR/claude-bridge.sock` with mode `0600` (Bun: `Bun.serve({ unix: path, fetch })`, [bun http server](https://bun.com/docs/runtime/http/server)) is the safest, because there's no TCP port. HTTP hooks need a URL, so if you use them, bind **`127.0.0.1` only**, require the bearer token, and set `allowedHttpHookUrls` in settings ([hooks#hook-locations](https://code.claude.com/docs/en/hooks#hook-locations)).
4. **Persistence: `bun:sqlite`** with `PRAGMA journal_mode = WAL;` (recommended by Bun for concurrent readers plus a single writer) and `db.transaction()` for atomic state changes ([bun sqlite](https://bun.com/docs/runtime/sqlite)). Tables:
   * `sessions(session_id PK, cwd, title, transcript_path, inbox_socket, pid, topic_thread_id, status, last_seen)`
   * `requests(id PK, session_id, kind ['permission'|'question'|'plan'|'stop'|'elicitation'], tool_use_id, payload_json, state ['pending'|'answered'|'expired'|'cancelled'], answered_via ['telegram'|'local'|'timeout'], answer_json, created_at, expires_at)`
   * `tg_messages(chat_id, message_id, thread_id, request_id)` to map replies back
   * `kv(key PK, value)` for `last_update_id`

### 2.2 Flows

**A. Monitoring (non-blocking)**
* `SessionStart` (command hook) registers the session. The daemon creates a forum topic per session ([api#createforumtopic](https://core.telegram.org/bots/api#createforumtopic)).
* `Notification` with `async: true` forwards `permission_prompt` / `idle_prompt` / `elicitation_dialog` ([hooks#notification](https://code.claude.com/docs/en/hooks#notification)).
* `PostToolUse` with `async: true` provides throttled progress by editing one status message (FAQ: about 1 msg/s per chat, see [telegram-bot-api.md §7](./telegram-bot-api.md)).
* `SessionEnd` closes the topic.
* For a polling backstop, `claude agents --json` lists live sessions with `status` (`busy`/`waiting`/`idle`) and `waitingFor` (`permission prompt`, `input needed`, …). It's described as "the supported way to read session state from outside Claude Code" ([agent-view#read-session-state-from-a-script](https://code.claude.com/docs/en/agent-view)). **UNVERIFIED:** whether `--json` includes plain interactive (non-background) sessions with `status`. The docs say "every live session" and show `kind: interactive`.

**B. AskUserQuestion / ExitPlanMode (blocking PreToolUse)**
1. Claude calls `AskUserQuestion`. The `PreToolUse` hook (matcher `AskUserQuestion|ExitPlanMode`, `timeout` e.g. 900, `statusMessage: "Waiting for answer on Telegram… (answers locally after timeout)"`) POSTs to the daemon.
2. The daemon checks policy. If the user is "at the desk" (presence file, recent keystrokes, or a "remote mode" toggle), it returns `{}` **immediately**, and the local dialog shows as normal.
3. Otherwise it stores the request, sends an inline keyboard (callback_data `q:<reqId>:<idx>`, at most 64 bytes, see [telegram-bot-api.md §4](./telegram-bot-api.md)) plus an "Other…" ForceReply. It then holds the HTTP response open.
4. On answer it returns the documented shape: `permissionDecision: "allow"` and `updatedInput: { questions, answers: { "<question>": "<label or free text>" } }` ([hooks#allow-with-updatedinput](https://code.claude.com/docs/en/hooks#allow-with-updatedinput)).
5. **Timeout / fallback:** the daemon must answer *before* the hook's `timeout`. It returns `{}` at `timeout - 5s`, so the terminal dialog appears. A hook that actually times out also falls through to the normal flow ([hooks#timeouts](https://code.claude.com/docs/en/hooks#timeouts)), but returning explicitly gives cleaner state. It then edits the Telegram message to "⏱ moved to terminal".
6. **Limitation:** while PreToolUse waits, the local user *can't* answer in the terminal, because the dialog renders after the hook returns. So "first-answer-wins" here means Telegram **or** a local cancel route. Examples: a tiny local CLI `bridge answer <reqId>`, or a keypress handled by a mod. A true simultaneous race needs Channels (permissions only) or a mod ([claude-code-channels-and-remote.md §1, §5](./claude-code-channels-and-remote.md)).

**C. Permission prompts (`PermissionRequest`)**
* The same pattern applies, returning `hookSpecificOutput.decision.behavior: "allow"|"deny"`, optional `updatedPermissions` (e.g. echo a `permission_suggestions` entry for "always allow"), and `message` on deny ([hooks#permissionrequest-decision-control](https://code.claude.com/docs/en/hooks#permissionrequest-decision-control)).
* Show `tool_name` plus a **redacted** `tool_input` preview in `<pre>`.
* **Spike first (UNVERIFIED):** whether the terminal dialog is answerable concurrently while this hook is pending. If it is, you get a real race. The daemon must then also learn that the local user answered. `PostToolUse` for that tool (allowed) or the absence of it (denied) can serve as the signal. **UNVERIFIED** heuristics.

**D. "Claude finished. What next?" (Stop)**

Two options, to be decided by a spike:
* **D1 Synchronous Stop hook.** Post `last_assistant_message` (chunked, HTML-escaped) to the topic. Wait up to N minutes. On a Telegram reply, return `{"decision":"block","reason":"<reply>"}`. The `reason` "Tells Claude why it should continue" ([hooks#stop-decision-control](https://code.claude.com/docs/en/hooks#stop-decision-control)). Check `stop_hook_active` and keep in mind the 8-continuation cap (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`). Downside: the session looks busy while waiting.
* **D2 Idle injection.** Let Stop return immediately (async notify). Then, when a Telegram message arrives for an idle session, inject it as a new turn via one of these:
  * the **inbox socket** at `$CLAUDE_CODE_MESSAGING_SOCKET`, which starts a new turn when idle ([cross-session-messaging#message-delivery](https://code.claude.com/docs/en/cross-session-messaging)). Wire format UNVERIFIED. Framed as "from another session".
  * an **`asyncRewake` Stop hook** that long-polls the daemon and exits 2 with the text on stderr, which wakes Claude immediately even when idle ([hooks#limitations](https://code.claude.com/docs/en/hooks#limitations)). Delivered as a system reminder. `timeout` is enforced.
  * a **mod** using `$.prompt.submit({ text, asUser: true })`, which waits for idle and then starts a real user turn ([mods api](https://code.claude.com/docs/en/plugins/mods/api)). This is the cleanest semantics, but needs the mod loaded (`/reload-plugins` once).
* A `UserPromptSubmit` hook (30 s default timeout) tells the daemon "local input happened", so pending remote waits for that session get cancelled. This is the first-answer-wins arbiter for D.

**E. MCP elicitations.** An `Elicitation` hook can answer with `{action:"accept", content:{…}}` built from `requested_schema` ([hooks#elicitation](https://code.claude.com/docs/en/hooks#elicitation)). This is lower priority.

### 2.3 Correlation, idempotency, races
* **Keys:**
  * `session_id` from hook input, mapped to a Telegram topic.
  * `tool_use_id` (PreToolUse) or a daemon-generated `reqId` for every blocking request.
  * `reqId` is short base32, embedded in callback_data and mapped from `(chat_id, message_id)` for ForceReply.
* **First-answer-wins:** a single SQL statement, `UPDATE requests SET state='answered', answered_via=?, answer_json=? WHERE id=? AND state='pending'`. Check `changes === 1`. The loser gets "Already answered" via `answerCallbackQuery` ([api#answercallbackquery](https://core.telegram.org/bots/api#answercallbackquery)).
* **Telegram idempotency:** persist `last_update_id`, and commit `offset = update_id + 1` only after handling ([api#getupdates](https://core.telegram.org/bots/api#getupdates)). Handlers must tolerate replays (the conditional UPDATE does).
* **Hook retries:** Claude Code dedups identical handlers but async hooks have "no deduplication across multiple firings" ([hooks#limitations](https://code.claude.com/docs/en/hooks#limitations)). Key on `tool_use_id` / `prompt_id` to ignore duplicates.
* **Expiry:** every pending request has `expires_at` below the hook `timeout`. A sweeper marks it `expired` and edits the Telegram message. On daemon restart, mark all `pending` as `expired`, because their hook connections are gone.
* **Session liveness:** store the `claude` PID (`$PPID` of the command hook, UNVERIFIED as reliable) or poll `claude agents --json`. Close topics for dead sessions.

### 2.4 Security
* **Allowlist on `from.id`** (plus the expected chat id). Silently drop everything else ([channels-reference#gate-inbound-messages](https://code.claude.com/docs/en/channels-reference)). Anyone who can answer can run tools in your session. Anthropic's own channel doc warns: "Anyone who can reply through the channel can approve or deny tool use in your session" ([channels#security](https://code.claude.com/docs/en/channels)).
* **No public port.** Use long polling ([telegram-bot-api.md §2](./telegram-bot-api.md)). Hook API on a 0600 Unix socket, or 127.0.0.1 plus a bearer token, plus `allowedHttpHookUrls`. If you ever use a webhook, verify `X-Telegram-Bot-Api-Secret-Token` ([api#setwebhook](https://core.telegram.org/bots/api#setwebhook)).
* **Secret redaction** before anything leaves the machine:
  * Run regexes over tool inputs and outputs for API keys, tokens, `-----BEGIN … PRIVATE KEY-----`, `.env` lines, and `Authorization:` headers.
  * Claude Code itself masks recognizable credentials in channel permission relays but notes it "doesn't mask a secret that lacks a recognizable prefix", so do your own redaction ([channels-reference#permission-request-fields](https://code.claude.com/docs/en/channels-reference)).
  * Use Telegram `protect_content: true` for sensitive messages ([api#sendmessage](https://core.telegram.org/bots/api#sendmessage)).
* **Prompt injection:** remote text becomes instructions to an agent with your shell. Only allowlisted senders, and never forward group messages. Write `additionalContext` as facts; imperative "system" text can trip injection defenses ([hooks#add-context-for-claude](https://code.claude.com/docs/en/hooks#add-context-for-claude)).
* **Token storage:**
  * Keep `TELEGRAM_BOT_TOKEN` and `BRIDGE_TOKEN` in `~/.config/claude-bridge/env` (mode 0600, dir 0700), or in the OS keyring via `secret-tool`. The official plugin uses a `0o700` state dir ([server.ts](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/telegram)).
  * Don't put the bot token in `settings.json`. HTTP hook headers should reference an env var listed in `allowedEnvVars` ([hooks#http-hook-fields](https://code.claude.com/docs/en/hooks#http-hook-fields)).
* **Hook trust:** hooks run with full user permissions ([hooks#security-considerations](https://code.claude.com/docs/en/hooks#security-considerations)). Keep the hook client tiny and audited.
* **Fail-safe defaults:** on any daemon error return `{}` (no decision), never `allow`. Keep "deny on remote timeout" out of the design; use "fall back to terminal".

### 2.5 Operational practices
* Default per-hook `timeout` is 600 s, and the **maximum is UNVERIFIED** ([hooks#common-fields](https://code.claude.com/docs/en/hooks#common-fields)). Configure 900–3600 s and confirm the cap with a spike: a hook that sleeps 4000 s and logs when it gets SIGTERM.
* Rate-limit outbound messages (grammY `auto-retry` + throttler, [grammy.dev/plugins/auto-retry](https://grammy.dev/plugins/auto-retry)). Coalesce PostToolUse progress into one edited message.
* Chunk at 4096 characters *after entity parsing*. Prefer HTML parse mode with `& < >` escaping ([telegram-bot-api.md §3](./telegram-bot-api.md)).
* Toggle remote mode with `/away` and `/back` commands in Telegram, plus `CLAUDE_CLIENT_PRESENCE_FILE`-style presence detection, an idea borrowed from Remote Control push suppression ([remote-control#mobile-push-notifications](https://code.claude.com/docs/en/remote-control)). When "back", hooks return immediately so local UX is unaffected.
* Debug with `claude --debug-file /tmp/claude.log` to see hook matches, exit codes, and stdout ([hooks-guide](https://code.claude.com/docs/en/hooks-guide)).

---

## 3. Prior art (open source)

Star counts and dates are from GitHub search on 2026-10-06. Each approach summary comes from the repo README.

| Repo | ★ | Approach |
| :- | -: | :- |
| [overwirehq/claude-code-telegram](https://github.com/overwirehq/claude-code-telegram) | 2.8k | Python bot. Wraps Claude Code via the **SDK (primary) and CLI (fallback)**, so it runs separate sessions. Adds webhooks and schedulers. Doesn't attach to your terminal session. |
| [JessyTsui/Claude-Code-Remote](https://github.com/JessyTsui/Claude-Code-Remote) | 1.3k | Node. Multi-channel (email/Discord/Telegram/LINE) notifications through hooks. Injects commands via **PTY mode or tmux**. Telegram via webhook (ngrok). |
| [hanxiao/claudecode-telegram](https://github.com/hanxiao/claudecode-telegram) | 608 | Telegram webhook (cloudflared) → **`tmux send-keys`** into Claude. A **Stop hook** reads the transcript and sends the answer back. |
| [six-ddc/ccbot](https://github.com/six-ddc/ccbot) | 276 | "Telegram ↔ tmux bridge … 1 topic = 1 window = 1 session". **Forum topics**. Navigates AskUserQuestion/ExitPlanMode/permission prompts with inline keyboards **via tmux keystrokes**. A `SessionStart` hook maps tmux windows to sessions. |
| [hlebtkachenko/claude-telegram-hook](https://github.com/hlebtkachenko/claude-telegram-hook) | 1 | Claude Code **plugin: hooks plus a one-tool stdio MCP server**. Works with already-running sessions. Answers **AskUserQuestion** (buttons, multi-select, free text), plan approvals, and permissions. **Long polling, no inbound port.** Stdlib Python. Closest to the recommended design. |
| [Pupok462/claude-afk](https://github.com/Pupok462/claude-afk) | 0 | Pure-Python plugin. **Stop hook refuses to end the turn and long-polls `getUpdates`**, so Telegram text continues the same live session. `yes`/`no` answers permissions. State lives in `~/.claude/afk/active.json`. No tmux or daemon. |
| [webcomunicasolutions/claude-telegram-hook](https://github.com/webcomunicasolutions/claude-telegram-hook) | 1 | Bash permission hook. Sends permission requests with inline Allow/Deny buttons. |
| [H1an1/tmux-claudecode-telegram](https://github.com/H1an1/tmux-claudecode-telegram) | 1 | Python. Long polling → `tmux send-keys`. Stop hook returns responses. |
| [anthropics/claude-plugins-official telegram](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/telegram) | official | **Channel** (needs `--channels` at launch). grammY long polling, pairing plus allowlist, permission relay via inline buttons, 4096-character chunking. |
| [itchernetski/claude-code-telegram-hooks](https://github.com/itchernetski/claude-code-telegram-hooks) | 2 | Notification-only hooks to Telegram. |

Patterns seen: (1) tmux keystroke injection is popular but needs tmux launch; (2) hook-only plugins can answer questions and permissions in existing sessions; (3) SDK wrappers create *new* sessions; (4) Anthropic's channel is the official route for new launches.

---

## 4. Recommendation

1. **Build a Bun daemon plus settings hooks** (HTTP hooks to localhost, or a compiled command client over a Unix socket), with grammY long polling, bun:sqlite, and one forum topic per session. This covers monitoring, **AskUserQuestion answers (PreToolUse + `updatedInput.answers`)**, **permission answers (PermissionRequest)**, and **Stop-continuation (`decision: "block"` + `reason`)**. It works on sessions already running, because settings hot-reload.
2. **For injecting new instructions into idle sessions**, spike three options in order:
   * (a) the **mod** `$.prompt.submit({asUser:true})`, which has the best semantics and documented APIs;
   * (b) the **inbox socket**, which needs no plugin but has an undocumented message format and "from another session" framing;
   * (c) the **asyncRewake** Stop hook.
   Choose based on how Claude treats each message.
3. **Offer two zero-code paths in the README:** official **Remote Control** (`/remote-control` in any running session, Claude app instead of Telegram) and the official **Telegram channel** (for sessions you can relaunch with `--channels`).
4. Avoid tmux and SDK wrappers as the primary path. Keep the SDK as a "managed worker" mode where the bridge launches sessions itself (`canUseTool` + streaming input + `defer` for long waits).

## 5. Open questions (spike list)

1. What is the **maximum accepted `timeout`** for command/http hooks? Is there a hidden cap? (Docs give no maximum.)
2. In an interactive terminal, is the **permission dialog shown and answerable while a `PermissionRequest` hook is pending**, and which answer wins?
3. Does **`PermissionRequest` fire for `AskUserQuestion`**, or only `PreToolUse`?
4. What is the **inbox socket message format** after the `{"type":"auth","token":…}` line? How does Claude treat such messages versus a user turn?
5. How does Claude treat **`asyncRewake` stderr** delivered as a system reminder: does it act on it as an instruction?
6. Does a plugin or mod enabled via `settings.json` load into a running session without `/reload-plugins`?
7. Does `claude agents --json` report `status`/`waitingFor` for plain interactive (non-background) sessions?
8. Does the AskUserQuestion `updatedInput.response` freeform field work from a CLI hook, as the SDK documents?
9. How do private-chat forum topics get enabled for the bot (BotFather), and do clients render them well on the user's phone?
10. What is the UX of a long synchronous Stop or PreToolUse hook when the user returns to the terminal and wants to take over? Can Esc cancel the hook?
