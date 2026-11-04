# The web channel is a second Channel inside the Bridge, behind a boundary in src/channel/web

The web chat is the Channel the user reaches first; Telegram stays switchable. We run it inside the Bridge process rather than as a separate service. The web code lives in `src/channel/web/` and reaches the Bridge only through the seams the Bridge already has: `WebChannel` implements `Channel` (the same seam Telegram uses), and it is also the optional `ChatSink` the Notifier calls for structured output. `src/bridge/app.ts` is the only place that wires them together. Telegram-only behaviour is unchanged when `web` is not selected, and only one Channel runs at a time: if both are selected the Bridge logs that and starts the web channel alone.

## Why the message log lives in the Bridge

The Bridge already owns the facts the chat shows: Prompts, Answers, Reports, Instructions and Session state. The `ChatLog` is a set of tables and an append-only event feed in the same SQLite database (`bridge.db`), written by the Bridge. A separate web service would need its own copy and a sync protocol, and would still need the Bridge to tell it about every Prompt. Keeping the log in the Bridge lets one write both update the chat and the Prompt state, and gives clients resumable history: a WebSocket connects with `after=<seq>` and replays only what it missed.

## Why transcripts are tailed

The Bridge sees Prompts and turn-complete Reports, which carry only the final answer text. It does not see tool calls or the text of earlier steps in a turn. The chat needs both. `references/web-channel-spike-results.md` checked the three things this depends on:

- The Bridge's session id equals the Claude session id (`$.session.id()`), and the transcript path is derived from the cwd and the session id. The directory encoding is not reversible, so the cwd comes from the mod, never from the directory name.
- Assistant text and tool inputs are complete in the transcript. Tool output can be capped at 30,000 characters inline (the full output is in a file the transcript points to), so a display may be truncated.
- The busy flag can be read from the transcript (a turn is open until its `turn_duration` entry). That is best effort, and `turn_complete` confirms it.

The file may not exist until the first prompt, so the reader waits for it. Entries are idempotent by their transcript id, so a restart re-reads the file without duplicating messages. The alternative was to have the mod forward tool events. It was not needed, so the mod is unchanged. The transcript format is not a stable public contract. If it changes, the reader is the piece to revise.

## Origin and identity rule

Every WebSocket upgrade and every non-GET/HEAD request must carry an `Origin` that matches `REMOTE_AGENT_WEB_ORIGINS` exactly (scheme, host and port). This is mandatory. Without it, a hostile page open in the user's own browser on the tailnet could reach the server with the identity header attached (cross-site WebSocket or request forgery). GET and HEAD may omit `Origin` only when `Sec-Fetch-Site` is `same-origin` or `none`, because browsers send no `Origin` on same-origin page and asset loads. Any other request without `Origin` is refused.

The identity header (`Tailscale-User-Login`, added by `tailscale serve`) is trusted. The server binds loopback only and the machine is assumed single-user, which the Bridge's socket permissions already assume. `REMOTE_AGENT_WEB_TOKEN` is an optional bearer fallback for access that does not go through `tailscale serve`.

## Skills endpoint deferred

The UI handoff had a skills menu that sends a skill as an Instruction. The spike found that `$.prompt.submit` refuses any text starting with `/` (the host says it would run a command as the user). `$.command.run` accepts a bare command name, but skills were not verified through it. There is no skills endpoint until a path is verified. Revisit with a new spike.

## Consequences

- Web Push works on iPhone and iPad only for a page added to the Home Screen, and needs HTTPS (`tailscale serve`). Push subscriptions that the push service reports gone (404 or 410) are pruned.
- The Bridge process now serves HTTP on loopback, so it holds one more port and a WebSocket connection per open browser tab.
- Away mode applies to web push as it does to Telegram: Reports are pushed only while it is on; Prompts are always pushed.
- Telegram is no longer needed to run the Bridge. Its variables are required only when `telegram` is selected.
