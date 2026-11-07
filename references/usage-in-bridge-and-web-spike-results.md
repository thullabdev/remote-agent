# Usage (context, 5h, 7d) in the Bridge and web UI: spike results

Evidence for the implementation plan in `docs/superpowers/plans/2026-11-07-usage-in-bridge-and-web.md`. Environment: Claude Code 2.1.319 on Linux, mod `remote-agent@remote-agent-local` enabled. Samples are from one real `claude -p` run on a subscription account. Account identifiers and cwd are not copied here.

## 1. Where the numbers come from

Three sources exist in this build. Only one is usable from inside a session.

| Source | Fields | Use |
|---|---|---|
| `statusLine` stdin JSON | `context_window.used_percentage`, `rate_limits.five_hour|seven_day.{used_percentage, resets_at}` (epoch seconds) | Terminal only. The user's `~/.claude/statusline-command.sh` already draws these. |
| Mod engine `session.measure` event | `context {tokens, window, percent}`, `rateLimits [{kind, percentUsed, resetsAt ISO}]`, `cost {usd}`, `changed[]` | Pushed to the mod inside each session. **The chosen source.** |
| Mod engine `$.session.usage()` | Same figures as `session.measure`, polled | Fallback only. `session.measure` already carries them. |

Declared in `spike/mod/.claude-plugin/types/claude-code/index.d.ts`: `session.measure` (about line 4315), `SessionMeasureInput` (about 10770), `SessionRateLimit` (10951), `SessionUsage` (11363).

The declaration says `session.measure` fires after each main-thread turn and when a rate-limit window moves a whole point. Only the first trigger was observed; see section 4.

## 2. Live probe (verified)

Probe mod: a throwaway plugin in the scratchpad, not the repo. It registers `session.start`, `turn.complete` and `session.measure`, and posts each one through `$.http.fetch` to a Unix socket collector.

Command: `claude -p "Reply with the single word: ok" --plugin-dir <probe> < /dev/null`. Exit 0, one turn.

Observed (values rounded, timestamps shortened):

- `session.start`: fired, `interactive: false`.
- `session.measure`: fired once after the turn. `changed: ["context","rateLimits","cost"]`.
  - `context`: `tokens: 25230`, `window: 1000000`, `percent: 3`.
  - `rateLimits`: `five_hour` at `percentUsed: 2`, `resetsAt: 2026-11-07T04:00:00.000Z`; `seven_day` at `percentUsed: 64`, `resetsAt: 2026-11-08T12:00:00.000Z`.
  - `cost.usd`: `0.00025`.
- `session.usage()` returned the same `context`, `rateLimits` and `cost`.
- `turn.complete`: fired.

Two details that change the design:

- **Units differ from the status line.** The status line uses epoch seconds for `resets_at`. The mod event uses ISO strings. `percentUsed` is 0-100 in both. The Bridge must normalise to one form.
- **`window` is 1,000,000 tokens** for the model used. Do not hard-code 200k.

Failed attempts, so they are not repeated:

1. Probe run with `import { appendFileSync } from 'node:fs'` in `register.ts`. Claude printed `usage-probe: hooks module did not load: cannot import "node:fs" ... a hooks module imports its own files by relative path and "claude-code", nothing else`. **A hooks module may import only its own relative files and `claude-code`.** Network I/O goes through `$.http.fetch(..., { socketPath })`, as `mod/remote-agent/hooks/register.ts` already does.
2. The first run with no stdin redirect printed a 3 s stdin warning. `< /dev/null` silences it.

Cost of the probe: three tiny Haiku calls, well under one cent.

## 3. Bridge and web ingestion points (read from the code)

- Mod to Bridge: `mod/remote-agent/hooks/bridge-client.ts` posts JSON through an `HttpPort`. Routes are dispatched in `src/bridge/http.ts` (`route()`). `POST /reports` is the closest existing shape. A new `POST /usage` route fits the same pattern.
- Session to chat: `sessions.chat_id` is never nulled (`src/bridge/store.ts:41`, column guard at `:129`). The Bridge can map a usage report to a chat.
- Web snapshot: `GET /api/state` (`src/channel/web/api.ts:206`) returns `{seq, away, chats}`. Adding `usage` here gives page load the current value.
- Web live path: `ChatLog.publish` (`src/channel/web/chat-log.ts:486`) persists every event and assigns a `seq`. `server.ts:236` subscribes the Hub to it. Usage is a current value, not history, so it should **not** go through `ChatLog`. Broadcast it directly from the Hub.
- UI: `src/ui/use-web-channel.ts` `parseServerEvent` (around line 24) returns null for any event without a numeric `seq`, except `hello` and `resync`. An ephemeral `usage.updated` event needs its own branch before the seq check.
- UI surfaces: `chat-header.tsx` (per-chat header), `chat-list.tsx` (the list, where account-wide limits belong), `chat-info.tsx` (details panel). The header component already renders `Chat` props.

## 4. Gaps and risks not yet tested

- **`session.measure` on rate-limit moves.** The declaration says it fires when a window moves a whole point, and that only the turn trigger was observed. Idle sessions can therefore be stale. The Bridge must show the time of each reading and expire windows whose `resetsAt` has passed.
- **The real mod was not exercised.** The probe used a separate plugin. The implementation must run an interactive session with the real `remote-agent` mod, and confirm the event fires there too.
- **Off-subscription sessions.** `rateLimits` is empty without a subscription. The UI must hide the account strip, not show 0%.
- **Spend limits.** Gateway users may get `kind: "spend_limit"` with `percentUsed` above 100. Out of scope for the first version; the parser should ignore unknown kinds.
- **The user's status line.** `~/.claude/settings.json` already sets `statusLine` to `bash ~/.claude/statusline-command.sh`. The earlier `spike/usage/README.md` snippet would replace it. That snippet should be ignored or corrected. Nothing in this spike changed the user's settings.

## 5. Conclusion

Yes, this can be done without polling or new credentials. The mod's `session.measure` already carries everything the Bridge and UI need. The plan is a new mod hook, a Bridge route with a small store table, an ephemeral Hub event with the same figures in `/api/state`, and UI surfaces. The data is account-wide for limits and per-session for context, so the Bridge must store both and map context to chats.
