# Web Channel spike results (Task 1)

Gate for Tasks 11 (and 11b), 12 and 15. Evidence only; the scripts and probes live in the scratchpad spike directory, not in the repo. Samples below are synthetic or redacted. No real prompts, paths or secrets are copied.

Environment: Claude Code 2.1.318 on Linux, installed mod `remote-agent@remote-agent-local` (user scope, not edited). Probe sessions were throwaway, in a scratch working dir, and were killed after use.

## (a) Session id and transcript path

**What I ran.** Started bare interactive `claude --session-id <uuid> --plugin-dir <scratch probe mod>` in tmux sessions `spike-a1` and `spike-a2`, after accepting the folder trust prompt. The probe mod (a throwaway copy, not the product mod) logs `$.session.id()` and `$.session.cwd()` from its `session.start` hook to a local collector. In `spike-a2` I then submitted one prompt so the transcript would be written, and killed the session.

**What I saw.**
- `$.session.id()` equalled the `--session-id` uuid in all 3 probe sessions that logged `session.start` (`8e38df20-...`, `2d2fe626-...`, `3d547ae6-...`). The probe log holds the full uuids.
- Transcript file: `~/.claude/projects/<encoded cwd>/<uuid>.jsonl` exists after the first submitted prompt (3d547ae6 was 423 KB after one turn). A bare session with no prompt wrote no transcript while it was running (2d2fe626, also not present after kill). The file is therefore not guaranteed to exist before the first prompt. Unknown whether a file appears at kill for a no-prompt session; one run suggested so, another did not.
- `session.start` fired for an interactive session with no prompt, so the mod can announce a session before any transcript exists.

**Directory-name encoding of cwd.** Every `/` and every `.` in the cwd becomes `-`. Existing `-` characters are kept, so the encoding is not reversible. Checked against the existing directory names in `~/.claude/projects` (684 project dirs) and the probe dir.
- Example 1: `/home/user/proj/app` becomes `-home-user-proj-app`.
- Example 2: `/home/user/.config/tool` becomes `-home-user--config-tool` (the `/.` pair gives `--`). The real dir `-home-giganotosaurus--local-bin` shows the same rule for `/home/<user>/.local/bin`.
- Example 3: `/home/user/my-app` becomes `-home-user-my-app`, the same name as `/home/user/my/app`. The Bridge therefore cannot derive a cwd from a dir name. It must derive the path from cwd and sessionId (cwd is known from the mod's `$.session.cwd()`).

Derivation: `~/.claude/projects/` + `cwd.replace(/[\/.]/g, '-')` + `/` + `sessionId` + `.jsonl`.

## (b) Transcript format

**What I ran.** Read the structure of all 112 transcripts under `~/.claude/projects` with scripts that print only types, keys and lengths. Read the live probe transcript. Compared `tool_result` content with `toolUseResult.stdout`.

**Entry types.** One JSON object per line. Message entries are `user`, `assistant` and `system`. Others are `attachment`, `file-history-snapshot`, `file-history-delta`, `queue-operation`, `last-prompt`, `mode`, `permission-mode`, `session-owner`, `atis-latch`, `ai-title`, `tools-used`, and internal `api-request`, `api-request-blob`, `api-request-shape`. The reader should ignore all of these except `system/turn_duration`.

**Common fields.** `uuid` (unique per line, the stable id to use for dedupe), `parentUuid`, `sessionId`, `timestamp` (ISO 8601 with milliseconds, UTC), `cwd`, `promptId` (on user entries), `isSidechain`, `isMeta`. An assistant response is split into one line per content block, each with its own `uuid`; the lines share `message.id` and carry `apiBlockIndex`.

**Synthetic samples (redacted).**

User text (typed or injected prompt). `content` is a plain string. Some have `origin: {kind}` and `turnOrigin`, which may distinguish injected prompts (not verified in detail):
```
{"type":"user","uuid":"<uuid>","parentUuid":"<uuid>","promptId":"<uuid>","sessionId":"<session-uuid>","timestamp":"<iso>","cwd":"<cwd>","message":{"role":"user","content":"<user text>"}}
```

Assistant text:
```
{"type":"assistant","uuid":"<uuid>","sessionId":"<session-uuid>","timestamp":"<iso>","message":{"id":"<msg id>","role":"assistant","stop_reason":"end_turn","content":[{"type":"text","text":"<assistant text>"}]},"apiBlockIndex":1}
```

Assistant `tool_use` (input is complete, see below):
```
{"type":"assistant","uuid":"<uuid>","timestamp":"<iso>","message":{"id":"<msg id>","stop_reason":"tool_use","content":[{"type":"tool_use","id":"toolu_<id>","name":"Bash","input":{"command":"<command>"},"caller":{"type":"direct"}}]}}
```

User `tool_result`:
```
{"type":"user","uuid":"<uuid>","parentUuid":"<uuid>","promptId":"<uuid>","timestamp":"<iso>","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_<id>","content":"<tool output>","is_error":false}]},"toolUseResult":{"stdout":"<tool output>","stderr":"","interrupted":false,"isImage":false}}
```

`AskUserQuestion`. The assistant `tool_use` has `name: "AskUserQuestion"` and `input.questions[]` with `question`, `header`, `multiSelect`, `options[{label, description}]`. The answer comes back as a user `tool_result` whose `toolUseResult` has `questions` and `answers`. Counts: 49 tool_use blocks in 28 transcripts; 45 results carry `answers`. The exact `answers` map shape was not inspected in detail. The `tool_use.id` equals the `tool_result.tool_use_id`, so the Prompt id `q:<tool_use_id>` used by the mod can be matched.

Turn end:
```
{"type":"system","subtype":"turn_duration","durationMs":2953,"messageCount":23,"uuid":"<uuid>","timestamp":"<iso>","sessionId":"<session-uuid>"}
```

**Completeness.**
- Tool inputs: complete. 9,107 `tool_use` blocks; the largest input JSON is 154,092 characters, so there is no visible cap on input. 321 inputs contain an ellipsis or the word "truncated", which look like file content, not CLI truncation (not checked case by case). `wireToolInputs` (a second copy on assistant lines) differs from `input` in 2,547 cases; the cause was not investigated. Use `input`.
- Tool output: NOT complete inline for large output. Verified with `seq 1 9000` (48,893 bytes, 9,000 lines):
  - `toolUseResult.stdout` is cut at exactly 30,000 characters (ends in the middle of a number).
  - `message.content` is replaced by a roughly 2.3 KB preview wrapped in `<persisted-output>`, which says "Output too large" and gives the file path.
  - `toolUseResult.persistedOutputPath` points at the full output. Its size matched `persistedOutputSize` (43,893 bytes, 9,000 lines). The path is under the same project dir.
  - Across all transcripts: 1,030 `content` values are `stdout` plus appended CLI notes (for example "Shell cwd was reset to ...", "Command running in background with ID ..."). 1,619 results have a non-stdout `toolUseResult` shape (non-Bash tools). 990 results have list-shaped `content`, not inspected.
- Text: user and assistant text are complete in the samples read. Thinking blocks have an empty `thinking` string and a `signature`, so thinking text is not recoverable.
- Sensitive data: transcripts hold full tool output, hook output and attachments. The reader must pass everything through the same redaction as Telegram.

## (c) Busy signal

**What I ran.** Sampled the probe transcript every 6 seconds while a Bash tool call ran a foreground `sleep` (a `sleep 40` plus a `sleep` in Python). Compared with the mod's `turn.complete` hook log.

**What I saw.**
- Mid-turn: the last entry was `assistant` with a `tool_use` block and `stop_reason: tool_use`, with no matching `tool_result` and no `system/turn_duration` after the last user prompt. This stayed for the whole sleep.
- Turn end: `user tool_result`, then `assistant` text with `stop_reason: end_turn`, then `system/stop_hook_summary`, then `system/turn_duration`.
- Count check: the probe transcript had 6 `turn_duration` lines and the mod logged 6 `turn.complete` events for the same session id.
- Not tested: user interruption (Esc), a pending `AskUserQuestion` (inferred busy, since its tool_use has no result), and background Bash tasks outside the foreground sleep. Background tasks were observed to complete as separate notifications while the turn had already ended, so they may not hold the turn open. Unknown.

**Recommended rule.** Busy = the most recent user prompt or tool_result has no later `system/turn_duration`. Treat it as best effort, as the spec says. The mod's `turn.complete` is an independent confirmation.

## (d) web-push under Bun

**What I ran.** In the scratch dir only: `bun add web-push` (installed `web-push@3.6.7`, 17 packages). Generated VAPID keys. Created a P-256 subscription key pair and a 16-byte auth secret with Node `crypto`. Started a local Bun HTTPS server with a throwaway self-signed certificate on 127.0.0.1 (web-push always uses `https.request`). It verifies the `Authorization: vapid` ES256 JWT with `crypto.subtle` against the public key. Called `sendNotification` for a 201 endpoint and a 410 endpoint, with `NODE_TLS_REJECT_UNAUTHORIZED=0` for the self-signed cert.

**What I saw.**
- Pass. 201 case: `statusCode` 201. The fake server verified the VAPID JWT signature and the public key match. `content-encoding: aes128gcm`, `TTL` header sent, body 157 bytes.
- 410 case: throws a `WebPushError` with `statusCode` 410. This is the signal Task 12 needs to prune a subscription.
- Caveat: web-push supports only `https:` endpoints (plain `http:` failed with "Unable to connect"). Tests need a self-signed cert plus the env var, or a custom agent. Production push services use valid HTTPS, so this does not affect the product.
- Not tested: real browser subscriptions, the payload plaintext itself, and push services behind a proxy.

## (e) Slash commands through the mod

**What I ran.** Built a throwaway copy of the probe mod (`mod-submit`) and loaded it with `--plugin-dir` in throwaway sessions. Its `session.start` hook, 15 seconds after startup, called each step and logged the outcome:
1. `$.prompt.submit({ text: '/cost', asUser: true })` and `$.prompt.submit({ text: '/model sonnet', asUser: true })`.
2. `$.command.run({ command: '/cost' })`, then `$.command.run({ command: 'cost' })`, then `$.command.run({ command: '/model sonnet' })`.

I did not run a skill slash command. Skills were not tested through either path.

**What I saw.**
- `$.prompt.submit` with a text beginning with `/`: refused by the host, with this message: "submits a prompt to the model; a text beginning with / would run a command as the user; run one with $.command.run({ command }) (host check)". No user entry was written.
- `$.command.run({ command: '/cost' })`: refused with "no command named //cost in this session" (the name must not start with `/`).
- `$.command.run({ command: 'cost' })`: accepted. It ran `/cost`, which opened its usage panel in the session. I did not check the transcript for it.
- `$.command.run({ command: '/model sonnet' })`: refused with "no command named //model sonnet". The argument form was not found, so `/model` with an argument is unverified.
- The probe sessions also loaded the installed mod (user scope). Its hooks report to the Bridge socket, which was not running; they failed silently. The installed mod was not edited.

**Conclusion.** Forwarding a slash command as a prompt does not work through `$.prompt.submit`. Task 15 (skills) stays off. `/model` through the mod is unverified. A bare command name with no arguments may work through `$.command.run`, but skills are unverified there.

## Consequences

- (a) passes. Task 11 can derive the transcript path from cwd and sessionId. It should tolerate a missing file until the first prompt. Use the mod's `$.session.id()` as the Bridge's session id.
- (b) passes with a caveat. Task 11 (transcript tail) is viable. It must read `toolUseResult.persistedOutputPath` when the inline stdout is capped at 30,000 characters, or accept a truncated display. Tool inputs and text are complete. Use `uuid` for dedupe and `system/turn_duration` for turn end. Skip the internal entry types.
- (c) passes as best effort. Task 11 uses the transcript busy rule above. Task 11b (mod forwarding) is not needed for busy.
- (d) passes. Task 12 uses `web-push`. It must handle 404/410 by pruning. Tests need a self-signed HTTPS fake or a stub.
- (e) fails for `$.prompt.submit`. Task 15 (skills) is OFF. The `/model` alternative is unverified; `$.command.run` works for at least a bare command name.
- Task 11 uses transcript tail, not Task 11b mod-forwarding of tool events, so the mod is not changed for this. Revisit if Claude Code changes the transcript format.

## Scratch material (not in the repo)

Probe mods, collector, and the `web-push` test live under the spike scratch dir. These probe transcripts were left in `~/.claude/projects/` and can be removed by the user:
- `-tmp-claude-1000--home-giganotosaurus-Sites-remote-agent-f120f391-...-scratchpad-spike-work/` (contains `3d547ae6-...jsonl`, `8e38df20-...jsonl`, `c7bb9334-...jsonl`, and a `memory/` dir).
- The `2d2fe626-...` probe session wrote no transcript.
