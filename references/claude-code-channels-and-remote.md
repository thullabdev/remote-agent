# Reaching a Claude Code session from outside: Channels, Remote Control, cross-session messaging, mods, headless, Agent SDK, tmux

Researched 2026-10-06 (installed CLI v2.1.290, Linux). Every claim links to its source. **UNVERIFIED** marks anything not stated in a primary source.

The central question: **which mechanisms can reach an *already-running*, plain `claude` terminal session, and which need Claude Code launched in a special way?** The comparison table is in §8.

---

## 1. Channels (research preview)

Docs: [channels](https://code.claude.com/docs/en/channels), [channels-reference](https://code.claude.com/docs/en/channels-reference).

**What a channel is.** "A channel is an MCP server that pushes events into your running Claude Code session". Channels can be two-way: Claude replies through a tool the channel exposes ([channels](https://code.claude.com/docs/en/channels)). Claude Code spawns the server as a subprocess over **stdio** ([channels-reference#overview](https://code.claude.com/docs/en/channels-reference)).

**Requirements and limits**
* Research preview. It needs claude.ai or Console API-key auth. It's not available on Bedrock, Vertex, or Foundry. Team/Enterprise orgs must enable `channelsEnabled` ([channels](https://code.claude.com/docs/en/channels)).
* **Opt-in is per launch:** "no channel runs until a user opts it in for the session with `--channels`". "Being in `.mcp.json` isn't enough to push messages: a server also has to be named in `--channels`." ([channels#security](https://code.claude.com/docs/en/channels)). → **Channels can't attach to a session that was started without the flag.** The setup flow itself says "Exit Claude Code and restart with the channel flag".
* `--channels` only accepts plugins on an Anthropic-maintained allowlist (or the org's `allowedChannelPlugins`). Custom channels must use `--dangerously-load-development-channels server:<name>` or `plugin:<name>@<marketplace>`, which shows a confirmation dialog. That flag is **ignored with `-p` or the Agent SDK** ([channels-reference#test-during-the-research-preview](https://code.claude.com/docs/en/channels-reference)).
* Neither flag appears in `claude --help` during the preview ([channels#research-preview](https://code.claude.com/docs/en/channels)).
* "Events only arrive while the session is open" ([channels](https://code.claude.com/docs/en/channels)).

**Official Telegram channel plugin**
* Source: <https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/telegram>. Install with `/plugin install telegram@claude-plugins-official`, then `/telegram:configure <token>` (saved to `~/.claude/channels/telegram/.env`), then restart with `claude --channels plugin:telegram@claude-plugins-official`, then pair via `/telegram:access pair <code>`, then `/telegram:access policy allowlist` ([channels](https://code.claude.com/docs/en/channels)).
* Implementation (read from `server.ts` in that repo):
  * It uses **grammY** (`import { Bot, GrammyError, InlineKeyboard, … } from 'grammy'`) with long polling.
  * It kills stale pollers because "Telegram allows exactly one getUpdates consumer per token" (a 409 Conflict otherwise).
  * Access state lives in `~/.claude/channels/telegram/access.json` (`dmPolicy: 'pairing' | 'allowlist' | 'disabled'`, `allowFrom[]`).
  * It chunks replies at 4096 characters.
  * It relays permission prompts as an inline keyboard with callback data `perm:allow:<id>` / `perm:deny:<id>` / `perm:more:<id>`, sent only to allowlisted DMs.

**Protocol (for a custom channel)**, from [channels-reference](https://code.claude.com/docs/en/channels-reference):
* Capability: `capabilities.experimental['claude/channel'] = {}`. Add `tools: {}` for a reply tool. Set the `instructions` string to tell Claude how to reply.
* Inbound event:
  ```ts
  await mcp.notification({
    method: 'notifications/claude/channel',
    params: { content: 'text…', meta: { chat_id: '123', severity: 'high' } }, // meta keys: [A-Za-z0-9_] only
  })
  ```
  Claude sees `<channel source="name" chat_id="123" …>text…</channel>`. "Claude Code doesn't acknowledge notifications". Events queue: "If several notifications arrive while Claude is busy, they're delivered together on the next turn".
* **Permission relay:** declare `capabilities.experimental['claude/channel/permission'] = {}`. Claude Code then sends `notifications/claude/channel/permission_request` with `{ request_id, tool_name, description, input_preview }`.
  * `request_id` is 5 lowercase letters from a–z without `l`.
  * The server answers with `notifications/claude/channel/permission` `{ request_id, behavior: 'allow' | 'deny' }`.
  * "**Both stay live**: you can answer in the terminal or on your phone, and Claude Code applies whichever answer arrives first and closes the other." This is the only *documented* built-in first-answer-wins race.
  * "Relay covers tool-use approvals like `Bash`, `Write`, and `Edit`. Project trust and MCP server consent dialogs don't relay".
  * Since v2.1.211/v2.1.234, previews are sanitized and secrets masked as `[REDACTED]`.
  * **UNVERIFIED:** whether `AskUserQuestion` multiple-choice questions are relayed through channels. The docs list only tool approvals, so assume they aren't.
* "When you run channels in non-interactive mode with `-p`, tools that need terminal input, such as multiple-choice questions and plan mode approval, are disabled" ([channels](https://code.claude.com/docs/en/channels)).
* Sender gating: "Gate on the sender's identity, not the chat or room identity: `message.from.id` … not `message.chat.id`" ([channels-reference#gate-inbound-messages](https://code.claude.com/docs/en/channels-reference)).

**Verdict:** Channels are the official, cleanest "push a Telegram message into a live session plus approve permissions with a race" path. They require **launching** `claude` with `--channels` (or the dev flag for a custom channel). They can't reach a session already running without it.

---

## 2. Remote Control (official, but uses the Claude app, not Telegram)

Docs: [remote-control](https://code.claude.com/docs/en/remote-control).
* It connects claude.ai/code or the Claude mobile app to a **local** session. Messages can come "from your terminal, browser, and phone interchangeably".
* Three ways to start: `claude remote-control` (server mode), `claude --remote-control` / `--rc`, or **`/remote-control` typed inside an existing session**, which "carries over your current conversation history". Auto-connect is available via `remoteControlAtStartup: true` in `~/.claude/settings.json`.
* Requirements: Pro/Max/Team/Enterprise and a claude.ai login (**API keys are not supported**). Not available with Bedrock, Vertex, Foundry, or a custom `ANTHROPIC_BASE_URL`.
* Outbound HTTPS only, "never opens inbound ports". The transcript is stored on Anthropic servers while connected.
* "Claude Code keeps permission prompts and `AskUserQuestion` questions open until you answer them" and forwards them to the device. Mobile push is available ("Push when actions required").
* Limit: "One remote session per interactive process".

**Verdict:** this is the best *official* remote-steering option for an already-running session. It needs one local `/remote-control` command, or auto-connect configured beforehand, and it doesn't use Telegram. It's worth listing to the user as the zero-code alternative.

---

## 3. Headless / `-p` / stream-json / resume

Docs: [headless](https://code.claude.com/docs/en/headless), [cli-reference](https://code.claude.com/docs/en/cli-reference), [sessions](https://code.claude.com/docs/en/sessions).
* `claude -p "…" --output-format json|stream-json`. Use `--input-format stream-json` for streaming NDJSON user messages on stdin, and `--replay-user-messages` to echo them back ([cli-reference](https://code.claude.com/docs/en/cli-reference)).
* `--resume <id|name|path.jsonl>` / `--continue`. The session ID comes from the JSON output's `session_id` ([headless#continue-conversations](https://code.claude.com/docs/en/headless)).
* "If you resume the same session in two terminals without forking, **messages from both interleave into one transcript**" ([sessions](https://code.claude.com/docs/en/sessions)). → Running `claude -p --resume <id>` against a session that is still open interactively is **not** a safe way to inject into it. Use `--fork-session` or don't do it.
* `--permission-prompt-tool <mcp tool>` and `--permission-prompts host|none` decide who answers permission prompts in `-p` mode ([cli-reference](https://code.claude.com/docs/en/cli-reference), [headless#turn-off-permission-prompts-in-unattended-runs](https://code.claude.com/docs/en/headless)).
* `PreToolUse` `"defer"` works only in `-p`. The process exits with `stop_reason: "tool_deferred"` and `deferred_tool_use {id,name,input}`. You later resume with `claude -p --resume <id>`, and the hook returns `allow` + `updatedInput`. "There is no timeout or retry limit" ([hooks#defer-a-tool-call-for-later](https://code.claude.com/docs/en/hooks#defer-a-tool-call-for-later)). This is ideal for a wrapper-launched worker that may wait hours for a Telegram reply without keeping a process alive.

---

## 4. Cross-session messaging inbox socket (reaches running sessions; wire format partly UNVERIFIED)

Docs: [cross-session-messaging](https://code.claude.com/docs/en/cross-session-messaging), [env-vars](https://code.claude.com/docs/en/env-vars).
* Availability: "Cross-session messaging requires Claude Code v2.1.224 or later on macOS and Linux … When a session meets the requirements, messaging is on with nothing to enable."
* **Every interactive session binds a Unix domain socket inbox.**
  * Its path is shown in `/status` → `Peer address` (prefixed `uds:`) and exported to hooks and Bash as **`CLAUDE_CODE_MESSAGING_SOCKET`**, along with a per-session **`CLAUDE_CODE_MESSAGING_TOKEN`**.
  * The socket is restricted to your OS user. Its fallback directory is `/tmp/cc-socks-<uid>`.
* The docs explicitly cover "when you want a script or hook to post into a session". A posting script "can send `{"type":"auth","token":"<token>"}` as the first line of its connection" (optional on Linux). "Claude Code closes a connection that hasn't sent a complete line within 30 seconds".
* Delivery: "The receiving Claude reads the message between tool calls during an active turn … **When the receiving session is idle, Claude Code starts a new turn with the message.**"
* Inbound policy: `crossSessionInbound` = `accept` | `hold` | `refuse`. With no value set, a session that *prompts* for permissions **delivers** each message. It holds one only when the sender identifies as bypassing permissions. A bypass-mode session holds messages for approval. "Own-child messages" (from a hook or Bash child of the session) are verified and delivered. On Linux this works by process evidence, or by the token.
* Restrictions on what a message can do: it "**can't approve anything**" (it can't answer a pending permission prompt). "Commands don't run". Claude is told the message "came from another session, not from you". Limits are about 1M characters per message and a queue of at most 50 accepted messages.
* **UNVERIFIED:** the JSON line format for the message itself after the auth line. Only the auth line is documented. Options: (a) reverse-engineer from a capture, (b) post from a mod via `$.session.send` (documented, §5), or (c) ask Claude in a session to `SendMessage` and capture the bytes. The format may change between versions.

**Verdict:** this is the only *documented* path by which an **external local process** can start a new turn in an **already-running plain `claude` session with no wrapper and no relaunch**. The hooks already hot-reloaded from settings can capture `$CLAUDE_CODE_MESSAGING_SOCKET` for the daemon on any event. Caveats: the message is framed as coming from another session, not from the user. It can't answer permission or AskUserQuestion dialogs. The wire format must be confirmed.

---

## 5. Mods (in-process JS plugins; v2.1.287+ in the terminal)

Docs: [mods overview](https://code.claude.com/docs/en/plugins/mods/overview), [events](https://code.claude.com/docs/en/plugins/mods/events), [api](https://code.claude.com/docs/en/plugins/mods/api), [reference](https://code.claude.com/docs/en/plugins/mods/reference).
* A mod is a plugin made of JS/TS handlers that run *inside* Claude Code. "Mods are on by default. In the terminal, use Claude Code v2.1.287 or later" (installed: 2.1.290 ✅).
* Capabilities relevant here:
  * **Start a turn as the user:** "`$.prompt.submit({ text })` … To send it as the user's own words, without that sentence, add `asUser: true`. The call waits until the session is idle and then starts a new turn" ([api#start-a-turn-from-a-background-job](https://code.claude.com/docs/en/plugins/mods/api)).
  * **Background timers:** `$.clock.every` / `$.clock.after`, started from `session.start`.
  * **Network:** `$.http.fetch(url, init)`, which can long-poll a local daemon or Telegram directly. Also `$.process.run`/`spawn`, `$.fs`, `$.store` ([api#reach-files-processes-and-the-network](https://code.claude.com/docs/en/plugins/mods/api)).
  * **Hold a tool call:** in `tool.call`, a hook "can `await` before it calls `next` or returns, and the tool call stays pending". `$.ui.ask(question, options)` shows the local question dialog. A hook can answer a call itself with `{ result }` or `{ deny }` ([events#hold-a-tool-call-until-the-user-decides](https://code.claude.com/docs/en/plugins/mods/events)).
  * `tool.check` returns `allow` / `ask` / `deny` ([events](https://code.claude.com/docs/en/plugins/mods/events)).
  * `classic.<Event>` lets a mod see every settings-hook event, e.g. `classic.Stop` ([events#hook-the-settings-hook-events](https://code.claude.com/docs/en/plugins/mods/events)).
  * `$.session.send({ to, text })` and the `session.receive` event cover cross-session messages ([api#send-and-receive-messages-between-sessions](https://code.claude.com/docs/en/plugins/mods/api)).
  * Mods can redraw the AskUserQuestion render site ([reference#render-sites](https://code.claude.com/docs/en/plugins/mods/reference)).
* Limits: "A hook's own execution time for one event, **not counting time inside `next` or a mods API call** … 10 seconds". So awaiting `$.http.fetch` or `$.ui.ask` doesn't consume the budget. "Claude Code skips a hook that times out, so the held command would run" ([reference#limits](https://code.claude.com/docs/en/plugins/mods/reference)).
* Loading: installing from a shell while a session is open requires "`/reload-plugins` in that session to load it". **UNVERIFIED:** whether enabling a plugin by editing `settings.json` alone auto-loads it into a running session.
* Security: "A mod is code that runs with your permissions … Act without asking you: approve a tool call before you're asked" ([overview#what-a-mod-can-reach](https://code.claude.com/docs/en/plugins/mods/overview)).
* **UNVERIFIED (design idea):** racing `$.ui.ask(...)` (local) against `$.http.fetch(daemon long-poll)` (remote) inside one `tool.call` hook for AskUserQuestion. This would give first-answer-wins locally. Whether a pending `$.ui.ask` can be cancelled programmatically when the remote side wins is not documented.

**Verdict:** mods are the most capable *in-process* mechanism. They give true user-turn injection when idle (`asUser: true`) and a local/remote race on tool calls. They work in already-running sessions after a one-time `/reload-plugins` (or at the next start).

---

## 6. Agent SDK (TypeScript `@anthropic-ai/claude-agent-sdk`)

Docs: [agent-sdk/overview](https://code.claude.com/docs/en/agent-sdk/overview), [user-input](https://code.claude.com/docs/en/agent-sdk/user-input), [streaming-vs-single-mode](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode), [hooks](https://code.claude.com/docs/en/agent-sdk/hooks), [typescript](https://code.claude.com/docs/en/agent-sdk/typescript).
* **`canUseTool(toolName, input, { signal, suggestions })`** fires for both permission prompts and `AskUserQuestion`. It returns `{ behavior: 'allow', updatedInput }` or a deny. "**The callback can stay pending indefinitely.**" For AskUserQuestion, return `updatedInput` = `{ questions, answers: { [questionText]: label | label[] }, response? }` ([user-input](https://code.claude.com/docs/en/agent-sdk/user-input)).
  * It "never fires for auto-approved tools".
  * "`AskUserQuestion` is not currently available in subagents".
* **Streaming input:** pass an `AsyncGenerator<SDKUserMessage>` as `prompt` to get a long-lived session where you push follow-up user messages, interrupts, and images ([streaming-vs-single-mode](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)):
  ```ts
  import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
  async function* inbox(): AsyncGenerator<SDKUserMessage> {
    for await (const text of telegramMessages()) {
      yield { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null };
    }
  }
  for await (const msg of query({ prompt: inbox(), options: { canUseTool } })) { /* mirror to Telegram */ }
  ```
* SDK callback hooks follow command-hook default timeouts (600 s), but **a timed-out callback blocks the tool call** instead of failing open ([agent-sdk/hooks#hook-timeout](https://code.claude.com/docs/en/agent-sdk/hooks)).
* Hosts such as Claude Desktop and the VS Code extension drive Claude Code through `canUseTool` ([hooks#notification](https://code.claude.com/docs/en/hooks#notification)).
* **Verdict:** the SDK gives full programmatic control, but only for sessions **your process launched**. It can't attach to a terminal session that is already running. Resuming the same session ID concurrently interleaves transcripts (§3).

---

## 7. tmux `send-keys` (community approach)

* Mechanism: run `claude` inside tmux. The bridge types into the pane with `tmux send-keys -t <pane> -l "<text>"` and then sends `Enter` as a separate key. It reads state with `tmux capture-pane -p`.
  * The `-l` flag "disables key name lookup and processes the keys as literal UTF-8 characters" ([tmux(1)](https://man7.org/linux/man-pages/man1/tmux.1.html)).
* Used by six-ddc/ccbot (see `architecture-best-practices.md`), hanxiao/claudecode-telegram, JessyTsui/Claude-Code-Remote, and H1an1/tmux-claudecode-telegram.
* Pros:
  * Works with any Claude Code feature, because it behaves exactly like a human typing.
  * Can answer AskUserQuestion, plan approval, and permission dialogs by sending arrow and number keys.
  * The session stays attachable locally (`tmux attach`).
* Cons:
  * Requires the session to have been **started inside tmux**, so it can't reach a plain terminal.
  * Fragile against TUI changes, because it scrapes screen text.
  * Races with local typing.
  * Multi-line input and Enter semantics are tricky. There's an open upstream request for programmatic submission in interactive mode, [anthropics/claude-code#15553](https://github.com/anthropics/claude-code/issues/15553).
  * There's no structured correlation ID.
  * Escaping problems: control sequences in text could trigger TUI shortcuts. Use `-l`.
  * Claude Code's own docs mention tmux only as a way to keep a session alive ([remote-control#limitations](https://code.claude.com/docs/en/remote-control)).

---

## 8. Comparison: what reaches an already-running interactive session?

| Mechanism | Reaches a plain `claude` already running, no relaunch? | Inject a new user instruction | Answer permission prompt | Answer AskUserQuestion | Local+remote race | Notes |
| :- | :- | :- | :- | :- | :- | :- |
| **Settings hooks** (command/http) | **Yes**: settings hot-reload ([settings](https://code.claude.com/docs/en/settings)) | Only via Stop `decision:block` + `reason`, or `asyncRewake` exit 2 (system reminder) | Yes (PermissionRequest / PreToolUse) | **Yes** (PreToolUse + `updatedInput.answers`) | **No** for PreToolUse: the terminal dialog appears only after the hook returns. PermissionRequest is UNVERIFIED. | Timeout default 600 s; max UNVERIFIED. Timeout falls back to the local dialog. |
| **Inbox socket** (`CLAUDE_CODE_MESSAGING_SOCKET`) | **Yes** (v2.1.224+, on by default) | Yes, starts a turn when idle, but framed "from another session" | **No** ("can't approve anything") | No | n/a | Wire format beyond the auth line is UNVERIFIED |
| **Mod** | After `/reload-plugins` or the next start | **Yes**, `$.prompt.submit({text, asUser:true})` | Yes (`tool.check`/`tool.call`) | Yes (`tool.call` → `{result}` / modified `next`) | Possible (`$.ui.ask` vs fetch; UNVERIFIED) | Most powerful; runs with full user rights |
| **Channels** | **No**: needs `--channels` / dev flag at launch | Yes (`<channel>` event) | Yes, **documented race** | Not documented (assume no) | Yes (permissions) | Research preview; custom channels need the dev flag |
| **Remote Control** | Yes after typing `/remote-control` locally, or auto-connect | Yes (Claude app/web) | Yes | Yes | Yes | Not Telegram; claude.ai login only |
| **Agent SDK / `-p` stream-json** | **No**: your process must own the session | Yes | Yes (`canUseTool`) | Yes | You implement it | `defer` enables long waits without a live process |
| **tmux send-keys** | **No**: must be started in tmux | Yes (keystrokes) | Yes (keystrokes) | Yes (keystrokes) | Implicit (both type into one TTY) | Fragile scraping |

**Bottom line**
* For a plain terminal session that's already running, the documented, wrapper-free levers are:
  * **(a)** settings hooks (hot-reloaded), for answering AskUserQuestion and permissions and for Stop-hook continuation;
  * **(b)** the cross-session inbox socket, for starting new turns;
  * **(c)** a mod after `/reload-plugins`.
* Channels, the SDK, and tmux all need Claude to be **launched** a particular way.
