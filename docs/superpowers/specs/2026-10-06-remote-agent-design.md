# Remote Agent — Design Spec

Date: 2026-10-06 · Glossary: [`CONTEXT.md`](../../../CONTEXT.md) · Decision: [ADR-0001](../../adr/0001-mod-as-session-client.md) · Research: [`references/`](../../../references/README.md)

## Goal

Watch and steer every active Claude Code Session on this machine from Telegram: receive Prompts (Questions and Permission Requests) and Reports, answer Prompts remotely, and send Instructions to idle Sessions so they continue.

## Requirements

1. **Scope**: every interactive Claude Code Session on this one machine (no special launch flags). Already-running Sessions join after one `/reload-plugins`.
2. **User**: exactly one Telegram user; one private supergroup with Topics. Updates from any other chat or user are ignored.
3. **Pushed to the Channel**:
   - Prompts — always: AskUserQuestion Questions and Permission Requests (`tool.check` verdict `ask`).
   - Reports — only while Away mode is on: session started, session ended, turn finished (last assistant message, ≤1,000 chars, plus duration).
4. **Accepted from the Channel**: Answers (button tap or reply to the Prompt message), Instructions (any other text in a Session's Thread), commands `/away`, `/back`, `/status`.
5. **First Answer wins** between the terminal and Telegram; the losing side is told ("answered locally/remotely"). Permission Requests race Claude Code's own permission dialog through a `PermissionRequest` hook (ADR-0002); a Permission Request answered in the terminal is settled when the tool call finishes or the turn ends.
6. **Unanswered Prompts** wait indefinitely; one reminder after 30 minutes (configurable).
7. **Instructions to a busy Session** are queued and delivered as a real user turn when the Session is idle; the user sees "queued" then "delivered".
8. **Privacy**: all text leaving the machine is secret-redacted and truncated.
9. **Durability**: Prompts, Threads, and Instructions persist in SQLite across Bridge restarts.
10. **Away mode** is on when the Bridge starts.
11. **Fail-safe**: if the Bridge is unreachable, Sessions behave exactly like stock Claude Code. Nothing is ever auto-approved without an Answer.

## Architecture

```
┌──────────── claude (each Session) ───────────┐        ┌──────────────── Bridge (bun, systemd --user) ────────────────┐
│ remote-agent mod                              │  HTTP  │ http.ts ─ PromptService ─ Store (bun:sqlite)                 │
│  tool.call(AskUserQuestion) ─┐                │ over   │      │          │                                            │
│  tool.check(verdict ask) ────┼─ resolvePrompt ├─Unix──►│  Notifier ── Channel ◄── Inbound (buttons/replies/commands) │
│  turn.complete / session.*  ─┘  (race local   │ socket │      │      (TelegramChannel, grammY long polling)          │
│  clock.every → instructions → prompt.submit   │        └──────┼──────────────────────────────────────────────────────┘
└───────────────────────────────────────────────┘               ▼ Telegram supergroup, one Topic (Thread) per Session
```

- **Mod** (`mod/remote-agent`): in-process hooks. Creates Prompts on the Bridge, races a local `$.ui.ask` dialog against a remote long-poll, posts the local Answer back (first wins), polls Instructions every 3 s and submits them with `asUser: true`.
- **Bridge** (`src/bridge`): Bun HTTP server on `$XDG_RUNTIME_DIR/remote-agent/bridge.sock` (dir 0700, socket 0600). Owns state, the first-Answer-wins rule, redaction, Away mode, reminders.
- **Channel** (`src/channel`): interface + Telegram adapter. Bridge core never sees Telegram types.

## Bridge HTTP API (Unix socket, JSON)

| Method & path | Body | Response |
|---|---|---|
| `GET /health` | – | `200 {ok:true}` |
| `POST /prompts` | `CreatePromptRequest` | `200 AnswerState` (idempotent on `promptId`) |
| `GET /prompts/:id?waitMs=N` | – | `200 AnswerState` after answer or `min(N,25000)` ms; `404` unknown |
| `POST /prompts/:id/answer` | `{answer}` | `200 {accepted, state}` — source is `local` |
| `POST /reports` | `ReportRequest` | `202` |
| `GET /sessions/:id/instructions` | – | `200 Instruction[]` (pending) |
| `POST /instructions/:id/delivered` | – | `204`, `404` unknown |

Types live in `mod/remote-agent/hooks/protocol.ts` and are shared by both sides.

## Telegram behaviour

- Thread title `<project> · <first 8 chars of session id>`; created lazily on the first message for a Session, closed (and forgotten) on session end.
- Question: one message per question. Single-select questions get one button per option; multi-select questions are answered by replying with numbers (`1,3`). Any reply text that is not option numbers is a free-text ("Other") Answer.
- Permission Request: Allow / Deny buttons; replying `allow`/`yes` allows, `deny`/`no` denies, any other reply denies with that text as feedback to the agent.
- On resolution: buttons removed, a note posted as a reply (`✅ Allowed (local)`).
- HTML parse mode, every message ≤ 4,096 chars, `callback_data` ≤ 64 bytes.

## Out of scope (v1)

Starting new Sessions remotely, interrupting Sessions, multiple machines, multiple users, other Channels, headless (`-p`/SDK) Sessions, live tool-call streaming.
