# References: remote Telegram bridge for live Claude Code sessions

Researched 2026-10-06 for Claude Code v2.1.290 (Linux), TypeScript on Bun 1.2.5 / Node 24. Primary sources: code.claude.com/docs, core.telegram.org, official GitHub repos. Unconfirmed items are marked **UNVERIFIED** in each file.

## Executive summary

1. **Settings hooks are the wrapper-free lever.** They hot-reload into already-running sessions. A `PreToolUse` hook can **answer `AskUserQuestion`** (`permissionDecision: "allow"` + `updatedInput.answers`). `PermissionRequest` can allow or deny tools. A `Stop` hook can continue the session with `{"decision":"block","reason":"<new instruction>"}`.
2. **Hook timeout** defaults to **600 s** (30 s for UserPromptSubmit, 1.5 s for SessionEnd). The docs state **no maximum**, so it is UNVERIFIED and must be tested. A timed-out PreToolUse hook falls back to the normal local dialog.
3. **Channels** (`notifications/claude/channel`, with permission relay that has a documented terminal-vs-phone first-answer-wins race) are the official Telegram route. They only work for sessions **launched** with `--channels` (or the dev flag for custom channels), not for already-running ones.
4. Already-running plain sessions can also be reached through the **cross-session inbox socket** (`$CLAUDE_CODE_MESSAGING_SOCKET`; starts a turn when idle, can't approve prompts; message wire format UNVERIFIED) and through **mods** (`$.prompt.submit({asUser:true})`, needs `/reload-plugins`). **Remote Control** (`/remote-control`) is the official option, but it uses the Claude app, not Telegram. SDK, `-p`, and tmux all need a special launch.
5. **Recommendation:** a Bun daemon (grammY long polling, bun:sqlite WAL, one forum topic per session, allowlist on `from.id`, no public port) fed by localhost HTTP or Unix-socket hooks, with first-answer-wins via a conditional SQL update and fallback to the terminal on timeout.

## Files

| File | Contents |
| :- | :- |
| [claude-code-hooks.md](./claude-code-hooks.md) | Hook events, stdin fields, exit codes, JSON decision shapes, timeouts, HTTP hooks, async/asyncRewake, answering AskUserQuestion, Stop continuation |
| [claude-code-channels-and-remote.md](./claude-code-channels-and-remote.md) | Channels protocol and permission relay, Remote Control, `-p`/stream-json/resume/defer, cross-session inbox socket, mods, Agent SDK (`canUseTool`, streaming input), tmux; comparison table |
| [telegram-bot-api.md](./telegram-bot-api.md) | getUpdates offset/timeout, webhooks plus secret header, inline keyboards / callback_data 64 B / answerCallbackQuery, ForceReply and reply mapping, 4096 limit, HTML vs MarkdownV2 escaping, rate limits, forum topics, allowlisting, grammY vs Telegraf |
| [architecture-best-practices.md](./architecture-best-practices.md) | Recommended architecture, flows, correlation and idempotency, security, prior-art repos, recommendation, open questions (spike list) |
| [agent-integration-surfaces.md](./agent-integration-surfaces.md) | Codex CLI, Gemini CLI and Pi (pi.dev) hooks/extensions, permission interception, user-turn injection, session ids, headless/RPC/app-server/ACP modes, capability matrix against the Claude Code mod (researched 2026-11-04) |
